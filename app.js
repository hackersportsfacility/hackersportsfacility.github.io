// App shell, hash router and session state.
import { call, getToken, setToken, isMock, friendlyMessage } from './api.js';
import { h, icon, clear } from './util.js';
import { banner, skeleton } from './ui.js';
import { renderSignin, renderJoin } from './views/signin.js';
import { renderBook } from './views/book.js';
import { renderBookings } from './views/bookings.js';
import { renderOwner } from './views/owner.js';
import { renderAccount } from './views/account.js';

const state = { member: null, me: null, resources: null };
let routeId = 0;

const ROUTES = {
  signin: { title: 'Sign in', render: renderSignin, public: true },
  join: { title: 'Request membership', render: renderJoin, public: true },
  book: { title: 'Book a court', render: renderBook },
  bookings: { title: 'My bookings', render: renderBookings },
  owner: { title: 'Owner', render: renderOwner, owner: true },
  account: { title: 'Account', render: renderAccount },
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

function resetSession() {
  state.member = null;
  state.me = null;
  state.resources = null;
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
  resetSession();
  try { await loadMe(); } catch (e) { /* handled by route */ }
  go('#/book');
}

function updateChrome(name) {
  const signedIn = !!state.member;
  els.nav.hidden = !signedIn;
  els.badge.hidden = !isMock();
  els.badge.textContent = signedIn
    ? 'Demo data · ' + (state.member.is_owner ? 'Owner' : 'Member') + ' view (switch)'
    : 'Demo data';
  els.badge.disabled = !signedIn;
  els.badge.setAttribute('aria-label', signedIn ? 'Demo data. Switch between owner and member view.' : 'Demo data');
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
  let name = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || '';
  let def = ROUTES[name];
  if (!def) name = state.member ? 'book' : 'signin';
  def = ROUTES[name];
  if (!state.member && !def.public) { name = 'signin'; def = ROUTES.signin; }
  else if (state.member && def.public) { name = 'book'; def = ROUTES.book; }
  else if (def.owner && !(state.member && state.member.is_owner)) { name = 'book'; def = ROUTES.book; }
  const wanted = '#/' + name;
  if (location.hash !== wanted) history.replaceState(null, '', location.pathname + location.search + wanted);

  document.title = def.title + ' · Hacker Sports Facility';
  updateChrome(name);
  clear(els.main);
  els.main.className = 'route-' + name;
  els.main.append(skeleton(3, true));
  const ctx = {
    state: state,
    go: go,
    stale: function () { return id !== routeId; },
    loadMe: loadMe,
    afterSignIn: async function () { await loadMe(); go('#/book'); },
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
    try {
      await loadMe();
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
