// Shared live-sync layer for every game on the site.
//
// All games talk to a tiny "backend" object with the same six calls:
//   get(path) · set(path, value) · remove(path) · on(path, cb) · presence(path, value) · onConnected(cb)
// In production it is Firebase Realtime Database. With ?local=1 in the URL it is a
// test mode where tabs in one browser talk to each other (no internet needed).
//
// Data layout (one room per game session):
//   rooms/<CODE>/meta              { game, createdAt }
//   rooms/<CODE>/state             JSON string, written by the narrator/host device
//   rooms/<CODE>/inputs/<playerId> JSON string, written by each player's phone
//   rooms/<CODE>/presence/<id>     short string, removed automatically when a phone disconnects

import { firebaseConfig } from './firebase-config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const ROOM_LIFETIME_MS = 12 * 3600 * 1000;

export function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }
export function isConfigured() {
  const u = firebaseConfig && firebaseConfig.databaseURL;
  return typeof u === 'string' && /^https:\/\/\S+$/.test(u) && !/PASTE_|YOUR[_-]/i.test(u);
}
export function wantsLocal() {
  if (window.PG_PREVIEW) return true;
  try { return new URLSearchParams(location.search).has('local'); } catch (e) { return false; }
}
/** Keeps ?local=1 on links while testing. */
export function withLocal(url) { return wantsLocal() ? url + (url.includes('?') ? '&' : '?') + 'local=1' : url; }

/** Returns a backend, or null when Firebase hasn't been configured yet. */
export async function connect() {
  if (wantsLocal()) return localBackend();
  if (!isConfigured()) return null;
  return firebaseBackend();
}

export async function createRoom(B, game) {
  for (let i = 0; i < 15; i++) {
    let code = '';
    for (const x of crypto.getRandomValues(new Uint8Array(4))) code += CODE_ALPHABET[x % CODE_ALPHABET.length];
    const meta = await B.get(`rooms/${code}/meta`);
    if (meta && Date.now() - (meta.createdAt || 0) < ROOM_LIFETIME_MS) continue; // in use
    if (meta) await B.remove(`rooms/${code}`);                                    // old room: recycle it
    await B.set(`rooms/${code}/meta`, { game, createdAt: B.timestamp() });
    return code;
  }
  throw new Error('Could not find a free room code. Please try again.');
}
export function roomInfo(B, code) { return B.get(`rooms/${code}/meta`); }

/* ---------------- Firebase ---------------- */
async function firebaseBackend() {
  const m = await import('./vendor/firebase.js');
  const app = m.initializeApp({ databaseURL: firebaseConfig.databaseURL });
  const db = m.getDatabase(app);
  const presences = new Map();
  const connCbs = new Set();
  let connected = false;
  const assert = (p, v) => {
    const r = m.ref(db, p);
    return m.onDisconnect(r).remove().then(() => m.set(r, v)).catch(() => {});
  };
  m.onValue(m.ref(db, '.info/connected'), snap => {
    connected = !!snap.val();
    if (connected) for (const [p, v] of presences) assert(p, v); // re-announce after a reconnect
    for (const cb of connCbs) cb(connected);
  });
  return {
    mode: 'firebase',
    get: async p => (await m.get(m.ref(db, p))).val(),
    set: (p, v) => m.set(m.ref(db, p), v),
    remove: p => m.remove(m.ref(db, p)),
    on: (p, cb, err) => m.onValue(m.ref(db, p), s => cb(s.val()), e => { if (err) err(e); }),
    presence(p, v) {
      if (v == null) {
        presences.delete(p);
        const r = m.ref(db, p);
        return m.onDisconnect(r).cancel().then(() => m.remove(r)).catch(() => {});
      }
      presences.set(p, v);
      return assert(p, v);
    },
    onConnected(cb) { connCbs.add(cb); cb(connected); return () => connCbs.delete(cb); },
    timestamp: () => m.serverTimestamp(),
  };
}

/* ---------------- Local test mode (tabs in one browser) ---------------- */
function localBackend() {
  const PFX = 'pglocal:';
  // Falls back to memory (one tab only) where the browser blocks storage.
  const localStorage = (() => {
    try { const ls = window.localStorage; ls.setItem('pg__t', '1'); ls.removeItem('pg__t'); return ls; } catch (e) {}
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
      key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  const subs = new Set();
  const mine = new Set();
  const keys = () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) out.push(k.slice(PFX.length)); }
    return out;
  };
  function read(path) {
    const parts = path.split('/');
    for (let i = parts.length; i > 0; i--) {
      const raw = localStorage.getItem(PFX + parts.slice(0, i).join('/'));
      if (raw != null) {
        let v = JSON.parse(raw);
        for (const seg of parts.slice(i)) v = v && typeof v === 'object' ? v[seg] : undefined;
        return v === undefined ? null : v;
      }
    }
    let obj = null;
    for (const k of keys()) {
      if (!k.startsWith(path + '/')) continue;
      const rest = k.slice(path.length + 1).split('/');
      obj = obj || {};
      let o = obj;
      for (let i = 0; i < rest.length - 1; i++) o = o[rest[i]] = (o[rest[i]] && typeof o[rest[i]] === 'object') ? o[rest[i]] : {};
      o[rest[rest.length - 1]] = JSON.parse(localStorage.getItem(PFX + k));
    }
    return obj;
  }
  function notify(path) {
    for (const s of subs) {
      if (!(s.path === path || s.path.startsWith(path + '/') || path.startsWith(s.path + '/'))) continue;
      const v = read(s.path); const j = JSON.stringify(v);
      if (j !== s.last) { s.last = j; try { s.cb(v); } catch (e) { console.error(e); } }
    }
  }
  function write(path, v) {
    for (const k of keys()) if (k === path || k.startsWith(path + '/')) localStorage.removeItem(PFX + k);
    if (v != null) localStorage.setItem(PFX + path, JSON.stringify(v));
    notify(path);
  }
  // Other tabs hear about changes through the storage event, which fires only after the new value is readable.
  addEventListener('storage', e => { if (e.key && e.key.startsWith(PFX)) notify(e.key.slice(PFX.length)); });
  // Safety net: background tabs can get storage events late, so re-check subscriptions every so often.
  setInterval(() => {
    for (const s of subs) {
      const v = read(s.path); const j = JSON.stringify(v);
      if (j !== s.last) { s.last = j; try { s.cb(v); } catch (e) { console.error(e); } }
    }
  }, 700);
  addEventListener('pagehide', () => { for (const p of mine) write(p, null); });
  return {
    mode: 'local',
    get: async p => read(p),
    set: async (p, v) => write(p, v),
    remove: async p => write(p, null),
    on(p, cb) {
      const s = { path: p, cb, last: undefined };
      subs.add(s);
      setTimeout(() => { if (subs.has(s)) { const v = read(p); s.last = JSON.stringify(v); cb(v); } }, 0);
      return () => subs.delete(s);
    },
    async presence(p, v) { if (v == null) { mine.delete(p); write(p, null); } else { mine.add(p); write(p, v); } },
    onConnected(cb) { setTimeout(() => cb(true), 0); return () => {}; },
    timestamp: () => Date.now(),
  };
}
