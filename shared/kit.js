// Game Night kit: everything a narrated, one-phone-each party game needs.
//
// A game module imports what it needs from here and calls setup({...}) with its
// rules, its engine (runs only on the narrator device) and its screens.
// The kit handles rooms, joining, the lobby, the narrator voice, the host loop,
// practice bots and rendering. See storyteller/game.js for a complete example.

import { connect, createRoom, normCode, roomInfo, withLocal } from './realtime.js';
export { normCode, withLocal };

/* ================= basics ================= */
export const PREVIEW = !!window.PG_PREVIEW;   // single-device preview build
export const FAST = !!window.WW_FAST;         // test hook: speeds up all pauses
export const T = ms => (FAST ? Math.max(60, Math.round(ms / 12)) : ms);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const now = () => Date.now();
export const clone = o => JSON.parse(JSON.stringify(o));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function rid(n = 10) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = '';
  for (const x of crypto.getRandomValues(new Uint8Array(n))) s += a[x % a.length];
  return s;
}
export const store = {
  get(k, sess) { try { return (sess ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, sess) { try { (sess ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
};
export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 18);
}
export function listJoin(a) { return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
// Light obfuscation so secrets aren't stored as plain words in the shared state.
export function enc(text, salt) {
  const s = text + '|' + salt; let o = '';
  for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ (salt.charCodeAt(i % salt.length) & 15));
  return btoa(o);
}
export function dec(code, salt) {
  try { const s = atob(code); let o = ''; for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ (salt.charCodeAt(i % salt.length) & 15)); return o.split('|')[0]; }
  catch (e) { return null; }
}

/* ================= DOM: builder, delegated events, in-place updates ================= */
export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'html') { e.__html = v; e.innerHTML = v; }
    else if (k.startsWith('on')) (e.__on || (e.__on = {}))[k.slice(2)] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
for (const type of ['click', 'input', 'keydown', 'change']) {
  document.addEventListener(type, ev => {
    for (let n = ev.target; n && n !== document; n = n.parentNode) {
      if (n.__on && n.__on[type]) { if (type === 'click' && n.disabled) return; n.__on[type](ev); return; }
    }
  });
}
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType === 3) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) { a.replaceWith(b); return; }
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  a.__on = b.__on;
  if ((a.tagName === 'INPUT' || a.tagName === 'SELECT') && a !== document.activeElement && a.value !== b.value) a.value = b.value;
  if (b.__html !== undefined) { if (a.__html !== b.__html) { a.innerHTML = b.__html; a.__html = b.__html; } return; }
  const ac = [...a.childNodes], bc = [...b.childNodes];
  for (let i = 0; i < bc.length; i++) { if (i < ac.length) morph(ac[i], bc[i]); else a.appendChild(bc[i]); }
  for (let i = bc.length; i < ac.length; i++) ac[i].remove();
}

/* ================= state shared with games ================= */
let G = null; // the game's config, from setup()
export const ID = { pid: store.get('pg_pid', true) || rid(10) };
store.set('pg_pid', ID.pid, true);
let myInput = { pid: ID.pid };
export const mine = () => myInput;
export const S = {
  nameDraft: store.get('pg_name') || '', codeDraft: '', confirm: null, rules: false,
  hostOpen: true, panel: null, toast: '', joinAt: 0, busy: false, sel: {},
};
export const Net = {
  mode: 'connecting', B: null, code: null, room: null, connected: false, enteredAt: 0, unsubs: [],
  state: null, gotState: false, inputs: {}, online: new Set(), hostOnline: false, hostSeen: 0,
};
export const byPid = (s, pid) => (s.players || []).find(p => p.pid === pid);
export const nm = (s, pid) => { const p = byPid(s, pid); return p ? p.name : '?'; };
const base = () => `rooms/${Net.code}`;
let QR = null;
if (!PREVIEW) import('./vendor/qrcode.js').then(m => { QR = m.default; render(); }).catch(() => {});

/* ================= network ================= */
function mergeInput(inp) {
  if (!inp || typeof inp !== 'object' || typeof inp.pid !== 'string' || typeof inp.ts !== 'number') return false;
  const cur = Net.inputs[inp.pid];
  if (cur && cur.ts >= inp.ts) return false;
  Net.inputs[inp.pid] = inp;
  return true;
}
function acceptState(st) {
  if (!st || typeof st !== 'object' || typeof st.ver !== 'number' || !Array.isArray(st.players)) return;
  const cur = Net.state;
  if (cur && (st.ver < cur.ver || (st.ver === cur.ver && (st.ts || 0) <= (cur.ts || 0)))) return;
  Net.state = st;
  if (Host.active && st.host !== ID.pid) Host.stop('Another device is narrating now.');
  render(); hostKick();
}
const writers = {};
function queueWrite(path, data) {
  const w = writers[path] || (writers[path] = { busy: false, next: null, tries: 0 });
  w.next = data;
  if (!w.busy) pump(path);
}
async function pump(path) {
  const w = writers[path]; w.busy = true;
  while (w.next != null) {
    const d = w.next; w.next = null;
    try { await Net.B.set(path, d); w.tries = 0; }
    catch (e) {
      console.warn('write failed', path, e);
      if (w.tries < 4) { w.tries++; await sleep(600 * w.tries); if (w.next == null) w.next = d; continue; }
      w.tries = 0; toast('Couldn’t save. Check your internet connection.');
    }
  }
  w.busy = false;
}
function publishState(s) {
  s.ver = Math.max(s.ver || 0, Net.state ? Net.state.ver : 0) + 1;
  s.ts = now();
  Net.state = s;
  queueWrite(base() + '/state', JSON.stringify(s));
  render(); hostKick();
}
function saveInputLocal() { store.set('pg_inp', JSON.stringify({ code: Net.code, inp: myInput }), true); }
export function sendInput(patch) {
  myInput = Object.assign({}, myInput, patch, { pid: ID.pid, ts: Math.max(now(), (myInput.ts || 0) + 1) });
  saveInputLocal();
  if (Host.active) { mergeInput(myInput); hostKick(); }
  queueWrite(`${base()}/inputs/${ID.pid}`, JSON.stringify(myInput));
  updatePresence();
  render();
}
let lastPresence = null;
function updatePresence() {
  if (!Net.B || !Net.code) return;
  const v = Host.active ? 'h' : (myInput.gid ? 'p' : 'w');
  if (v === lastPresence) return;
  lastPresence = v;
  Net.B.presence(`${base()}/presence/${ID.pid}`, v);
}
function onPresence(map) {
  const online = new Set(Object.keys(map || {}));
  const s = Net.state;
  const hostOn = !!(s && map && map[s.host] === 'h');
  const changed = !same([...online].sort(), [...Net.online].sort()) || hostOn !== Net.hostOnline;
  Net.online = online; Net.hostOnline = hostOn; if (hostOn) Net.hostSeen = now();
  if (changed) render();
}
function leaveRoom() {
  for (const u of Net.unsubs) { try { u(); } catch (e) {} }
  Net.unsubs = [];
  if (Host.active) Host.stop();
  if (Net.B && Net.code) Net.B.presence(`${base()}/presence/${ID.pid}`, null);
  lastPresence = null;
  Net.code = null; Net.room = null; Net.state = null; Net.gotState = false; Net.inputs = {}; Net.online = new Set();
}
function roomUrl(code) { return withLocal(`${location.origin}${location.pathname}?room=${code || Net.code}`); }
function setUrl(code) {
  try { history.replaceState(null, '', withLocal(code ? `${location.pathname}?room=${code}` : location.pathname)); } catch (e) {}
}
async function enterRoom(code, { created } = {}) {
  leaveRoom();
  Net.code = code; Net.room = 'loading'; Net.enteredAt = now(); render();
  if (!created) {
    let meta = null;
    try { meta = await roomInfo(Net.B, code); } catch (e) { Net.room = 'error'; render(); return false; }
    if (Net.code !== code) return false;
    if (!meta) { Net.room = 'missing'; setUrl(null); render(); return false; }
    if (meta.game && meta.game !== G.id) { location.href = withLocal(`/${encodeURIComponent(meta.game)}?room=${code}`); return false; }
  }
  setUrl(code);
  Net.room = 'ok';
  myInput = { pid: ID.pid };
  try { const j = JSON.parse(store.get('pg_inp', true) || 'null'); if (j && j.code === code && j.inp && j.inp.pid === ID.pid) myInput = j.inp; } catch (e) {}
  Net.unsubs.push(Net.B.on(`${base()}/state`, v => {
    Net.gotState = true;
    if (typeof v === 'string') { try { acceptState(JSON.parse(v)); } catch (e) {} }
    render();
  }, () => { Net.room = 'error'; render(); }));
  Net.unsubs.push(Net.B.on(`${base()}/presence`, v => onPresence(v)));
  if (!created) {
    try {
      const raw = await Net.B.get(`${base()}/inputs/${ID.pid}`);
      if (typeof raw === 'string') { const d = JSON.parse(raw); if (d && d.pid === ID.pid && (!myInput.ts || d.ts > myInput.ts)) { myInput = d; saveInputLocal(); } }
    } catch (e) {}
  }
  updatePresence();
  render();
  return true;
}

/* ================= narrator voice (narrator device only) ================= */
export const Narrator = {
  engine: store.get('pg_voice_on') === 'off' ? 'off' : 'device',
  voiceName: store.get('pg_voice') || '', speakingId: null, done: {}, gen: 0,
  which() { if (FAST || this.engine === 'off' || !window.speechSynthesis) return 'off'; return 'device'; },
  prime() {
    try { if (window.speechSynthesis && !FAST) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
  },
  est(text) { return T(Math.max(1600, text.split(/\s+/).length * 400 + 700)); },
  voices() { try { return (speechSynthesis.getVoices() || []).filter(v => /^en/i.test(v.lang)); } catch (e) { return []; } },
  pickVoice() {
    const vs = this.voices();
    return vs.find(v => v.name === this.voiceName)
      || vs.find(v => /en-GB/i.test(v.lang) && /daniel|arthur|male/i.test(v.name))
      || vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /en-US/i.test(v.lang)) || vs[0] || null;
  },
  async say(id, text) {
    if (this.speakingId === id || this.done[id]) return;
    const g = ++this.gen;
    const est = this.est(text);
    if (this.which() !== 'device') { this.done[id] = now() + est; render(); hostKick(); return; }
    this.speakingId = id; render();
    await Promise.race([this.deviceSay(text), sleep(est * 2 + 5000)]);
    if (g !== this.gen) return;
    this.speakingId = null; this.done[id] = now();
    render(); hostKick();
  },
  deviceSay(text) {
    return new Promise(res => {
      try {
        const ss = window.speechSynthesis; ss.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/\p{Extended_Pictographic}/gu, ''));
        u.rate = 0.95; u.pitch = 0.95; const v = this.pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
        u.onend = () => res(); u.onerror = () => res();
        ss.speak(u);
      } catch (e) { res(); }
    });
  },
  stop() { this.gen++; this.speakingId = null; try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {} },
  repeat() { const s = Net.state; if (!s || !s.say) return; this.prime(); this.stop(); delete this.done[s.say.id]; render(); hostKick(); },
  test() { this.prime(); this.stop(); this.say('test-' + rid(4), 'Hello everyone. I will be your narrator tonight.'); },
};
try { speechSynthesis.addEventListener('voiceschanged', () => render()); } catch (e) {}

let wakeLock = null;
export async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (Host.active || myInput.gid)) keepAwake(); });

/* ================= narrator device: host loop ================= */
// Heartbeat in a worker: browsers slow page timers in background tabs, not worker ones.
function startTicker(fn, ms) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const w = new Worker(url); w.onmessage = () => fn();
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch (e) { const id = setInterval(fn, ms); return () => clearInterval(id); }
}
export const Host = {
  active: false, iv: null, unsub: null, tickQ: false,
  start() {
    if (this.active || !Net.code) return;
    this.active = true; Narrator.prime(); keepAwake();
    this.unsub = Net.B.on(`${base()}/inputs`, obj => {
      let ch = false;
      for (const raw of Object.values(obj || {})) { if (typeof raw !== 'string') continue; try { if (mergeInput(JSON.parse(raw))) ch = true; } catch (e) {} }
      if (ch) hostKick();
    });
    this.iv = startTicker(() => this.tick(), 400);
    updatePresence(); this.tick(); render();
  },
  stop(msg) {
    this.active = false; if (this.iv) this.iv(); this.iv = null;
    if (this.unsub) { try { this.unsub(); } catch (e) {} this.unsub = null; }
    Narrator.stop(); updatePresence();
    if (msg) toast(msg);
    render();
  },
  tick() {
    if (!this.active) return;
    const cur = Net.state; if (!cur) return;
    if (cur.host !== ID.pid) { this.stop(); return; }
    if (cur.say && !Narrator.done[cur.say.id] && Narrator.speakingId !== cur.say.id) Narrator.say(cur.say.id, cur.say.text);
    const s = clone(cur);
    let ch = false;
    try { ch = engine(s); } catch (e) { console.error(e); }
    if (ch) publishState(s);
  },
};
function hostKick() {
  if (!Host.active || Host.tickQ) return;
  Host.tickQ = true; setTimeout(() => { Host.tickQ = false; Host.tick(); }, 40);
}
/** Narrator device only: change the state with fn(s); return false from fn to cancel. */
export function hostAct(fn) {
  if (!Host.active || !Net.state) return;
  const s = clone(Net.state);
  if (fn(s) !== false) publishState(s);
}
/** Move to a phase/step and (optionally) give the narrator a new line to say. */
export function go(s, phase, step, text) { s.phase = phase; s.step = step; s.stepAt = now(); s.say = text ? { id: rid(6), text } : null; }
/** True once the current line has been spoken, plus `extra` ms. */
export function sayDone(s, extra) {
  extra = extra || 0;
  if (!s.say) return now() - s.stepAt >= extra;
  const d = Narrator.done[s.say.id];
  return !!d && now() - d >= extra;
}
export const inputFor = s => pid => { const i = Net.inputs[pid]; return i && i.gid === s.gid ? i : null; };

function engine(s) {
  if (s.players.some(p => isBot(p.pid)) && G.botAct) G.botAct(s, Bots);
  if (s.phase === 'lobby') return lobbyTick(s, inputFor(s));
  return G.engine(s, inputFor(s));
}
function lobbyTick(s, inp) {
  let ch = false;
  for (const pid in Net.inputs) {
    const i = inp(pid); if (!i) continue;
    const p = byPid(s, pid);
    if (i.leave) { if (p) { s.players = s.players.filter(x => x.pid !== pid); ch = true; } continue; }
    if (s.kicked && s.kicked[pid] && i.ts <= s.kicked[pid]) continue;
    const name = cleanName(i.name); if (!name) continue;
    const clash = s.players.some(x => x.pid !== pid && x.name.toLowerCase() === name.toLowerCase());
    if (!p) { if (!clash && s.players.length < (G.maxPlayers || 24)) { s.players.push({ pid, name }); ch = true; } }
    else if (p.name !== name && !clash) { p.name = name; ch = true; }
  }
  if (ch && G.onPlayersChanged) G.onPlayersChanged(s);
  return ch;
}
function removePlayer(s, pid) {
  const p = byPid(s, pid); if (!p) return false;
  if (s.phase === 'lobby') {
    s.players = s.players.filter(x => x.pid !== pid);
    s.kicked = Object.assign({}, s.kicked, { [pid]: (Net.inputs[pid] && Net.inputs[pid].ts) || now() });
    for (const k in Net.inputs) if (k === pid && isBot(k)) delete Net.inputs[k];
    if (G.onPlayersChanged) G.onPlayersChanged(s);
    return;
  }
  return G.removePlayer ? G.removePlayer(s, pid) : false;
}

/* ================= practice bots (run on the narrator device) ================= */
const BOT_NAMES = ['Ava', 'Bo', 'Cleo', 'Dax', 'Eve', 'Finn', 'Gus', 'Ivy', 'Jo', 'Kit'];
export const isBot = pid => typeof pid === 'string' && pid.startsWith('bot-');
export const Bots = {
  last: {},
  delay(pid, salt, min, span) { return T(min + hash(pid + salt) % span); },
  pick(list, pid, salt) { return list.length ? list[hash(pid + salt) % list.length] : null; },
  add(s, n) {
    const used = new Set(s.players.map(p => p.name.toLowerCase()));
    let added = 0;
    for (const n0 of BOT_NAMES) {
      if (added >= n) break;
      const name = n0 + ' 🤖';
      if (used.has(name.toLowerCase())) continue;
      const pid = 'bot-' + rid(6);
      s.players.push({ pid, name }); added++;
      this.set(s, pid, { name });
    }
    if (G.onPlayersChanged) G.onPlayersChanged(s);
  },
  removeAll(s) {
    s.players = s.players.filter(p => !isBot(p.pid));
    for (const pid in Net.inputs) if (isBot(pid)) delete Net.inputs[pid];
    this.last = {};
    if (G.onPlayersChanged) G.onPlayersChanged(s);
  },
  /** Set a bot's input (like a player tapping). Returns true if anything changed. */
  set(s, pid, patch) {
    const prev = this.last[pid] || { pid, gid: s.gid };
    const next = Object.assign({}, prev, patch, { pid, gid: s.gid });
    if (same(Object.assign({}, prev, { ts: 0 }), Object.assign({}, next, { ts: 0 }))) return false;
    next.ts = Math.max(now(), (prev.ts || 0) + 1);
    this.last[pid] = next; mergeInput(next); return true;
  },
};

/* ================= actions ================= */
async function hostCreate() {
  Narrator.prime();
  if (S.busy) return; S.busy = true; render();
  try {
    leaveRoom();
    const code = await createRoom(Net.B, G.id);
    await enterRoom(code, { created: true });
    const s = Object.assign({
      v: 1, ver: 0, gid: rid(6), host: ID.pid, phase: 'lobby', step: '', stepAt: now(), say: null,
      players: [], kicked: {},
    }, G.initialState());
    publishState(s); Host.start();
  } catch (e) {
    console.error(e); toast('Couldn’t create a room. Check your connection and try again.');
  } finally { S.busy = false; render(); }
}
async function joinCode(raw) {
  const code = normCode(raw); if (code.length !== 4) return;
  S.busy = true; render();
  await enterRoom(code);
  S.busy = false; render();
}
function takeover() {
  ask('Narrate from this device?', 'This device will speak the commands and run the game from now on. Keep it on, with the volume up.', 'Narrate here', () => {
    Narrator.prime(); const s = clone(Net.state); s.host = ID.pid; publishState(s); Host.start();
  });
}
function joinClick(s) {
  const name = cleanName(S.nameDraft); if (!name) return;
  store.set('pg_name', name);
  const taken = s.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (taken && taken.pid !== ID.pid) {
    ask(`Rejoin as ${taken.name}?`, 'Only do this if you are this player and you reloaded the page or switched phones.', 'Rejoin', () => adoptPid(taken, s));
    return;
  }
  keepAwake(); S.joinAt = now();
  sendInput({ name, gid: s.gid, leave: false });
}
function adoptPid(p, s) {
  if (Net.B && Net.code) Net.B.presence(`${base()}/presence/${ID.pid}`, null);
  lastPresence = null;
  ID.pid = p.pid; store.set('pg_pid', ID.pid, true); myInput = { pid: ID.pid };
  S.joinAt = now(); keepAwake();
  sendInput({ name: p.name, gid: s.gid, leave: false });
}
export function ask(title, text, yes, fn) { S.confirm = { title, text, yes, fn }; render(); }
let toastT = null;
export function toast(msg) { S.toast = msg; render(); clearTimeout(toastT); toastT = setTimeout(() => { S.toast = ''; render(); }, 4200); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch (e) { toast('Copy failed. Long-press the link to copy it.'); }
}

/* ================= rendering ================= */
let rq = false;
export function render() { if (rq || !G) return; rq = true; requestAnimationFrame(() => { rq = false; draw(); }); }
function draw() {
  const s = Net.state;
  const me = s ? byPid(s, ID.pid) : null;
  document.body.className = (s && G.theme ? G.theme(s) : 'dusk') + ' game-' + G.id;
  const root = el('div', { class: 'wrap' },
    header(s, me), hostBar(s), main(s, me), footer(), modal(),
    S.toast ? el('div', { class: 'toast', role: 'status' }, S.toast) : null);
  const app = document.getElementById('app');
  if (app.firstElementChild && app.firstElementChild.classList.contains('wrap') && app.__live) morph(app.firstElementChild, root);
  else { app.replaceChildren(root); app.__live = true; }
}
function header(s, me) {
  const chip = s ? (s.phase === 'lobby' ? 'Lobby' : (G.chip ? G.chip(s) : '')) : '';
  return el('header', { class: 'top' },
    el('a', { class: 'brand', href: PREVIEW ? '#' : withLocal('/') }, el('span', { class: 'moon' }), G.name),
    chip ? el('span', { class: 'chip' }, chip) : null,
    me ? el('span', { class: 'me' }, me.name + (G.meSuffix ? G.meSuffix(s, me) : '')) : null);
}
/** The narrator's latest line, shown on players' phones. */
export function narr(s) {
  if (!s || !s.say || Host.active) return null;
  return el('div', { class: 'narr' }, el('span', { class: 'narr-ico' }, '🎙'), el('span', {}, s.say.text));
}
function hostLooksOffline(s) {
  if (s.phase === 'over') return false;
  return Net.connected && !Net.hostOnline && now() - Math.max(Net.hostSeen, Net.enteredAt) > 15000;
}
function hostBar(s) {
  if (!s) return null;
  if (!Host.active) {
    if (s.host === ID.pid) return el('div', { class: 'hostbar resume' }, el('span', {}, '🎙 This device is the narrator.'), el('button', { class: 'btn primary sm', onclick: () => Host.start() }, 'Resume narrating'));
    if (hostLooksOffline(s)) return el('div', { class: 'hostbar warn' }, el('span', {}, 'The narrator device looks offline.'), el('button', { class: 'btn sm', onclick: takeover }, 'Narrate here'));
    return null;
  }
  const label = s.phase === 'lobby' ? 'Lobby' : (G.stepLabel ? G.stepLabel(s) : '');
  const prog = s.phase === 'lobby' ? `${s.players.length} joined` : (G.progress ? G.progress(s) : '');
  const fl = s.phase !== 'lobby' && G.forceLabel ? G.forceLabel(s) : null;
  return el('div', { class: 'hostbar' },
    el('div', { class: 'hb-top' },
      el('span', { class: 'hb-mic' + (Narrator.speakingId ? ' on' : ''), title: 'Narrator' }, Narrator.which() === 'off' ? '🔇' : '🎙'),
      el('div', { class: 'hb-txt' },
        el('div', { class: 'hb-label' }, `Narrator · Room ${Net.code}${label ? ' · ' + label : ''}${prog ? ' · ' + prog : ''}`),
        el('div', { class: 'hb-say' }, s.say ? s.say.text : (s.phase === 'lobby' ? 'Waiting for players to join.' : ''))),
      el('button', { class: 'icon-btn', 'aria-label': S.hostOpen ? 'Collapse' : 'Expand', onclick: () => { S.hostOpen = !S.hostOpen; render(); } }, S.hostOpen ? '▴' : '▾')),
    S.hostOpen ? el('div', { class: 'hb-actions' },
      s.say ? el('button', { class: 'btn sm ghost', onclick: () => Narrator.repeat() }, '↻ Repeat') : null,
      fl ? el('button', { class: 'btn sm ghost', onclick: () => ask(fl + '?', G.forceHelp ? G.forceHelp(s) : '', fl, () => hostAct(x => { Narrator.stop(); return G.force(x, inputFor(x)); })) }, '⏭ ' + fl) : null,
      el('button', { class: 'btn sm ghost', onclick: () => { S.panel = S.panel === 'voice' ? null : 'voice'; render(); } }, '🔊 Voice'),
      s.phase !== 'lobby' ? el('button', { class: 'btn sm ghost', onclick: () => { S.panel = S.panel === 'players' ? null : 'players'; render(); } }, '👥 Players') : null,
      s.phase !== 'lobby' && G.toLobby ? el('button', { class: 'btn sm ghost', onclick: () => ask('End this game?', 'Everyone goes back to the lobby.', 'End game', () => hostAct(x => { G.toLobby(x); go(x, 'lobby', '', null); })) }, '■ End game') : null,
    ) : null,
    S.hostOpen && S.panel === 'voice' ? voicePanel() : null,
    S.hostOpen && S.panel === 'players' && s.phase !== 'lobby' ? managePanel(s) : null);
}
function voicePanel() {
  const on = Narrator.which() === 'device';
  const vs = Narrator.voices(); const cur = Narrator.pickVoice();
  return el('div', { class: 'panel' },
    el('div', { class: 'seg' },
      el('button', { class: on ? 'on' : '', disabled: window.speechSynthesis ? null : true, onclick: () => { Narrator.engine = 'device'; store.set('pg_voice_on', 'on'); Narrator.prime(); render(); } }, 'Speak out loud'),
      el('button', { class: on ? '' : 'on', onclick: () => { Narrator.engine = 'off'; store.set('pg_voice_on', 'off'); Narrator.stop(); render(); } }, 'Silent (text only)')),
    on && vs.length > 1 ? el('select', { class: 'select', 'aria-label': 'Voice', onchange: e => { Narrator.voiceName = e.target.value; store.set('pg_voice', e.target.value); Narrator.test(); } },
      vs.map(v => el('option', { value: v.name, selected: !!(cur && cur.name === v.name) }, `${v.name} (${v.lang})`))) : null,
    el('div', { class: 'row' },
      el('p', { class: 'small muted' }, window.speechSynthesis ? 'Only this device speaks. Turn the volume up and keep the screen on.' : 'This browser can’t speak. Players can read each line on their phones.'),
      el('button', { class: 'btn sm', onclick: () => Narrator.test() }, 'Test')));
}
function managePanel(s) {
  const list = s.players.filter(p => !p.left && p.alive !== false);
  return el('div', { class: 'panel' },
    el('p', { class: 'small muted' }, 'If someone has to leave, remove them so the game doesn’t wait for them.'),
    list.map(p => el('div', { class: 'prow' },
      el('span', { class: 'dot ' + (Net.online.has(p.pid) || isBot(p.pid) ? 'on' : 'off') }),
      el('span', { class: 'pn' }, p.name),
      el('button', { class: 'btn sm ghost', onclick: () => ask(`Remove ${p.name}?`, 'They will be taken out of the game.', 'Remove', () => hostAct(x => removePlayer(x, p.pid))) }, 'Remove'))));
}
function main(s, me) {
  if (Net.mode === 'connecting') return loadingView('Connecting…');
  if (Net.mode === 'unconfigured') return unconfiguredView();
  if (Net.mode === 'error') return [hero(), el('section', { class: 'card center' }, el('p', {}, 'Couldn’t connect. Check your internet and reload the page.'))];
  if (!Net.code || Net.room === 'missing' || Net.room === 'error') return startView();
  if (Net.room === 'loading' || !Net.gotState) return loadingView(`Opening room ${Net.code}…`);
  if (!s) return [el('section', { class: 'card center' }, el('h2', {}, `Room ${Net.code}`), el('p', { class: 'muted' }, 'This room has no game yet. The narrator device will set it up.'))];
  if (s.phase === 'lobby') return lobbyView(s, me);
  return G.main(s, me);
}
function loadingView(msg) { return el('div', { class: 'loading' }, el('div', { class: 'moon-big pulse' }), el('p', { class: 'muted' }, msg)); }
function hero() {
  return el('section', { class: 'hero' },
    el('div', { class: 'hero-ico' }, G.icon),
    el('h1', {}, G.name),
    el('p', {}, G.tagline));
}
function unconfiguredView() {
  return [hero(), el('section', { class: 'card' },
    el('h3', {}, 'Almost ready'),
    el('p', {}, 'Live sync isn’t set up on this site yet. Add your Firebase database URL to shared/firebase-config.js (the README has the steps), then redeploy.'),
    el('a', { class: 'btn big', href: location.pathname + '?local=1' }, 'Try test mode (tabs in this browser only)'))];
}
function howTo() { return el('ol', { class: 'steps' }, G.howTo.map(t => el('li', {}, t))); }
function startView() {
  const code = normCode(S.codeDraft);
  if (PREVIEW) return [hero(),
    el('section', { class: 'card' },
      el('h3', {}, 'Preview'),
      el('p', {}, 'This preview runs on this one device. Host a game, type your name to join, tap “Add bots” to fill the other seats, then start. Turn your volume up to hear the narrator.'),
      el('p', { class: 'muted small' }, 'On the real site, everyone joins from their own phone with the room code or QR code.'),
      el('button', { class: 'btn primary big', disabled: S.busy ? true : null, onclick: hostCreate }, '🎙 Host a game')),
    el('section', { class: 'card' }, el('h3', {}, 'How it works'), howTo())];
  return [hero(),
    Net.room === 'missing' ? el('section', { class: 'card' }, el('p', {}, `Room ${Net.code} wasn’t found. Check the code with the narrator, or host a new game.`)) : null,
    Net.room === 'error' ? el('section', { class: 'card' }, el('p', {}, 'Couldn’t open that room. Check your connection and try again.')) : null,
    el('section', { class: 'card' },
      el('h3', {}, 'Join a game'),
      el('label', { for: 'code', class: 'lbl' }, 'Room code (on the narrator’s screen)'),
      el('input', { id: 'code', class: 'input code-input', maxlength: '4', placeholder: 'ABCD', value: S.codeDraft, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go',
        oninput: e => { S.codeDraft = normCode(e.target.value); render(); }, onkeydown: e => { if (e.key === 'Enter') joinCode(S.codeDraft); } }),
      el('button', { class: 'btn primary big', disabled: code.length === 4 && !S.busy ? null : true, onclick: () => joinCode(S.codeDraft) }, S.busy ? 'Opening…' : 'Join')),
    el('section', { class: 'card' },
      el('h3', {}, 'Host a game'),
      howTo(),
      el('button', { class: 'btn big', disabled: S.busy ? true : null, onclick: hostCreate }, '🎙 Host a new game on this device'))];
}
function shareCard() {
  if (PREVIEW) return el('section', { class: 'card' },
    el('div', { class: 'small muted' }, 'Room code'), el('div', { class: 'code' }, Net.code),
    el('p', { class: 'small muted' }, 'Preview: on the real site this card shows a QR code and link for everyone to join.'));
  const url = roomUrl();
  let qr = null;
  if (QR && Host.active) {
    try { const q = QR(0, 'M'); q.addData(url); q.make(); qr = el('div', { class: 'qr', 'aria-label': 'QR code to join', html: q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) }); } catch (e) { qr = null; }
  }
  return el('section', { class: 'card' },
    el('div', { class: 'share-row' },
      el('div', {},
        el('div', { class: 'small muted' }, 'Room code'),
        el('div', { class: 'code' }, Net.code),
        el('div', { class: 'small muted' }, Host.active ? 'Players scan the code or open the link' : 'Share this with anyone still joining')),
      qr),
    el('div', { class: 'small muted link-text' }, url.replace(/^https?:\/\//, '')),
    el('div', { class: 'row gap', style: 'justify-content:flex-start;margin-top:10px' },
      navigator.share ? el('button', { class: 'btn sm', onclick: () => navigator.share({ title: `Join our ${G.name} game`, text: `Room ${Net.code}`, url }).catch(() => {}) }, 'Share link') : null,
      el('button', { class: 'btn sm', onclick: () => copy(url) }, 'Copy link')));
}
function lobbyView(s, me) {
  const out = [shareCard()];
  if (!me) {
    const pending = myInput.gid === s.gid && !myInput.leave && !!cleanName(myInput.name);
    const kicked = !!(s.kicked && s.kicked[ID.pid] && (myInput.ts || 0) <= s.kicked[ID.pid]);
    const waiting = pending && !kicked;
    const draft = cleanName(S.nameDraft);
    const taken = draft ? s.players.find(p => p.name.toLowerCase() === draft.toLowerCase()) : null;
    out.push(el('section', { class: 'card' },
      el('h2', {}, Host.active ? 'Playing too?' : 'Join the game'),
      Host.active ? el('p', { class: 'muted small', style: 'margin-bottom:6px' }, 'If this device is also a player, add your name. Otherwise skip this.') : null,
      el('label', { for: 'name', class: 'lbl' }, 'Your name'),
      el('input', { id: 'name', class: 'input', maxlength: '18', placeholder: 'Type your name', value: S.nameDraft, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'go',
        oninput: e => { S.nameDraft = e.target.value; render(); }, onkeydown: e => { if (e.key === 'Enter') joinClick(s); } }),
      taken ? el('p', { class: 'hint warn' }, `${taken.name} is already in. Pick another name, or tap Rejoin if that’s you on a new device.`) : null,
      el('button', { class: 'btn primary big', disabled: !draft || (waiting && !taken) ? true : null, onclick: () => joinClick(s) },
        taken ? `Rejoin as ${taken.name}` : (waiting ? 'Joining…' : 'Join game')),
      waiting && now() - S.joinAt > 10000 ? el('p', { class: 'hint' }, 'Still waiting for the narrator device to add you. Make sure it’s open.') : null,
      kicked ? el('p', { class: 'hint' }, 'The narrator removed you. You can join again.') : null));
  } else {
    out.push(el('section', { class: 'card' },
      el('div', { class: 'row' },
        el('div', {}, el('div', { class: 'small muted' }, 'You’re in as'), el('div', { class: 'big-name' }, me.name)),
        el('button', { class: 'btn sm ghost', onclick: () => sendInput({ leave: true }) }, 'Leave'))));
  }
  out.push(el('section', { class: 'card' },
    el('h3', {}, `Players · ${s.players.length}`),
    s.players.length ? s.players.map(p => el('div', { class: 'prow' },
      el('span', { class: 'dot ' + (Net.online.has(p.pid) || isBot(p.pid) ? 'on' : 'off') }),
      el('span', { class: 'pn' }, p.name + (p.pid === ID.pid ? ' (you)' : '')),
      Host.active ? el('button', { class: 'icon-btn', 'aria-label': `Remove ${p.name}`, onclick: () => ask(`Remove ${p.name}?`, '', 'Remove', () => hostAct(x => removePlayer(x, p.pid))) }, '✕') : null))
      : el('p', { class: 'muted' }, 'Nobody has joined yet.')));
  if (Host.active) {
    out.push(G.lobbyHost(s));
    out.push(el('div', { class: 'row card', style: 'padding:12px 16px' },
      el('span', { class: 'small muted' }, 'Trying it out alone? Bots can fill empty seats.'),
      s.players.some(p => isBot(p.pid))
        ? el('button', { class: 'btn sm ghost', onclick: () => hostAct(x => Bots.removeAll(x)) }, 'Remove bots')
        : el('button', { class: 'btn sm', onclick: () => hostAct(x => Bots.add(x, Math.max(1, (G.botFill || 6) - x.players.length))) }, 'Add bots')));
  } else if (me) out.push(el('p', { class: 'center muted' }, 'Waiting for the narrator to start the game…'));
  return out;
}
function connLabel() {
  if (!Net.B) return '';
  if (Net.B.mode === 'local') return PREVIEW ? 'Preview · this device only' : 'Test mode · tabs in this browser only';
  return Net.connected ? '● Live' : '○ Reconnecting…';
}
function footer() {
  const inRoom = Net.code && Net.room === 'ok';
  return el('footer', { class: 'foot' },
    el('button', { class: 'link', onclick: () => { S.rules = !S.rules; render(); } }, S.rules ? 'Hide rules' : 'How to play'),
    inRoom && !Host.active ? el('button', { class: 'link', onclick: () => ask('Leave this room?', 'You can rejoin with the room code.', 'Leave room', () => { leaveRoom(); setUrl(null); render(); }) }, 'Leave room') : null,
    el('span', { class: 'conn' }, connLabel()),
    S.rules && G.rules ? el('div', { class: 'rules card' }, G.rules()) : null);
}
function modal() {
  const c = S.confirm; if (!c) return null;
  const close = () => { S.confirm = null; render(); };
  return el('div', { class: 'modal', onclick: e => { if (e.target === e.currentTarget) close(); } },
    el('div', { class: 'mbox', role: 'dialog', 'aria-modal': 'true' },
      el('h3', {}, c.title), c.text ? el('p', { class: 'muted' }, c.text) : null,
      el('div', { class: 'row gap' },
        el('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => { const f = c.fn; S.confirm = null; f(); render(); } }, c.yes || 'OK'))));
}

/* ================= boot ================= */
export async function setup(config) {
  G = config;
  window.__pg = {
    get state() { return Net.state; }, get pid() { return ID.pid; }, get input() { return myInput; }, get code() { return Net.code; },
    get host() { return Host.active; }, inputs() { return clone(Net.inputs); },
  };
  setInterval(() => { if (Net.state) render(); }, 5000);
  render();
  try {
    const B = await connect();
    if (!B) { Net.mode = 'unconfigured'; render(); return; }
    Net.B = B; Net.mode = 'ready';
    B.onConnected(c => { Net.connected = c; render(); });
    const code = normCode(new URLSearchParams(location.search).get('room'));
    if (code.length === 4) await enterRoom(code);
    render();
  } catch (e) {
    console.error(e); Net.mode = 'error'; render();
  }
}
