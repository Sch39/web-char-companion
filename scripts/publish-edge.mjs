#!/usr/bin/env node
// Uploads a packaged extension zip to the Microsoft Edge Add-ons store and
// publishes the resulting draft. Credentials come from the environment:
//
//   EDGE_PRODUCT_ID   product GUID from Partner Center
//   EDGE_CLIENT_ID    Client ID from the Publish API page
//   EDGE_API_KEY      API key from the same page (v1.1 credentials)
//
// Usage: node scripts/publish-edge.mjs <package.zip> [--notes "..."] [--no-publish]

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const API_ROOT = 'https://api.addons.microsoftedge.microsoft.com';

// Partner Center answers 202 while an operation is still running, so the
// polling window has to be generous; package validation can take minutes.
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 20 * 60_000;

function parseArgs(argv) {
  const opts = { file: null, notes: null, publish: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--notes') {
      opts.notes = argv[++i];
    } else if (arg === '--no-publish') {
      opts.publish = false;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (opts.file === null) {
      opts.file = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  if (!opts.file) throw new Error('missing path to the package zip');
  return opts;
}

function readCredentials() {
  const missing = [];
  const get = (name) => {
    const value = process.env[name];
    if (!value) missing.push(name);
    return value;
  };
  const creds = {
    productId: get('EDGE_PRODUCT_ID'),
    clientId: get('EDGE_CLIENT_ID'),
    apiKey: get('EDGE_API_KEY'),
  };
  if (missing.length) {
    throw new Error(`missing environment variables: ${missing.join(', ')}`);
  }
  return creds;
}

function authHeaders({ clientId, apiKey }) {
  return { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
}

// The operation id arrives in the Location header, which is sometimes a bare
// id and sometimes a full URL depending on the endpoint.
function operationIdFrom(response) {
  const location = response.headers.get('location');
  if (!location) throw new Error('response had no Location header');
  const id = location.trim().split('/').pop();
  if (!id) throw new Error(`could not read an operation id from "${location}"`);
  return id;
}

async function request(url, init) {
  const response = await fetch(url, init);
  if (response.status >= 400) {
    const body = await response.text();
    throw new Error(`${init.method} ${url} failed with ${response.status}: ${body.slice(0, 2000)}`);
  }
  return response;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Both status endpoints share the same payload shape: a status of InProgress,
// Succeeded or Failed, plus a message and an errors array when it fails.
async function pollOperation(label, url, headers) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await request(url, { method: 'GET', headers });
    const payload = await response.json();
    const status = payload.status ?? 'InProgress';

    if (status === 'Succeeded') {
      console.log(`${label}: succeeded`);
      return payload;
    }
    if (status === 'Failed' || status === 'FailedAbort') {
      const details = (payload.errors ?? [])
        .map((e) => `  - ${e.message ?? JSON.stringify(e)}`)
        .join('\n');
      throw new Error(
        `${label} failed: ${payload.message ?? status}${details ? `\n${details}` : ''}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}: still ${status} after ${POLL_TIMEOUT_MS / 60000} minutes, giving up`);
    }

    console.log(`${label}: ${status}, checking again in ${POLL_INTERVAL_MS / 1000}s`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function uploadPackage(creds, file) {
  const headers = { ...authHeaders(creds), 'Content-Type': 'application/zip' };
  const body = await readFile(file);
  const base = `${API_ROOT}/v1/products/${creds.productId}/submissions/draft/package`;

  console.log(`uploading ${basename(file)} (${(body.length / 1024).toFixed(0)} KB)`);
  const response = await request(base, { method: 'POST', headers, body });
  const operationId = operationIdFrom(response);

  await pollOperation('upload', `${base}/operations/${operationId}`, authHeaders(creds));
}

async function publishDraft(creds, notes) {
  const base = `${API_ROOT}/v1/products/${creds.productId}/submissions`;
  const headers = { ...authHeaders(creds), 'Content-Type': 'application/json' };

  console.log('publishing the draft submission');
  const response = await request(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ notes: notes ?? '' }),
  });
  const operationId = operationIdFrom(response);

  await pollOperation('publish', `${base}/operations/${operationId}`, authHeaders(creds));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const creds = readCredentials();

  const info = await stat(opts.file);
  if (!info.isFile()) throw new Error(`${opts.file} is not a file`);

  await uploadPackage(creds, opts.file);

  if (!opts.publish) {
    console.log('package uploaded; skipping publish as requested');
    return;
  }

  await publishDraft(creds, opts.notes);
  console.log('submission sent for certification');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
