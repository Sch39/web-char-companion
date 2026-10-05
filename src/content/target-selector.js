/**
 * Target Selector.
 *
 * Scores each candidate from DomScanner, then picks a target with a weighted
 * random so behavior isn't deterministic. Remembers the last few targets for a
 * "recent" penalty and a novelty bonus.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  class TargetSelector {
    constructor() {
      this.recent = []; // recently visited elements
    }

    /**
     * @param {Array} candidates result of DomScanner.scan()
     * @param {object} settings active settings (used to filter behavior)
     * @param {number|null} fromX current character position (distance penalty)
     */
    pick(candidates, settings, fromX) {
      const vh = window.innerHeight;
      const scored = [];
      for (const c of candidates) {
        if (!this._allowed(c, settings)) continue;
        const score = this._score(c, vh, fromX, settings);
        if (score > 0) scored.push({ ...c, score });
      }
      if (!scored.length) return null;
      // Weighted random over the top-N so it still leans toward interesting ones
      scored.sort((a, b) => b.score - a.score);
      const pool = scored.slice(0, Math.min(6, scored.length));
      const picked = this._weightedRandom(pool);
      this._remember(picked.el);
      return picked;
    }

    _score(c, vh, fromX, settings) {
      let score = WCC.SEMANTIC_SCORE[c.type] || 0;

      // visibility: closer to the viewport center scores higher
      const centerDist = Math.abs(c.cy - vh / 2) / (vh / 2);
      score += (1 - WCC.clamp(centerDist, 0, 1)) * 20;

      // size: mid-sized elements are preferred (not tiny, not huge)
      const areaNorm = WCC.clamp(c.area / (window.innerWidth * vh), 0, 1);
      score += (1 - Math.abs(areaNorm - 0.15) / 0.85) * 15;

      // novelty + random
      if (this.recent.includes(c.el)) score -= WCC.CONFIG.recentPenalty;
      else score += 10;
      score += Math.random() * WCC.CONFIG.randomFactorMax;

      // penalty when the target is too close to the current position
      if (fromX != null && Math.abs(c.cx - fromX) < 60) score -= 15;

      // a playing video should dominate the pool, but stay weighted (not
      // an absolute guarantee) so behavior still has some variety
      if (c.isPlaying && settings.behaviors?.watchFilm !== false) {
        score += WCC.CONFIG.playingVideoBonus;
      }

      return score;
    }

    _weightedRandom(pool) {
      const total = pool.reduce((s, p) => s + p.score, 0);
      let r = Math.random() * total;
      for (const p of pool) {
        r -= p.score;
        if (r <= 0) return p;
      }
      return pool[0];
    }

    _allowed(c, settings) {
      const b = settings.behaviors || {};
      const type = c.type;
      if (["H1", "H2", "H3", "P", "ARTICLE"].includes(type))
        return b.readHeadings !== false;
      if (["IMG"].includes(type)) return b.lookAtImages !== false;
      if (["BUTTON", "A"].includes(type)) return b.sitOnElements !== false;
      // An iframe only ever becomes a candidate because it's playing video —
      // there's no "plain watch" state for it like there is for <video>, so
      // disabling the reaction means it shouldn't be a candidate at all.
      if (type === "VIDEO" && c.isPlaying && c.el?.tagName === "IFRAME") {
        return b.watchFilm !== false;
      }
      return true; // video/code etc. are allowed by default
    }

    _remember(el) {
      this.recent.push(el);
      if (this.recent.length > WCC.CONFIG.recentTargetMemory)
        this.recent.shift();
    }
  }

  WCC.TargetSelector = TargetSelector;
})();
