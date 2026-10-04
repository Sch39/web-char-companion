/**
 * Target Selector.
 *
 * Memberi skor tiap kandidat dari DomScanner lalu memilih target secara
 * semi-random (weighted) agar perilaku tidak deterministik. Mengingat
 * beberapa target terakhir untuk penalti "recent" & bonus novelty.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  class TargetSelector {
    constructor() {
      this.recent = []; // elemen yang baru dikunjungi
    }

    /**
     * @param {Array} candidates hasil DomScanner.scan()
     * @param {object} settings pengaturan aktif (untuk filter behavior)
     * @param {number|null} fromX posisi karakter saat ini (untuk penalti jarak)
     */
    pick(candidates, settings, fromX) {
      const vh = window.innerHeight;
      const scored = [];
      for (const c of candidates) {
        if (!this._allowed(c.type, settings)) continue;
        const score = this._score(c, vh, fromX);
        if (score > 0) scored.push({ ...c, score });
      }
      if (!scored.length) return null;
      // Weighted random dari top-N agar tetap cenderung memilih yang menarik
      scored.sort((a, b) => b.score - a.score);
      const pool = scored.slice(0, Math.min(6, scored.length));
      const picked = this._weightedRandom(pool);
      this._remember(picked.el);
      return picked;
    }

    _score(c, vh, fromX) {
      let score = WCC.SEMANTIC_SCORE[c.type] || 0;

      // visibility: makin dekat ke tengah viewport makin tinggi
      const centerDist = Math.abs(c.cy - vh / 2) / (vh / 2);
      score += (1 - WCC.clamp(centerDist, 0, 1)) * 20;

      // size: elemen sedang lebih disukai (bukan terlalu kecil/raksasa)
      const areaNorm = WCC.clamp(c.area / (window.innerWidth * vh), 0, 1);
      score += (1 - Math.abs(areaNorm - 0.15) / 0.85) * 15;

      // novelty + random
      if (this.recent.includes(c.el)) score -= WCC.CONFIG.recentPenalty;
      else score += 10;
      score += Math.random() * WCC.CONFIG.randomFactorMax;

      // penalti bila target terlalu dekat dengan posisi sekarang
      if (fromX != null && Math.abs(c.cx - fromX) < 60) score -= 15;

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

    _allowed(type, settings) {
      const b = settings.behaviors || {};
      if (["H1", "H2", "H3", "P", "ARTICLE"].includes(type))
        return b.readHeadings !== false;
      if (["IMG"].includes(type)) return b.lookAtImages !== false;
      if (["BUTTON", "A"].includes(type)) return b.sitOnElements !== false;
      return true; // video/code dll default boleh
    }

    _remember(el) {
      this.recent.push(el);
      if (this.recent.length > WCC.CONFIG.recentTargetMemory)
        this.recent.shift();
    }
  }

  WCC.TargetSelector = TargetSelector;
})();
