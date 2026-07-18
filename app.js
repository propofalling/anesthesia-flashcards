/* TrueLearn ITE Flashcards — app logic
   Phase 1: static PWA, per-device progress in localStorage.
   (Phase 3 will swap the `store` module for a synced backend.) */
'use strict';

/* ============================ data ============================ */
let DATA = null;          // {generated,count,subdecks,cards}
let CARDS = [];           // array
let BYID = {};            // id -> card
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

async function loadData() {
  const res = await fetch('data/cards.json', { cache: 'no-cache' });
  DATA = await res.json();
  CARDS = DATA.cards;
  BYID = {};
  for (const c of CARDS) BYID[c.id] = c;
}

/* ==================== text highlighting (ported from build_deck.py) ==================== */
const WARN = new Set(["NOT","AVOID","AVOIDING","NEVER","CONTRAINDICATED","STOP","FIRE","CRISIS",
  "RUPTURE","FATAL","LETHAL","DANGER","REFUSE","EMERGENCY","BLACK"]);
const KEY_SHORT = new Set(["AND","BOTH","LAST","FIRST","RIGHT","LEFT","ONLY","MOST","MORE","HIGH","LOW",
  "SAME","INTO","FAST","LATE","RARE","SAFE","MEAN","ABOVE","BELOW","AFTER","BEFORE","EXCEPT","PLUS",
  "START","THREE","SECOND","OUT","RED","HOLD","HELD","SET","FALLS","FAIL","LESS","HELP","KEEP","WIDE",
  "DEEP","COLD","WARM","NEW"]);
const EXCLUDE = new Set(["ANOVA","AUROC","CONSORT","HIPAA","IHAST","NACOR","NICHD","NIOSH","POCUS",
  "PROPPR","PROSEVA","ROTEM","VACTERL","TEFRA","TOLAC","TEVAR","SIADH","DMAIC","STEMI","NSTEMI",
  "TRALI","PADSS","SBAR","ERAS","ERAC"]);
const VOW = new Set(["A","E","I","O","U"]);

function classify(tok) {
  if (EXCLUDE.has(tok)) return null;
  if (WARN.has(tok)) return 'warn';
  if (KEY_SHORT.has(tok)) return 'key';
  let v = 0; for (const ch of tok) if (VOW.has(ch)) v++;
  if (tok.length >= 5 && v >= 2) return 'key';
  return null;
}
const CAPS_RE = /\b[A-Z][A-Z0-9]{2,}\b/g;
const UNIT = "(?:mmHg|cmH2O|mL\\/kg\\/h|mL\\/kg|mL\\/min|mL|L\\/min|L|mcg\\/kg|mg\\/kg|mcg|µg|mg|kg|g\\/dL|" +
  "mEq\\/L|mEq|mmol\\/L|mmol|mOsm\\/kg|mOsm|nmol\\/L|nmol|bpm|MHz|Hz|kPa|psi|mA|µA|nm|cm|mm|" +
  "weeks|week|wk|hours|hour|hrs|hr|min|sec|days|day|%|°C|J)";
const NUM_RE = new RegExp("(~?\\s?\\d[\\d.,\\u2013\\u2212/\\sx×·-]*\\s?" + UNIT + ")", "g");
const ITAL_RE = /\*([^*]+)\*/g;

function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderText(t) {
  if (!t) return '';
  t = esc(t);
  t = t.replace(ITAL_RE, '<i>$1</i>');
  t = t.replace(NUM_RE, m => `<span class="hl-num">${m}</span>`);
  t = t.replace(CAPS_RE, w => {
    const c = classify(w);
    if (c === 'warn') return `<span class="hl-warn">${w}</span>`;
    if (c === 'key') return `<span class="hl-key">${w}</span>`;
    return w;
  });
  return t;
}
function stripOl(t) { t = (t || '').trim(); if (t.startsWith('*') && t.endsWith('*')) t = t.slice(1, -1); return t.trim(); }

/* ============================ settings + SRS store ============================ */
const LS_PROG = 'tl_srs_v1';       // { [cardId]: {ease,interval,reps,due,lapses,last} }
const LS_SET = 'tl_settings_v1';   // { newPerDay }
const LS_NEW = 'tl_newlog_v1';     // { date: 'YYYY-MM-DD', introduced: n }
const DAY = 86400000;

const settings = Object.assign({ newPerDay: 20 }, readJSON(LS_SET, {}));
function saveSettings() { writeJSON(LS_SET, settings); }

const store = {
  all() { return readJSON(LS_PROG, {}); },
  get(id) { return this.all()[id] || null; },
  set(id, st) { const a = this.all(); a[id] = st; writeJSON(LS_PROG, a); },
};
function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function writeJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function todayStr() { return new Date().toISOString().slice(0, 10); }
function newLog() {
  let l = readJSON(LS_NEW, null);
  if (!l || l.date !== todayStr()) { l = { date: todayStr(), introduced: 0 }; writeJSON(LS_NEW, l); }
  return l;
}
function newRemaining() { return Math.max(0, settings.newPerDay - newLog().introduced); }
function bumpNew(n) { const l = newLog(); l.introduced += n; writeJSON(LS_NEW, l); }

/* ---- SM-2 scheduling ---- */
// grade: 0 Again, 1 Hard, 2 Good, 3 Easy
function schedule(card, grade) {
  const now = Date.now();
  let st = store.get(card.id) || { ease: 2.5, interval: 0, reps: 0, due: now, lapses: 0 };
  const isNew = st.reps === 0 && !st.seen;
  st.seen = true;
  if (grade === 0) {                       // Again
    st.reps = 0; st.lapses = (st.lapses || 0) + 1;
    st.ease = Math.max(1.3, st.ease - 0.2);
    st.interval = 0; st.due = now + 8 * 60000;          // ~8 min, same session
  } else if (grade === 1) {                // Hard
    st.ease = Math.max(1.3, st.ease - 0.15);
    st.interval = st.interval < 1 ? 1 : Math.max(1, Math.round(st.interval * 1.2));
    st.reps += 1; st.due = now + st.interval * DAY;
  } else if (grade === 2) {                // Good
    if (st.reps === 0) st.interval = 1;
    else if (st.reps === 1) st.interval = 3;
    else st.interval = Math.max(1, Math.round(st.interval * st.ease));
    st.reps += 1; st.due = now + st.interval * DAY;
  } else {                                 // Easy
    st.ease = st.ease + 0.15;
    if (st.reps === 0) st.interval = 4;
    else st.interval = Math.max(1, Math.round(st.interval * st.ease * 1.3));
    st.reps += 1; st.due = now + st.interval * DAY;
  }
  st.last = now;
  store.set(card.id, st);
  return { st, isNew };
}
function intervalLabel(card, grade) {
  const st = store.get(card.id) || { ease: 2.5, interval: 0, reps: 0 };
  if (grade === 0) return '8m';
  let iv;
  if (grade === 1) iv = st.interval < 1 ? 1 : Math.max(1, Math.round(st.interval * 1.2));
  else if (grade === 2) iv = st.reps === 0 ? 1 : st.reps === 1 ? 3 : Math.max(1, Math.round(st.interval * st.ease));
  else iv = st.reps === 0 ? 4 : Math.max(1, Math.round(st.interval * (st.ease + 0.15) * 1.3));
  return iv >= 30 ? Math.round(iv / 30) + 'mo' : iv + 'd';
}

/* ---- queue building ---- */
function deckCards(key) { return key === 'ALL' ? CARDS : CARDS.filter(c => c.domain === key); }
function dueCount(key) {
  const now = Date.now();
  return deckCards(key).filter(c => { const s = store.get(c.id); return s && s.seen && s.due <= now; }).length;
}
function newCount(key) { return deckCards(key).filter(c => { const s = store.get(c.id); return !s || !s.seen; }).length; }

// Build a session queue: due (learning+review) first, then up to newRemaining new cards.
function buildQueue(key) {
  const now = Date.now();
  const pool = deckCards(key);
  const due = pool.filter(c => { const s = store.get(c.id); return s && s.seen && s.due <= now; })
    .sort((a, b) => store.get(a.id).due - store.get(b.id).due);
  let budget = newRemaining();
  const fresh = [];
  for (const c of pool) { if (budget <= 0) break; const s = store.get(c.id); if (!s || !s.seen) { fresh.push(c); budget--; } }
  return { due, fresh };
}

/* ============================ router / views ============================ */
const app = $('#app');
let VIEW = { name: 'home' };

function go(view) { VIEW = view; render(); window.scrollTo(0, 0); }

function render() {
  if (VIEW.name === 'home') return renderHome();
  if (VIEW.name === 'study') return renderStudy();
  if (VIEW.name === 'search') return renderSearch();
  if (VIEW.name === 'browse') return renderBrowseCard();
  if (VIEW.name === 'settings') return renderSettings();
}

function setBar(title, back) {
  $('#bartitle').textContent = title;
  const b = $('#backbtn');
  if (back) { b.classList.remove('hidden'); b.onclick = back; } else b.classList.add('hidden');
}

/* ---------- HOME ---------- */
function renderHome() {
  setBar('ITE Flashcards', null);
  const totalDue = dueCount('ALL'), remNew = Math.min(newRemaining(), newCount('ALL'));
  let h = `
    <div class="searchbar">
      <input id="q" type="search" placeholder="Search ${DATA.count} cards…" autocomplete="off">
    </div>
    <button class="study-all" id="studyall">
      <div>
        <div class="big">Study All</div>
        <div class="sub">${DATA.count} cards · ${DATA.subdecks.length} topics</div>
      </div>
      <div class="duepill">
        <div class="pill ${totalDue || remNew ? 'due' : 'zero'}">${totalDue} due${remNew ? ' · +' + remNew + ' new' : ''}</div>
      </div>
    </button>
    <div class="section-label">Subdecks</div>
    <div class="grid">`;
  for (const s of DATA.subdecks) {
    const d = dueCount(s.key);
    h += `<button class="deckcard" style="--dc:${s.color}" data-key="${s.key}">
        ${d ? `<span class="duebadge">${d}</span>` : ''}
        <span class="label">${esc(s.label)}</span>
        <span class="meta">${s.count} cards</span>
      </button>`;
  }
  h += `</div><div class="foot">Progress saved on this device · ${DATA.count} cards · updated ${new Date(DATA.generated).toLocaleDateString()}</div>`;
  app.innerHTML = h;

  $('#studyall').onclick = () => startStudy('ALL');
  $$('.deckcard').forEach(b => b.onclick = () => startStudy(b.dataset.key));
  const q = $('#q');
  q.oninput = () => { if (q.value.trim()) go({ name: 'search', q: q.value }); };
}

/* ---------- STUDY ---------- */
let SESSION = null;   // {key,label,queue:[cards],idx,flipped,done,total}

function startStudy(key) {
  const label = key === 'ALL' ? 'All cards' : (DATA.subdecks.find(s => s.key === key) || {}).label;
  const { due, fresh } = buildQueue(key);
  const queue = due.concat(fresh);
  SESSION = { key, label, queue, idx: 0, flipped: false, total: queue.length, done: 0, newCount: fresh.length };
  go({ name: 'study' });
}

function renderStudy() {
  if (!SESSION) return go({ name: 'home' });
  setBar(SESSION.label, () => go({ name: 'home' }));

  if (SESSION.idx >= SESSION.queue.length) return renderDone();
  const card = SESSION.queue[SESSION.idx];
  const st = store.get(card.id);
  const tag = (!st || !st.seen) ? 'new' : (st.reps <= 1 || st.interval < 1 ? 'learning' : 'review');
  const pct = SESSION.total ? Math.round((SESSION.done / SESSION.total) * 100) : 0;
  const color = subColor(card.domain);

  let h = `<div class="study-meta">
      <span>${SESSION.done}/${SESSION.total}</span>
      <div class="progressbar"><i style="width:${pct}%"></i></div>
      <span style="text-transform:capitalize">${tag}</span>
    </div>
    <div class="card">
      <div class="card-top" style="--dc:${color}">
        <div class="card-cat">${esc(card.cat || subLabel(card.domain))}</div>
        <div class="card-title">${renderText(card.title)}</div>
      </div>`;

  if (!SESSION.flipped) {
    h += `<div class="tap-hint">Recall everything you can, then reveal · <kbd>space</kbd></div></div>
      <button class="flip-cta" id="flip">Show answer</button>`;
    app.innerHTML = h;
    $('#flip').onclick = flip;
  } else {
    h += `<div class="card-body">${renderCardBody(card)}</div></div>`;
    h += `<div class="grades">
        ${gradeBtn(0, 'Again', card)}${gradeBtn(1, 'Hard', card)}${gradeBtn(2, 'Good', card)}${gradeBtn(3, 'Easy', card)}
      </div>`;
    app.innerHTML = h;
    $$('.grade').forEach(b => b.onclick = () => grade(parseInt(b.dataset.g, 10)));
  }
}
function gradeBtn(g, lab, card) {
  const cls = ['again', 'hard', 'good', 'easy'][g];
  return `<button class="grade ${cls}" data-g="${g}">${lab}<small>${intervalLabel(card, g)}</small></button>`;
}
function flip() { SESSION.flipped = true; renderStudy(); }
function grade(g) {
  const card = SESSION.queue[SESSION.idx];
  const st = store.get(card.id);
  const wasNew = !st || !st.seen;
  const { } = schedule(card, g);
  if (wasNew) bumpNew(1);
  // If "Again", requeue near the end of this session so it comes back.
  if (g === 0) SESSION.queue.push(card); else SESSION.done++;
  SESSION.idx++;
  SESSION.flipped = false;
  renderStudy();
}
function renderDone() {
  setBar(SESSION.label, () => go({ name: 'home' }));
  const moreDue = dueCount(SESSION.key), moreNew = Math.min(newRemaining(), newCount(SESSION.key));
  app.innerHTML = `<div class="done">
      <div class="em">✅</div>
      <h2>Session complete</h2>
      <p>Reviewed ${SESSION.done} card${SESSION.done === 1 ? '' : 's'} in ${esc(SESSION.label)}.</p>
      ${(moreDue || moreNew) ? `<button class="flip-cta" id="again" style="position:static;max-width:320px;margin:18px auto 0">Continue — ${moreDue} due${moreNew ? ', +' + moreNew + ' new' : ''}</button>` : `<p style="margin-top:16px">Nothing left due here. 🎉</p>`}
      <div style="margin-top:18px"><button class="iconbtn" id="home2">Back to home</button></div>
    </div>`;
  const a = $('#again'); if (a) a.onclick = () => startStudy(SESSION.key);
  $('#home2').onclick = () => go({ name: 'home' });
}

/* ---------- card body rendering ---------- */
function renderCardBody(card) {
  let h = '';
  // Equation card
  if (card.equation) {
    if (card.img) h += `<img class="eqimg" src="${card.img}" alt="${esc(card.title)}">`;
    if (card.normal) h += `<div class="eq-normal">${renderText(card.normal)}</div>`;
    if (card.expl) h += `<div class="sec"><span class="sec-h con">What it means</span><div class="sec-t">${renderText(card.expl)}</div></div>`;
    if (card.clinical && card.clinical.length) {
      h += `<div class="sec"><span class="sec-h clin">Clinical use</span><ul class="clin">`;
      for (const c of card.clinical) h += `<li>${renderText(c)}</li>`;
      h += `</ul></div>`;
    }
    return h + tablesHTML(card);
  }
  // Note-card figures (above sections)
  for (const ni of card.noteimg || []) {
    if (ni.path) { h += `<img class="notefig" src="${ni.path}" alt="figure">`; if (ni.cap) h += `<div class="figcap">${esc(ni.cap)}</div>`; }
  }
  // Sections; last section (High-yield one-liner) => KEY box
  const secs = card.secs || [];
  secs.forEach((sec, i) => {
    const [header, text, kind] = sec;
    const isKey = i === secs.length - 1 && /one-liner/i.test(header);
    if (isKey) {
      h += `<div class="key"><span class="sec-h">${esc(header)}</span><div class="sec-t">${renderText(stripOl(text))}</div></div>`;
    } else {
      h += `<div class="sec"><span class="sec-h ${kind || 'con'}">${esc(header)}</span><div class="sec-t">${renderText(text)}</div></div>`;
    }
  });
  return h + tablesHTML(card);
}
function tablesHTML(card) {
  let h = '';
  for (const t of card.tables || []) {
    if (!t || !t.rows) continue;
    h += `<table class="reftab">`;
    if (t.cap) h += `<caption>${esc(t.cap)}</caption>`;
    if (t.head) { h += '<thead><tr>'; for (const c of t.head) h += `<th>${renderText(String(c))}</th>`; h += '</tr></thead>'; }
    h += '<tbody>';
    for (const row of t.rows) { h += '<tr>'; for (const cell of row) h += `<td>${renderText(String(cell))}</td>`; h += '</tr>'; }
    h += '</tbody></table>';
    if (t.note) h += `<div class="tabnote">${renderText(t.note)}</div>`;
  }
  return h;
}

/* ---------- SEARCH ---------- */
function renderSearch() {
  setBar('Search', () => go({ name: 'home' }));
  const qv = VIEW.q || '';
  let h = `<div class="searchbar"><input id="q" type="search" placeholder="Search ${DATA.count} cards…" value="${esc(qv)}"></div><div id="results"></div>`;
  app.innerHTML = h;
  const q = $('#q');
  q.focus(); q.setSelectionRange(qv.length, qv.length);
  const run = () => { VIEW.q = q.value; renderResults(q.value); };
  q.oninput = run; run();
}
function renderResults(query) {
  const box = $('#results');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) { box.innerHTML = `<div class="empty">Type to search titles and card text.</div>`; return; }
  const hits = [];
  for (const c of CARDS) {
    const hay = (c.title + ' ' + (c.cat || '') + ' ' + (c.secs || []).map(s => s[0] + ' ' + s[1]).join(' ') +
      ' ' + (c.expl || '') + ' ' + (c.normal || '') + ' ' + (c.clinical || []).join(' ')).toLowerCase();
    if (terms.every(t => hay.includes(t))) {
      const titleHit = terms.every(t => c.title.toLowerCase().includes(t));
      hits.push({ c, score: titleHit ? 0 : 1 });
    }
    if (hits.length > 400) break;
  }
  hits.sort((a, b) => a.score - b.score);
  if (!hits.length) { box.innerHTML = `<div class="empty">No cards match “${esc(query)}”.</div>`; return; }
  let h = `<div class="section-label">${hits.length} result${hits.length === 1 ? '' : 's'}</div>`;
  for (const { c } of hits.slice(0, 200)) {
    h += `<button class="result" style="--dc:${subColor(c.domain)}" data-id="${c.id}">
        <div class="rt">${renderText(c.title)}</div>
        <div class="rd">${esc(subLabel(c.domain))}</div>
      </button>`;
  }
  box.innerHTML = h;
  $$('.result').forEach(b => b.onclick = () => go({ name: 'browse', id: b.dataset.id, from: { name: 'search', q: query } }));
}

/* ---------- BROWSE single card (from search) ---------- */
function renderBrowseCard() {
  const card = BYID[VIEW.id];
  setBar('Card', () => go(VIEW.from || { name: 'home' }));
  if (!card) { app.innerHTML = `<div class="empty">Card not found.</div>`; return; }
  const st = store.get(card.id);
  const dueTxt = st && st.seen ? (st.due <= Date.now() ? 'due now' : 'next: ' + new Date(st.due).toLocaleDateString()) : 'not studied yet';
  app.innerHTML = `<div class="card">
      <div class="card-top" style="--dc:${subColor(card.domain)}">
        <div class="card-cat">${esc(card.cat || subLabel(card.domain))}</div>
        <div class="card-title">${renderText(card.title)}</div>
      </div>
      <div class="card-body">${renderCardBody(card)}</div>
    </div>
    <div class="foot">${esc(dueTxt)}</div>`;
}

/* ---------- SETTINGS ---------- */
function renderSettings() {
  setBar('Settings', () => go({ name: 'home' }));
  const l = newLog();
  app.innerHTML = `
    <div class="setting">
      <div class="lab"><div class="t">New cards per day</div><div class="d">How many unseen cards to introduce daily (Anki default 20). ${l.introduced} introduced today.</div></div>
      <input id="npd" type="number" min="0" max="500" value="${settings.newPerDay}">
    </div>
    <div class="setting">
      <div class="lab"><div class="t">Reset today's new-card count</div><div class="d">Lets you pull in more new cards today.</div></div>
      <button class="danger" id="resetnew">Reset</button>
    </div>
    <div class="setting">
      <div class="lab"><div class="t">Reset ALL study progress</div><div class="d">Clears every card's spaced-repetition schedule on this device. Cannot be undone.</div></div>
      <button class="danger" id="resetall">Erase</button>
    </div>
    <div class="foot">TrueLearn ITE 2027 · ${DATA.count} cards · data generated ${new Date(DATA.generated).toLocaleString()}</div>`;
  const npd = $('#npd');
  npd.onchange = () => { settings.newPerDay = Math.max(0, parseInt(npd.value || '0', 10)); saveSettings(); toast('Saved'); };
  $('#resetnew').onclick = () => { writeJSON(LS_NEW, { date: todayStr(), introduced: 0 }); toast('New-card count reset'); };
  $('#resetall').onclick = () => { if (confirm('Erase all study progress on this device?')) { localStorage.removeItem(LS_PROG); toast('Progress erased'); } };
}

/* ---------- helpers ---------- */
function subColor(key) { const s = DATA.subdecks.find(x => x.key === key); return s ? s.color : '#3b82f6'; }
function subLabel(key) { const s = DATA.subdecks.find(x => x.key === key); return s ? s.label : key; }
let toastT;
function toast(msg) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }

/* keyboard: space/enter flips or grades */
document.addEventListener('keydown', e => {
  if (VIEW.name !== 'study' || !SESSION) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (!SESSION.flipped && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); flip(); }
  else if (SESSION.flipped && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); grade(parseInt(e.key, 10) - 1); }
});

/* ============================ boot ============================ */
async function boot() {
  try { await loadData(); } catch (e) { app.innerHTML = `<div class="empty">Couldn't load cards. If offline, open the app once online first.</div>`; return; }
  $('#settingsbtn').onclick = () => go({ name: 'settings' });
  go({ name: 'home' });
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('sw.js'); } catch { } }
}
boot();
