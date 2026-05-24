#!/usr/bin/env node
// Crawls minji|hanni|danielle|haerin|hyein.network, extracts photo hashes
// from each SSR'd gallery page, writes manifest.json.
//
// Env knobs:
//   LIMIT_MEMBERS=hyein,minji   only crawl named members
//   LIMIT_PAGES=2               cap pages per member (smoke testing)
//   CONCURRENCY=6               in-flight request cap

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MEMBERS = ['minji', 'hanni', 'danielle', 'haerin', 'hyein'];
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
const CDN = 'https://static.newjeans.network';
const USER_AGENT = 'newjeans-random-viewer/1.0 (+https://github.com/nerdyinu/newjeansphoto)';

const HASH_EXT_RE = /hash:"([a-f0-9]{64})",extension:"([^"]+)"/g;
const TOTAL_PAGES_RE = /total_pages:\s*(\d+)/;

const limitMembers = process.env.LIMIT_MEMBERS
  ? new Set(process.env.LIMIT_MEMBERS.split(',').map(s => s.trim()))
  : null;
const limitPages = process.env.LIMIT_PAGES ? Number(process.env.LIMIT_PAGES) : Infinity;
const concurrency = Number(process.env.CONCURRENCY) || 6;

function log(...args) { process.stderr.write(args.join(' ') + '\n'); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} (non-retryable)`);
      return await res.text();
    } catch (err) {
      if (i === attempts - 1) throw err;
      const backoff = 500 * (i + 1) + Math.floor(Math.random() * 300);
      log(`  retry ${url} after ${backoff}ms (${err.message})`);
      await sleep(backoff);
    }
  }
}

function extractHashes(html) {
  HASH_EXT_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = HASH_EXT_RE.exec(html)) !== null) {
    out.push({ hash: m[1], extension: m[2].toLowerCase() });
  }
  return out;
}

function extractTotalPages(html) {
  const m = html.match(TOTAL_PAGES_RE);
  return m ? Number(m[1]) : null;
}

async function discoverTotalPages(member) {
  const html = await fetchWithRetry(`https://${member}.network/`);
  const total = extractTotalPages(html);
  if (!total) throw new Error(`${member}: could not find total_pages in homepage`);
  const firstPage = extractHashes(html);
  return { total, firstPage };
}

// Bounded-concurrency worker pool over a list of tasks.
async function runPool(tasks, limit, onResult) {
  if (tasks.length === 0) return 0;
  const queue = tasks.slice();
  let active = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      while (active < limit && queue.length > 0) {
        const task = queue.shift();
        active++;
        task()
          .then(async (r) => {
            await onResult(r);
            done++;
            active--;
            if (queue.length === 0 && active === 0) resolve(done);
            else pump();
          })
          .catch((err) => {
            failed = true;
            reject(err);
          });
      }
    };
    pump();
  });
}

async function crawlMember(member, memberIndex) {
  log(`\n[${member}] discovering...`);
  const { total, firstPage } = await discoverTotalPages(member);
  const capped = Math.min(total, limitPages);
  log(`[${member}] total_pages=${total}, will fetch=${capped}, first-page items=${firstPage.length}`);

  const seen = new Map(); // hash -> extension
  for (const p of firstPage) seen.set(p.hash, p.extension);

  const pages = [];
  for (let p = 2; p <= capped; p++) pages.push(p);

  let completed = 1;
  let lastLogAt = Date.now();
  const tasks = pages.map(p => async () => {
    const html = await fetchWithRetry(`https://${member}.network/${p}`);
    return extractHashes(html);
  });

  await runPool(tasks, concurrency, async (items) => {
    for (const p of items) {
      if (!seen.has(p.hash)) seen.set(p.hash, p.extension);
    }
    completed++;
    const now = Date.now();
    if (now - lastLogAt > 2000 || completed === capped) {
      log(`[${member}] ${completed}/${capped} pages, ${seen.size} unique photos`);
      lastLogAt = now;
    }
    // tiny jitter to be polite
    await sleep(50 + Math.floor(Math.random() * 100));
  });

  log(`[${member}] done: ${seen.size} unique photos`);
  return [...seen.entries()].map(([hash, extension]) => ({ memberIndex, hash, extension }));
}

async function main() {
  const members = MEMBERS.filter(m => !limitMembers || limitMembers.has(m));
  log(`crawling members: ${members.join(', ')}`);
  log(`concurrency=${concurrency}, limitPages=${limitPages === Infinity ? 'all' : limitPages}`);

  const allEntries = [];
  for (const member of members) {
    const memberIndex = MEMBERS.indexOf(member);
    const entries = await crawlMember(member, memberIndex);
    allEntries.push(...entries);
  }

  // Build extension index lazily — extend if we discovered new exts.
  const extensions = [...EXTENSIONS];
  const photos = allEntries.map(({ memberIndex, hash, extension }) => {
    let ei = extensions.indexOf(extension);
    if (ei === -1) { ei = extensions.length; extensions.push(extension); }
    return [memberIndex, ei, hash];
  });

  // Sort by member, then by hash — deterministic diffs.
  photos.sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]));

  const manifest = {
    generatedAt: new Date().toISOString(),
    cdn: CDN,
    members: MEMBERS,
    extensions,
    photos,
  };

  const outPath = path.resolve(fileURLToPath(import.meta.url), '../../manifest.json');
  await writeFile(outPath, JSON.stringify(manifest));
  const bytes = (JSON.stringify(manifest).length / (1024 * 1024)).toFixed(2);
  log(`\nwrote ${outPath} (${photos.length} photos, ${bytes} MB)`);
  for (const [i, name] of MEMBERS.entries()) {
    const n = photos.filter(p => p[0] === i).length;
    log(`  ${name}: ${n}`);
  }
}

// Only run when invoked directly (so the extractor can be imported by tests).
const invokedAs = path.resolve(process.argv[1] || '');
const thisFile = path.resolve(fileURLToPath(import.meta.url));
if (invokedAs === thisFile) {
  main().catch(err => { log('FATAL:', err.stack || err.message); process.exit(1); });
}

export { extractHashes, extractTotalPages, fetchWithRetry, MEMBERS, EXTENSIONS, CDN };
