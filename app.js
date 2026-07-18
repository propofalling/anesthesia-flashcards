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
  // Re-enable ONLY subscript/superscript markup (the source text uses <sub>/<sup>,
  // which esc() turned into &lt;sub&gt; etc.). Restoring just these two tags keeps
  // the render XSS-safe while showing formulas/units correctly (e.g. PaO2, cm^-5).
  t = t.replace(/&lt;(\/?)(sub|sup)&gt;/g, '<$1$2>');
  return t;
}
function stripOl(t) { t = (t || '').trim(); if (t.startsWith('*') && t.endsWith('*')) t = t.slice(1, -1); return t.trim(); }

/* ============================ settings + SRS store ============================ */
const LS_PROG = 'tl_srs_v1';       // { [cardId]: {ease,interval,reps,due,lapses,last} }
const LS_SET = 'tl_settings_v1';   // { newPerDay }
const LS_NEW = 'tl_newlog_v1';     // { date: 'YYYY-MM-DD', introduced: n }
const DAY = 86400000;

const DEFAULT_NEW_PER_DAY = 20;
const settings = Object.assign({ newPerDay: DEFAULT_NEW_PER_DAY, _last: 0 }, readJSON(LS_SET, {}));
function saveSettings() { settings._last = Date.now(); writeJSON(LS_SET, settings); pushSettingsMeta(); }

const store = {
  all() { return readJSON(LS_PROG, {}); },
  get(id) { return this.all()[id] || null; },
  set(id, st) { const a = this.all(); a[id] = st; writeJSON(LS_PROG, a); if (window.Sync) window.Sync.push(id, st); },
};

const META_SET = '__meta_settings__', META_NEW = '__meta_newlog__';

// Merge remote rows into local storage (last-write-wins by `last` timestamp),
// then push up any local rows newer than (or missing from) remote. Card rows go
// to the SRS store; the two reserved meta rows carry settings + daily new-count.
function mergeRemote(rows) {
  const local = store.all();
  const remoteById = {};
  let changed = false;
  let remoteSet = null, remoteNew = null;
  for (const r of rows) {
    if (r.card_id === META_SET) { remoteSet = r.state; applySettingsMeta(r.state); continue; }
    if (r.card_id === META_NEW) { remoteNew = r.state; applyNewlogMeta(r.state); continue; }
    remoteById[r.card_id] = r.state;
    const ls = local[r.card_id], rs = r.state;
    if (!ls || ((rs && rs.last || 0) > (ls.last || 0))) { local[r.card_id] = rs; changed = true; }
  }
  if (changed) writeJSON(LS_PROG, local);
  // push up local card states newer than remote
  for (const [id, ls] of Object.entries(local)) {
    const rs = remoteById[id];
    if (!rs || (ls.last || 0) > (rs.last || 0)) window.Sync.push(id, ls);
  }
  // Push up local settings only if this device has a meaningful value (explicitly
  // set, or a non-default limit) AND it's newer than / missing from remote. This
  // stops a device still on the default (20) from clobbering another's chosen limit.
  const settingsMeaningful = settings._last || settings.newPerDay !== DEFAULT_NEW_PER_DAY;
  if (settingsMeaningful && (!remoteSet || (settings._last || 0) > (remoteSet.last || 0))) pushSettingsMeta();
  // Newlog uses max-merge (monotonic per day). Push back when our count is higher
  // than remote (even if remote's timestamp is newer) or when we're strictly newer.
  const l = newLog();
  const remoteSameDay = remoteNew && remoteNew.date === l.date;
  if (!remoteNew || (remoteSameDay && (l.introduced || 0) > (remoteNew.introduced || 0)) ||
      l.date > (remoteNew.date || '') || (l.last || 0) > (remoteNew.last || 0)) pushNewlogMeta();
}

function applySettingsMeta(s) {
  if (s && (s.last || 0) > (settings._last || 0)) {
    settings.newPerDay = s.newPerDay; settings._last = s.last;
    writeJSON(LS_SET, settings);
  }
}
function applyNewlogMeta(s) {
  if (!s || !s.date) return;
  const l = newLog();
  if (s.date > l.date) { writeJSON(LS_NEW, { date: s.date, introduced: s.introduced || 0, last: s.last || Date.now() }); }
  else if (s.date === l.date && ((s.introduced || 0) > (l.introduced || 0) || (s.last || 0) > (l.last || 0))) {
    writeJSON(LS_NEW, { date: l.date, introduced: Math.max(l.introduced || 0, s.introduced || 0), last: Math.max(l.last || 0, s.last || 0) });
  }
}
function pushSettingsMeta() { if (window.Sync) window.Sync.push(META_SET, { newPerDay: settings.newPerDay, last: settings._last || Date.now() }); }
function pushNewlogMeta() { if (window.Sync) { const l = newLog(); window.Sync.push(META_NEW, { date: l.date, introduced: l.introduced || 0, last: l.last || Date.now() }); } }
function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function writeJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function todayStr() { return new Date().toISOString().slice(0, 10); }
function newLog() {
  let l = readJSON(LS_NEW, null);
  if (!l || l.date !== todayStr()) { l = { date: todayStr(), introduced: 0, last: Date.now() }; writeJSON(LS_NEW, l); }
  return l;
}
function newRemaining() { return Math.max(0, settings.newPerDay - newLog().introduced); }
function bumpNew(n) { const l = newLog(); l.introduced += n; l.last = Date.now(); writeJSON(LS_NEW, l); pushNewlogMeta(); }

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
  if (VIEW.name === 'deckbrowse') return renderDeckBrowse();
  if (VIEW.name === 'recent') return renderRecent();
  if (VIEW.name === 'browse') return renderBrowseCard();
  if (VIEW.name === 'settings') return renderSettings();
}

/* ---------- theme ---------- */
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('tl_theme', t); } catch (e) { }
  const btn = document.getElementById('themebtn'); if (btn) btn.textContent = t === 'dark' ? '☾' : '☀';
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', t === 'dark' ? '#0f1620' : '#ffffff');
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
  const seenCount = Object.values(store.all()).filter(s => s && s.seen).length;
  let h = `
    <div class="searchbar">
      <input id="q" type="search" placeholder="Search ${DATA.count} cards…" autocomplete="off">
    </div>
    <div class="study-all">
      <div style="display:flex;align-items:center;gap:14px;width:100%">
        <div>
          <div class="big">Whole deck</div>
          <div class="sub">${DATA.count} cards · ${seenCount} studied</div>
        </div>
        <div class="duepill"><span class="pill">${totalDue} due${remNew ? ' · +' + remNew + ' new' : ''}</span></div>
      </div>
      <div class="row2">
        <button id="viewall">View all</button>
        <button id="studyall">Study</button>
      </div>
    </div>
    <button class="recent-btn" id="recentbtn"><span>Recently added</span><span class="ra-cta">25 newest ›</span></button>
    <div class="section-label">Subdecks</div>
    <div class="decklist">`;
  for (const s of DATA.subdecks) {
    const d = dueCount(s.key);
    h += `<div class="deckcard" style="--dc:${s.color}">
        <div class="dc-head">
          <span class="label">${esc(s.label)}</span>
          <span class="meta">${s.count} cards${d ? ` · <span class="due">${d} due</span>` : ''}</span>
        </div>
        <div class="dc-actions">
          <button class="dc-btn view" data-key="${s.key}">View all</button>
          <button class="dc-btn study" data-key="${s.key}">Study${d ? ` <span class="cnt">${d}</span>` : ''}</button>
        </div>
      </div>`;
  }
  h += `</div><div class="foot">Updated ${new Date(DATA.generated).toLocaleDateString()} · ${DATA.count} cards</div>`;
  app.innerHTML = h;

  $('#studyall').onclick = () => startStudy('ALL');
  $('#viewall').onclick = () => go({ name: 'deckbrowse', key: 'ALL' });
  $('#recentbtn').onclick = () => go({ name: 'recent' });
  $$('.dc-btn.study').forEach(b => b.onclick = () => startStudy(b.dataset.key));
  $$('.dc-btn.view').forEach(b => b.onclick = () => go({ name: 'deckbrowse', key: b.dataset.key }));
  const q = $('#q');
  q.oninput = () => { if (q.value.trim()) go({ name: 'search', q: q.value }); };
}

/* ---------- RECENTLY ADDED (25 most recent generated/updated cards) ---------- */
function renderRecent() {
  setBar('Recently added', () => go({ name: 'home' }));
  const recent = CARDS.filter(c => c.updated)
    .sort((a, b) => a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : b.num - a.num)
    .slice(0, 25);
  if (!recent.length) { app.innerHTML = `<div class="empty">No recently added cards yet.</div>`; return; }
  let h = `<div class="section-label">${recent.length} most recent</div>`;
  for (const c of recent) {
    const d = new Date(c.updated);
    const ds = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    h += `<button class="result" style="--dc:${subColor(c.domain)}" data-id="${c.id}">
        <div class="rt">${renderText(c.title)}</div>
        <div class="rd">${esc(subLabel(c.domain))}${ds ? ' · ' + ds : ''}</div>
      </button>`;
  }
  app.innerHTML = h;
  $$('.result').forEach(b => b.onclick = () => go({ name: 'browse', id: b.dataset.id, from: { name: 'recent' } }));
}

/* ---------- DECK BROWSE (view all cards in a deck) ---------- */
function renderDeckBrowse() {
  const key = VIEW.key;
  const label = key === 'ALL' ? 'All cards' : subLabel(key);
  setBar(label, () => go({ name: 'home' }));
  const cards = deckCards(key);
  let h = `<div class="section-label">${cards.length} card${cards.length === 1 ? '' : 's'}</div>`;
  for (const c of cards) {
    h += `<button class="result" style="--dc:${subColor(c.domain)}" data-id="${c.id}">
        <div class="rt">${renderText(c.title)}</div>
        <div class="rd">${esc(subLabel(c.domain))}</div>
      </button>`;
  }
  app.innerHTML = h;
  $$('.result').forEach(b => b.onclick = () => go({ name: 'browse', id: b.dataset.id, from: { name: 'deckbrowse', key } }));
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
    ${syncSettingsHTML()}
    <div class="foot">TrueLearn ITE 2027 · ${DATA.count} cards · data generated ${new Date(DATA.generated).toLocaleString()}</div>`;
  const npd = $('#npd');
  npd.onchange = () => { settings.newPerDay = Math.max(0, parseInt(npd.value || '0', 10)); saveSettings(); toast('Saved'); };
  $('#resetnew').onclick = () => { writeJSON(LS_NEW, { date: todayStr(), introduced: 0 }); toast('New-card count reset'); };
  $('#resetall').onclick = () => { if (confirm('Erase all study progress on this device?')) { localStorage.removeItem(LS_PROG); toast('Progress erased'); } };
  const sn = $('#syncnow'); if (sn) sn.onclick = syncNow;
}

function syncSettingsHTML() {
  const cfg = window.TL_SYNC || {};
  if (!(window.Sync && window.Sync.enabled)) {
    return `<div class="section-label">Sync</div><div class="syncbox"><div class="k">Cross-device sync is off. Add Supabase keys in config.js to enable it.</div></div>`;
  }
  const st = window.Sync.getStatus();
  const state = st.ready ? '<span class="synced-ok">connected</span>' : '<span class="synced-bad">not connected yet</span>';
  return `<div class="section-label">Sync</div>
    <div class="syncbox">
      <div>Status: ${state}</div>
      <div class="k" style="margin-top:4px">Profile: <code>${esc(cfg.profile || '')}</code></div>
      <div class="k" style="margin-top:4px">Last pull: ${st.lastPull == null ? '—' : st.lastPull + ' rows'} · Pending writes: ${st.queue}</div>
      ${st.lastError ? `<div class="synced-bad" style="margin-top:6px">Last error: <code>${esc(String(st.lastError))}</code></div>` : ''}
    </div>
    <div class="setting">
      <div class="lab"><div class="t">Sync now</div><div class="d">Pull the latest progress and push anything pending.</div></div>
      <button class="act" id="syncnow">Sync now</button>
    </div>`;
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
  // Cross-device sync: pull remote progress and merge before first render.
  if (window.Sync && window.Sync.enabled) {
    try {
      if (await window.Sync.init()) {
        const remote = await window.Sync.pull();
        if (remote) mergeRemote(remote);
        window.Sync.flush();
      }
    } catch (e) { console.warn('[sync] skipped:', e); }
  }
  applyTheme(currentTheme());
  $('#themebtn').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  $('#settingsbtn').onclick = () => go({ name: 'settings' });
  go({ name: 'home' });
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('sw.js'); } catch { } }
}

// Manual sync trigger (Settings → Sync now).
async function syncNow() {
  if (!(window.Sync && window.Sync.enabled)) { toast('Sync not configured'); return; }
  toast('Syncing…');
  try {
    if (!window.Sync.ready()) await window.Sync.init();
    const remote = await window.Sync.pull();
    if (remote) mergeRemote(remote);
    await window.Sync.flush();
    const st = window.Sync.getStatus();
    toast(st.lastError ? 'Sync error — see status' : 'Synced ✓');
  } catch (e) { toast('Sync failed'); }
  renderSettings();
}
boot();
