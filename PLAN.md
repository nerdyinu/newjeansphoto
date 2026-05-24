# NewJeans Random Photo Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A click-to-shuffle photo viewer that pulls random images of all five NewJeans members from {minji,hanni,danielle,haerin,hyein}.network, with a per-member filter, deployed as static files to GitHub Pages with a weekly cron that keeps the photo list fresh.

**Architecture:** Pure static frontend (`index.html` + `app.js` + `styles.css`) reads a checked-in `manifest.json` listing every photo's `{member, hash, extension}` triple, then renders one random photo at a time directly from the public CDN (`https://static.newjeans.network/{member}/{hash}.{ext}`). A Node script (`scripts/build-manifest.mjs`) regenerates the manifest by scraping each member site's paginated HTML — run locally on demand, and on a weekly cron via GitHub Actions which commits changes back to the repo. A second GitHub Actions workflow deploys the site to GitHub Pages on every push to `main`.

**Tech Stack:** Vanilla HTML/CSS/JS (no build, no framework), Node 20+ for the manifest builder (built-in `fetch`, no npm deps), GitHub Actions for cron + Pages deploy.

---

## Context

The user wants a single-page site that displays one random NewJeans member photo at a time, with a click/space-bar advancing to the next photo and toggles to include/exclude each member from the random pool. Source photos live on five fan sites — `minji.network`, `hanni.network`, `danielle.network`, `haerin.network`, `hyein.network` — but those sites' listing HTML is not CORS-enabled, so the browser cannot fetch listings cross-origin at click-time. The photo CDN itself (`static.newjeans.network`) **is** CORS-enabled, so once we know a photo's `{member, hash, ext}` we can render it directly.

The solution is to bake a manifest of every photo into the static site (refreshed periodically) and let the browser pick random entries from it. This keeps the runtime fully static (GitHub Pages compatible) and avoids any backend.

## How the source sites work (verified)

Each member site is a SvelteKit app where every gallery page (`/?page=N`) returns SSR'd HTML containing an inline script:

```html
<script>__sveltekit_xxx.resolve(1, () => [{data:[
  {hash:"<sha256-hex>", extension:"jpg", width:..., height:..., is_pinned:false, tags:[]},
  ... (20 entries per page) ...
], total_pages: <N>}])</script>
```

Constants from the SvelteKit chunk `BiLoYqiZ.js`:
- CDN host: `static.newjeans.network`
- Photo URL: `https://static.newjeans.network/{member}/{hash}.{extension}`

Per-member `total_pages` (as of 2026-05-24): minji 2891, haerin 1009, hanni 200, danielle 146, hyein 91 — roughly 87,000 photos total across 4,337 listing pages.

## File Structure

Repository layout (all paths repo-root-relative):

| Path | Purpose |
|---|---|
| `index.html` | Single-page viewer markup. |
| `styles.css` | All styles. Centered photo, filter chips, minimal chrome. |
| `app.js` | Loads manifest, manages member filter (localStorage), handles click/keyboard, preloads next photo, swaps `<img>`. |
| `manifest.json` | Checked-in. Compact: `{generatedAt, cdn, members:[…], extensions:[…], photos:[[m,e,hash],…]}`. |
| `scripts/build-manifest.mjs` | Node 20+ script: crawls all 5 sites, writes `manifest.json`. Uses only built-in `fetch`. |
| `.github/workflows/refresh-manifest.yml` | Weekly cron + `workflow_dispatch`. Runs the builder, commits if changed. |
| `.github/workflows/deploy.yml` | Deploys to GitHub Pages on push to `main`. |
| `README.md` | One-paragraph description + run/deploy instructions. |
| `.gitignore` | `node_modules/`, `.DS_Store`. |

## Manifest format

Compact, indexed, gzip-friendly:

```json
{
  "generatedAt": "2026-05-24T07:30:00Z",
  "cdn": "https://static.newjeans.network",
  "members": ["minji", "hanni", "danielle", "haerin", "hyein"],
  "extensions": ["jpg", "jpeg", "png", "webp", "avif", "gif"],
  "photos": [
    [0, 0, "d36305a259dbb5d268ad550dc836a484350ca168f34e963cfa54a47a5c8d888b"],
    [3, 0, "fb2870924ebaa1c356dc08f06f8d274cb7be10578e5e2f3a16b2238ad05e60b5"]
  ]
}
```

Each `photos` entry: `[memberIndex, extensionIndex, hashHex]`. Photo URL is built as `${cdn}/${members[m]}/${hash}.${extensions[e]}`. Raw ~7MB, gzipped ~1.5–2MB.

---

## Task 1: Repo skeleton + viewer markup and styles

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Initialize git repo and write `.gitignore`**

```bash
git init
```

`.gitignore`:
```
node_modules/
.DS_Store
```

- [ ] **Step 2: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NewJeans Random</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main id="viewer">
    <div id="photo-wrap">
      <img id="photo" alt="" />
      <div id="status" aria-live="polite"></div>
    </div>
    <footer id="controls">
      <div id="member-label"></div>
      <fieldset id="filters" aria-label="Members included in random pool">
        <label><input type="checkbox" data-member="minji" checked> Minji</label>
        <label><input type="checkbox" data-member="hanni" checked> Hanni</label>
        <label><input type="checkbox" data-member="danielle" checked> Danielle</label>
        <label><input type="checkbox" data-member="haerin" checked> Haerin</label>
        <label><input type="checkbox" data-member="hyein" checked> Hyein</label>
      </fieldset>
      <button id="shuffle" type="button">Shuffle (Space)</button>
    </footer>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `styles.css`**

Dark background, photo `object-fit: contain`, fills viewport above controls. Filter chips along the bottom. Keep it under ~80 lines.

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #0b0b0d; color: #eaeaea;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
#viewer { display: flex; flex-direction: column; height: 100vh; }
#photo-wrap { flex: 1; min-height: 0; display: grid; place-items: center;
  cursor: pointer; user-select: none; position: relative; }
#photo { max-width: 100%; max-height: 100%; object-fit: contain; display: block;
  opacity: 0; transition: opacity 200ms ease; }
#photo.loaded { opacity: 1; }
#status { position: absolute; bottom: 12px; right: 12px;
  background: rgba(0,0,0,.55); padding: 4px 8px; border-radius: 6px;
  font-size: 12px; opacity: 0; transition: opacity 200ms; }
#status.visible { opacity: 1; }
#controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  padding: 10px 14px; background: #111; border-top: 1px solid #1f1f23; }
#member-label { font-weight: 600; min-width: 90px; }
#filters { border: 0; padding: 0; margin: 0; display: flex; gap: 10px;
  flex-wrap: wrap; }
#filters label { display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: 1px solid #2a2a30; border-radius: 999px;
  cursor: pointer; }
#filters input { accent-color: #c7a3ff; }
#shuffle { margin-left: auto; padding: 6px 14px; background: #c7a3ff;
  color: #111; border: 0; border-radius: 999px; font-weight: 600;
  cursor: pointer; }
```

- [ ] **Step 4: Write `README.md`**

One paragraph: what it is, how to run locally (`python3 -m http.server`), how to refresh (`node scripts/build-manifest.mjs`), how to deploy (push to `main`).

- [ ] **Step 5: Verify the page loads in a browser**

```bash
python3 -m http.server 8000
# Open http://localhost:8000 — page should render with empty photo and 5 checked filter chips.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore index.html styles.css README.md
git commit -m "scaffold: viewer markup, styles, repo skeleton"
```

---

## Task 2: Manifest builder script

**Files:**
- Create: `scripts/build-manifest.mjs`

- [ ] **Step 1: Write `scripts/build-manifest.mjs`**

Standalone Node 20+ script (no dependencies). For each member: fetch `/` to read `total_pages`, then fetch each `/?page=N` with bounded concurrency (e.g. 6 in flight), extract the inline `__sveltekit_*.resolve(1, () => [{data:[…], total_pages:…}])` payload via regex, push each `{hash, extension}` into the member's list. After all members complete, write `manifest.json` with `{generatedAt, cdn:"https://static.newjeans.network", members, extensions, photos:[[m,e,hash],…]}`. Deduplicate by `(member, hash)` defensively. Log progress to stderr.

Key regex: `/__sveltekit_[a-z0-9]+\.resolve\(\s*1\s*,\s*\(\)\s*=>\s*\[(\{[\s\S]*?\})\]\)/`. Inside the captured object, JSON5-ish — use `Function('return (' + body + ')')()` with care, or extract just the `data: [...]` array with a narrower regex like `/data:\s*(\[[\s\S]*?\])/` and `JSON.parse` after normalizing unquoted keys with a small sed-style replace. Prefer the second approach because the embedded object uses unquoted keys.

Concrete extractor (paste in script):

```js
function extractPhotos(html) {
  const m = html.match(/__sveltekit_[a-z0-9]+\.resolve\(\s*1\s*,\s*\(\)\s*=>\s*\[\s*(\{[\s\S]*?\})\s*\]\)/);
  if (!m) throw new Error("no embedded gallery payload");
  // Unquoted-key JSON → normalize then parse.
  const normalized = m[1].replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  const obj = JSON.parse(normalized);
  return { items: obj.data, totalPages: obj.total_pages };
}
```

Rate-limit politely: cap concurrency at 6, add a small jitter (50–150ms) between batches, retry transient 5xx up to 3 times with backoff. Set a custom `User-Agent: newjeans-random-viewer/1.0 (+https://github.com/<user>/<repo>)`.

Output format exactly as in the Manifest format section above. Sort `photos` by member then hash for deterministic diffs.

- [ ] **Step 2: Smoke-test against one member, one page**

Run with a tiny override (env var `LIMIT_PAGES=2 LIMIT_MEMBERS=hyein`) — the script should produce a `manifest.json` with ~40 entries for hyein only.

```bash
LIMIT_PAGES=2 LIMIT_MEMBERS=hyein node scripts/build-manifest.mjs
cat manifest.json | head -c 500
```

Expected: valid JSON, `members` contains all five, `photos` has ~40 entries all with `m=4` (hyein's index).

- [ ] **Step 3: Run the full builder**

```bash
node scripts/build-manifest.mjs
```

Expected: takes 5–15 min, prints progress per member, ends with `wrote manifest.json (XX,XXX photos, X.XMB)`. Sanity-check the file:

```bash
node -e "const m = require('./manifest.json'); console.log({photos: m.photos.length, byMember: m.members.map((n,i)=>[n, m.photos.filter(p=>p[0]===i).length])})"
```

Expected: roughly `minji ~57000, haerin ~20000, hanni ~4000, danielle ~2900, hyein ~1800`.

- [ ] **Step 4: Commit (script + initial manifest)**

```bash
git add scripts/build-manifest.mjs manifest.json
git commit -m "feat: manifest builder + initial manifest of ~87k photos"
```

---

## Task 3: Viewer logic (random pick, filter, preload)

**Files:**
- Create: `app.js`

- [ ] **Step 1: Write `app.js`**

ES module, no dependencies. Responsibilities:

1. `fetch('./manifest.json')` once.
2. Build per-member index arrays so filtering is O(1) sampling: `indexByMember = manifest.members.map((_, i) => manifest.photos.flatMap((p, j) => p[0] === i ? [j] : []))`. (Memory: ~700k numbers, ~5MB — fine. If profiling shows pressure, switch to `Uint32Array` per member.)
3. Read enabled-member set from `localStorage['enabled']` (default: all five). Wire each checkbox: on change, update set, persist, and call `rebuildPool()` which concatenates the enabled members' index arrays into one `Uint32Array` `pool`.
4. `nextPhoto()`: pick `pool[Math.floor(Math.random() * pool.length)]`, look up `[m,e,hash]`, build URL `${manifest.cdn}/${members[m]}/${hash}.${extensions[e]}`, set `<img>.src`. On `load`, add `.loaded` class. On `error`, log + retry up to 3 times with a different random pick. Update `#member-label` and the `#status` chip with a brief flash.
5. Preload: after each successful load, generate the next candidate URL and create an off-DOM `Image()` with that `src` so the browser caches it; remember it so the next click consumes the preload.
6. Input bindings: click on `#photo-wrap`, `Space` and `ArrowRight` keys (ignore when focus is in `<input>`), `#shuffle` button — all call `nextPhoto()`.
7. Edge case: if pool is empty (user unchecked everything), disable shuffle, show "Select at least one member."

Skeleton:

```js
const els = {
  img: document.getElementById('photo'),
  status: document.getElementById('status'),
  label: document.getElementById('member-label'),
  shuffle: document.getElementById('shuffle'),
  wrap: document.getElementById('photo-wrap'),
  filters: document.querySelectorAll('#filters input'),
};

let manifest, indexByMember, pool = new Uint32Array(0), preloaded = null;

const STORAGE_KEY = 'newjeans-random:enabled';

function loadEnabled(members) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return new Set(saved.filter(m => members.includes(m)));
  } catch {}
  return new Set(members);
}

function saveEnabled(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

function buildIndex() {
  indexByMember = manifest.members.map(() => []);
  for (let j = 0; j < manifest.photos.length; j++) {
    indexByMember[manifest.photos[j][0]].push(j);
  }
  indexByMember = indexByMember.map(arr => Uint32Array.from(arr));
}

function rebuildPool(enabled) {
  let total = 0;
  for (let i = 0; i < manifest.members.length; i++)
    if (enabled.has(manifest.members[i])) total += indexByMember[i].length;
  pool = new Uint32Array(total);
  let o = 0;
  for (let i = 0; i < manifest.members.length; i++) {
    if (!enabled.has(manifest.members[i])) continue;
    pool.set(indexByMember[i], o);
    o += indexByMember[i].length;
  }
  els.shuffle.disabled = pool.length === 0;
}

function urlFor(idx) {
  const [m, e, hash] = manifest.photos[idx];
  return `${manifest.cdn}/${manifest.members[m]}/${hash}.${manifest.extensions[e]}`;
}

function pickRandom() {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function flashStatus(text) {
  els.status.textContent = text;
  els.status.classList.add('visible');
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => els.status.classList.remove('visible'), 1200);
}

async function showPhoto(idx, attemptsLeft = 3) {
  if (idx == null) {
    els.img.removeAttribute('src');
    els.label.textContent = 'Select at least one member';
    return;
  }
  const [m] = manifest.photos[idx];
  const url = urlFor(idx);
  els.img.classList.remove('loaded');
  els.img.onload = () => {
    els.img.classList.add('loaded');
    els.label.textContent = manifest.members[m];
    flashStatus(`${manifest.members[m]}`);
    // Preload next.
    const nextIdx = pickRandom();
    if (nextIdx != null) {
      const i = new Image();
      i.src = urlFor(nextIdx);
      preloaded = { idx: nextIdx, image: i };
    }
  };
  els.img.onerror = () => {
    if (attemptsLeft > 0) showPhoto(pickRandom(), attemptsLeft - 1);
    else flashStatus('failed to load');
  };
  els.img.src = url;
}

function nextPhoto() {
  if (preloaded) {
    const idx = preloaded.idx;
    preloaded = null;
    showPhoto(idx);
  } else {
    showPhoto(pickRandom());
  }
}

(async function init() {
  manifest = await fetch('./manifest.json').then(r => r.json());
  buildIndex();
  const enabled = loadEnabled(manifest.members);
  for (const cb of els.filters) {
    cb.checked = enabled.has(cb.dataset.member);
    cb.addEventListener('change', () => {
      cb.checked ? enabled.add(cb.dataset.member) : enabled.delete(cb.dataset.member);
      saveEnabled(enabled);
      rebuildPool(enabled);
    });
  }
  rebuildPool(enabled);
  els.wrap.addEventListener('click', nextPhoto);
  els.shuffle.addEventListener('click', nextPhoto);
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); nextPhoto(); }
  });
  nextPhoto();
})();
```

- [ ] **Step 2: Manual test in browser**

```bash
python3 -m http.server 8000
# Open http://localhost:8000.
```

Verify in order:
1. A photo appears within ~3 seconds.
2. Clicking the photo, pressing Space, and pressing Right Arrow each load a new photo.
3. The label updates to the correct member name on each shuffle.
4. Unchecking a member and shuffling several times never shows that member.
5. Reloading the page preserves the filter selection.
6. Unchecking all five disables the Shuffle button and shows the "select at least one" message.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: random photo viewer with member filter and preload"
```

---

## Task 4: GitHub Actions — weekly manifest refresh

**Files:**
- Create: `.github/workflows/refresh-manifest.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Refresh manifest

on:
  schedule:
    - cron: '17 6 * * 1'   # Mondays 06:17 UTC
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Build manifest
        run: node scripts/build-manifest.mjs
      - name: Commit if changed
        run: |
          if git diff --quiet -- manifest.json; then
            echo "manifest unchanged"
            exit 0
          fi
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add manifest.json
          git commit -m "chore: refresh manifest ($(date -u +%Y-%m-%d))"
          git push
```

- [ ] **Step 2: Push, then trigger manually to verify**

After pushing to GitHub:

```bash
gh workflow run "Refresh manifest"
gh run watch
```

Expected: job succeeds. Either commits a refreshed manifest (if photos changed upstream) or logs "manifest unchanged".

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh-manifest.yml
git commit -m "ci: weekly cron to refresh photo manifest"
```

---

## Task 5: GitHub Actions — Pages deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write the deploy workflow**

```yaml
name: Deploy to Pages

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Enable Pages in repo settings (one-time)**

In the GitHub repo: Settings → Pages → Source: "GitHub Actions".

- [ ] **Step 3: Push and verify deploy**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy static viewer to GitHub Pages"
git push
gh run watch
```

Expected: workflow succeeds, prints a `https://<user>.github.io/<repo>/` URL. Open it — viewer loads, photos shuffle.

- [ ] **Step 4: End-to-end manual verification on the deployed site**

On the live URL:
1. First load completes (manifest fetch < 3 s on broadband).
2. Photos load directly from `static.newjeans.network` (check DevTools Network tab).
3. Member filter persists across page reloads.
4. Keyboard shortcuts work.

---

## Verification

After all five tasks:

- [ ] **Local smoke test**

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Confirm: a photo appears, Space/click/arrow advance to a new photo, each of the five filter chips can be toggled and the change persists across reload, unchecking all disables Shuffle.

- [ ] **Manifest integrity**

```bash
node -e "
const m = require('./manifest.json');
console.assert(m.members.length === 5, 'members');
console.assert(m.photos.length > 50000, 'photo count seems low');
const sample = m.photos[0];
console.assert(/^[a-f0-9]{64}$/.test(sample[2]), 'hash is sha256 hex');
console.log('OK', m.photos.length, 'photos');
"
```

- [ ] **Deployed site reachable**

```bash
gh run list --workflow=deploy.yml --limit 1
```

Last run is green; open the deployed URL and shuffle through ~10 photos to confirm no broken images.

- [ ] **Cron is scheduled**

```bash
gh workflow list
```

`Refresh manifest` is listed and enabled.
