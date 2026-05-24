const els = {
  img: document.getElementById('photo'),
  status: document.getElementById('status'),
  label: document.getElementById('member-label'),
  shuffle: document.getElementById('shuffle'),
  wrap: document.getElementById('photo-wrap'),
  filters: document.querySelectorAll('#filters input'),
};

const STORAGE_KEY = 'newjeans-random:enabled';

let manifest;
let indexByMember;
let pool = new Uint32Array(0);
let preloaded = null;
let currentToken = 0;

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
  const buckets = manifest.members.map(() => []);
  for (let j = 0; j < manifest.photos.length; j++) {
    buckets[manifest.photos[j][0]].push(j);
  }
  indexByMember = buckets.map(arr => Uint32Array.from(arr));
}

function rebuildPool(enabled) {
  let total = 0;
  for (let i = 0; i < manifest.members.length; i++) {
    if (enabled.has(manifest.members[i])) total += indexByMember[i].length;
  }
  pool = new Uint32Array(total);
  let o = 0;
  for (let i = 0; i < manifest.members.length; i++) {
    if (!enabled.has(manifest.members[i])) continue;
    pool.set(indexByMember[i], o);
    o += indexByMember[i].length;
  }
  preloaded = null;
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

function showPhoto(idx, attemptsLeft = 3) {
  const token = ++currentToken;
  if (idx == null) {
    els.img.removeAttribute('src');
    els.img.classList.remove('loaded');
    els.label.textContent = manifest.photos.length === 0
      ? 'Manifest is empty — run scripts/build-manifest.mjs'
      : 'Select at least one member';
    return;
  }
  const [m] = manifest.photos[idx];
  const url = urlFor(idx);
  els.img.classList.remove('loaded');
  els.img.onload = () => {
    if (token !== currentToken) return;
    els.img.classList.add('loaded');
    els.label.textContent = manifest.members[m];
    flashStatus(manifest.members[m]);
    const nextIdx = pickRandom();
    if (nextIdx != null) {
      const img = new Image();
      img.src = urlFor(nextIdx);
      preloaded = { idx: nextIdx, image: img };
    }
  };
  els.img.onerror = () => {
    if (token !== currentToken) return;
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
  try {
    manifest = await fetch('./manifest.json').then(r => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      return r.json();
    });
  } catch (err) {
    els.label.textContent = 'Failed to load manifest';
    console.error(err);
    return;
  }
  buildIndex();
  const enabled = loadEnabled(manifest.members);
  for (const cb of els.filters) {
    cb.checked = enabled.has(cb.dataset.member);
    cb.addEventListener('change', () => {
      if (cb.checked) enabled.add(cb.dataset.member);
      else enabled.delete(cb.dataset.member);
      saveEnabled(enabled);
      rebuildPool(enabled);
    });
  }
  rebuildPool(enabled);
  els.wrap.addEventListener('click', nextPhoto);
  els.shuffle.addEventListener('click', (e) => { e.stopPropagation(); nextPhoto(); });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space' || e.code === 'ArrowRight') {
      e.preventDefault();
      nextPhoto();
    }
  });
  nextPhoto();
})();
