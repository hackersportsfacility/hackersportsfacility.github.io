// Single entry point for every backend call. Switches to mock.js in demo mode.
import { API_URL } from './config.js';

export const NETWORK_MESSAGE = "Can't reach the booking system. Check your connection and try again.";
const TOKEN_KEY = 'hsf_token';
const PUBLIC_ACTIONS = ['ping', 'requestMembership', 'requestCode', 'verifyCode'];
let memToken = '';

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function isMock() {
  if (!API_URL) return true;
  return /[?&]mock(?:[=&]|$)/.test(location.search);
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || memToken || '';
  } catch (e) {
    return memToken;
  }
}
export function setToken(t) {
  memToken = t || '';
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* storage unavailable */ }
}
export function clearToken() {
  memToken = '';
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  clearCache();
}

// ---- startup cache (release 2): last startup payload, so the grid can paint instantly ----
const CACHE_KEY = 'hsf_cache_v1';
const CACHE_MAX_AGE_MS = 24 * 3600 * 1000;
function tokenHint(t) { return String(t || '').slice(-8); }

export function saveCache(data) {
  try {
    const t = getToken();
    if (!t || !data || !data.me) return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      token_hash_hint: tokenHint(t), me: data.me, resources: data.resources, availability: data.availability, saved_at: Date.now(),
    }));
  } catch (e) { /* storage unavailable or full: the cache is optional */ }
}
export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    const t = getToken();
    if (!c || !t || c.token_hash_hint !== tokenHint(t)) return null;
    if (!c.me || !c.me.member || !c.resources || !c.availability || !c.availability.days) return null;
    if (!(Date.now() - Number(c.saved_at) < CACHE_MAX_AGE_MS)) { clearCache(); return null; }
    return c;
  } catch (e) { return null; }
}
export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
}

export async function call(action, params) {
  const body = Object.assign({ action: action }, params || {});
  const token = getToken();
  if (token && PUBLIC_ACTIONS.indexOf(action) === -1) body.token = token;

  let res;
  if (isMock()) {
    const mock = await import('./mock.js');
    res = await mock.handle(body);
  } else {
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
      res = await r.json();
    } catch (e) {
      throw new ApiError('NETWORK', NETWORK_MESSAGE);
    }
  }

  if (res && res.ok) {
    if (action === 'verifyCode' && res.data && res.data.token) setToken(res.data.token);
    return res.data;
  }
  const e = res && res.error ? res.error : {};
  const err = new ApiError(e.code || 'SERVER', e.message || 'Something went wrong. Please try again.');
  if (err.code === 'UNAUTHORIZED' && PUBLIC_ACTIONS.indexOf(action) === -1) {
    clearToken();
    window.dispatchEvent(new Event('auth:expired'));
  }
  throw err;
}

export function friendlyMessage(err) {
  if (err && err.code === 'NETWORK') return NETWORK_MESSAGE;
  if (err && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}
