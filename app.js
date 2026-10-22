// App shell, hash router and session state.
import { call, getToken, setToken, isMock, friendlyMessage, saveCache, readCache, clearCache } from './api.js';
import { h, icon, clear } from './util.js';
import { banner, skeleton } from './ui.js';
import { renderSignin, renderJoin } from './views/signin.js';
import { renderBook } from './views/book.js';
import { renderBookings } from './views/bookings.js';
import { renderOwner } from './views/owner.js';
import { renderAccount } from './views/account.js';
import { renderWaiver } from './views/waiver.js';

// avail: last availability payload ({ days }); fromCache: true while showing cached data until the live
// startup call lands; refreshFailed: the live refresh failed; onFresh: set by the Book view.
const state = { member: null, me: null, resources: null, avail: null, availAt: 0, fromCache: false, refreshFailed: false, onFresh: null };
let routeId = 0;
let currentRoute = '';

const ROUTES = {
  signin: { title: 'Sign in', render: renderSignin, public: true },
  join: { title: 'Request membership', render: renderJoin, public: true },
  book: { title: 'Book a court', render: renderBook },
  bookings: { title: 'My bookings', render: renderBookings },
  owner: { title: 'Owner', render: renderOwner, owner: true },
  account: { title: 'Account', render: renderAccount },
  waiver: { title: 'Participant Agreement', render: renderWaiver },
};

const els = {};

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function loadMe() {
  state.me = await call('me');
  state.member = state.me.member;
  return state.me;
}

// One request for me + resources + availability. Falls back to three calls if the engine has no `startup` yet.
async function fetchStartup() {
  try {
    return await call('startup', {});
  } catch (e) {
    if (e && e.code === 'BAD_REQUEST' && /unknown action/i.test(e.message || '')) {
      const me = await call('me');
      const resources = await call('resources', {});
      const availability = await call('availability', {});
      return { me: me, resources: resources, availability: availability };
    }
    throw e;
  }
}

function applyStartup(d, fromCache) {
  state.me = d.me;
  state.member = d.me.member;
  state.resources = d.resources;
  state.avail = d.availability;
  state.availAt = Date.now();
  state.fromCache = !!fromCache;
  state.refreshFailed = false;
}

async function loadStartup() {
  const d = await fetchStartup();
  applyStartup(d, false);
  saveCache(d);
  return d;
}

function resetSession() {
  state.member = null;
  state.me = null;
  state.resources = null;
  state.avail = null;
  state.availAt = 0;
  state.fromCache = false;
  state.refreshFailed = false;
  state.onFresh = null;
}

// Cached data is on screen; get the live data and tell the current view.
async function refreshInBackground() {
  try {
    await loadStartup();
  } catch (e) {
    if (e && e.code === 'UNAUTHORIZED') return; // auth:expired already sent the user to sign in
    state.refreshFailed = true;
    if (state.onFresh) state.onFresh();
    return;
  }
  if (!state.member) return;
  updateChrome(currentRoute);
  if (state.onFresh) state.onFresh();
  else if (currentRoute === 'account') route();
}

function buildShell() {
  const app = document.getElementById('app');
  clear(app);
  els.badge = h('button', { class: 'demo-badge', type: 'button', hidden: true, onclick: toggleDemoUser });
  els.nav = h('nav', { class: 'tabs', 'aria-label': 'Main', hidden: true });
  els.main = h('main', { id: 'view', tabindex: '-1' });
  const header = h('header', { class: 'appbar' },
    h('div', { class: 'appbar-inner' },
      h('div', { class: 'brand' },
        h('span', { class: 'wordmark' }, 'HACKER SPORTS', h('i', { class: 'dot', 'aria-hidden': 'true' })),
        h('span', { class: 'sub', text: 'Facility' })),
      els.badge,
      els.nav));
  app.append(header, els.main);
}

async function toggleDemoUser() {
  const mock = await import('./mock.js');
  const t = getToken();
  if (!t) return;
  setToken(mock.switchUser(t));
  clearCache();
  resetSession();
  try { await loadStartup(); } catch (e) { /* handled by route */ }
  go('#/book');
}

function updateChrome(name) {
  const signedIn = !!state.member;
  els.nav.hidden = !signedIn;
  els.badge.hidden = !isMock();
  const roleName = signedIn ? (state.member.role === 'Family' ? 'Family' : state.member.is_owner ? 'Owner' : 'Member') : '';
  els.badge.textContent = signedIn
    ? 'Demo data · ' + roleName + ' view (switch)'
    : 'Demo data';
  els.badge.disabled = !signedIn;
  els.badge.setAttribute('aria-label', signedIn ? 'Demo data. Switch between owner, member and family view.' : 'Demo data');
  clear(els.nav);
  if (!signedIn) return;
  const items = [['book', 'Book', 'calendar'], ['bookings', 'My bookings', 'list']];
  if (state.member.is_owner) items.push(['owner', 'Owner', 'shield']);
  items.push(['account', 'Account', 'person']);
  items.forEach(function (it) {
    els.nav.append(h('a', { href: '#/' + it[0], class: 'tab' + (it[0] === name ? ' active' : ''), 'aria-current': it[0] === name ? 'page' : null },
      icon(it[2], 22), h('span', { text: it[1] })));
  });
}

async function route() {
  const id = ++routeId;
  const rawName = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || '';
  let name = rawName;
  let def = ROUTES[name];
  if (!def) name = state.member ? 'book' : 'signin';
  def = ROUTES[name];
  if (!state.member && !def.public) { name = 'signin'; def = ROUTES.signin; }
  else if (state.member && def.public) { name = 'book'; def = ROUTES.book; }
  else if (def.owner && !(state.member && state.member.is_owner)) { name = 'book'; def = ROUTES.book; }
  const wanted = '#/' + name;
  // A matching route keeps its ?query (Stripe return params); the view reads and then clears it.
  if (rawName !== name) history.replaceState(null, '', location.pathname + location.search + wanted);

  document.title = def.title + ' · Hacker Sports Facility';
  currentRoute = name;
  state.onFresh = null;
  updateChrome(name);
  clear(els.main);
  els.main.className = 'route-' + name;
  els.main.append(skeleton(3, true));
  const ctx = {
    state: state,
    go: go,
    stale: function () { return id !== routeId; },
    loadMe: loadMe,
    afterSignIn: async function () { await loadStartup(); go('#/book'); },
    afterSignOut: function () { resetSession(); go('#/signin'); },
  };
  const root = h('div', { class: 'view' });
  try {
    await def.render(root, ctx);
  } catch (e) {
    if (id !== routeId) return;
    clear(root);
    root.append(banner(e), h('button', { class: 'btn', type: 'button', onclick: route, text: 'Try again' }));
  }
  if (id !== routeId) return;
  clear(els.main);
  els.main.append(root);
  window.scrollTo(0, 0);
  els.main.focus({ preventScroll: true });
}

async function boot() {
  buildShell();
  window.addEventListener('hashchange', route);
  window.addEventListener('auth:expired', function () {
    resetSession();
    go('#/signin');
  });
  if (getToken()) {
    const cached = readCache();
    if (cached) {
      // Paint from the saved copy right away, then refresh in the background.
      applyStartup({ me: cached.me, resources: cached.resources, availability: cached.availability }, true);
      route();
      refreshInBackground();
      return;
    }
    try {
      await loadStartup();
    } catch (e) {
      if (e && e.code === 'NETWORK') {
        clear(els.main);
        els.main.append(h('div', { class: 'view' }, banner(e),
          h('button', { class: 'btn', type: 'button', onclick: function () { location.reload(); }, text: 'Try again' })));
        updateChrome('');
        return;
      }
    }
  }
  route();
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* app still works without it */ });
  });
}
