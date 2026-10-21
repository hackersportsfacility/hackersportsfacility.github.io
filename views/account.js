import { call, clearToken } from '../api.js';
import { h, fullName, termsLink, fmtDate } from '../util.js';
import { banner, setBusy } from '../ui.js';

function platform() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

function isInstalled() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch (e) { return false; }
}

function termsBlock(me) {
  const t = me.terms || { accepted: false, version: 1 };
  if (me.member.is_owner) {
    return h('div', null,
      h('p', { class: 'hint', text: 'Fees, payments, cancellations and credits. As the owner, you don’t need to accept these.' }),
      h('a', { class: 'btn', href: termsLink('account'), text: 'Read the terms' }));
  }
  if (t.accepted) {
    return h('div', null,
      h('p', null, h('span', { class: 'pill ok', text: 'Accepted' }),
        ' Version ' + t.version + (t.accepted_at ? ', accepted ' + fmtDate(t.accepted_at) : '') + '.'),
      h('a', { class: 'btn', href: termsLink('account'), text: 'Read the terms' }));
  }
  return h('div', null,
    h('p', null, h('span', { class: 'pill warn', text: 'Needed' }),
      t.accepted_version ? ' The terms have been updated. Please read and accept the new version.' : ' Please read and accept these before booking.'),
    h('p', { class: 'hint', text: 'Fees, payments, cancellations and credits. Scroll to the end of the terms and check the box to accept.' }),
    h('a', { class: 'btn primary', href: termsLink('account'), text: 'Read and accept the terms' }));
}

export async function renderAccount(root, ctx) {
  const me = ctx.state.me;
  const m = me.member;
  const errSlot = h('div');

  const waiver = me.waiver_on_file
    ? h('p', null, h('span', { class: 'pill ok', text: 'On file' }), ' Your waiver is on file.')
    : h('div', null,
      h('p', null, h('span', { class: 'pill warn', text: 'Needed' }), ' We do not have your waiver yet.'),
      me.waiver_form_url ? h('a', { class: 'btn primary', href: me.waiver_form_url, target: '_blank', rel: 'noopener', text: 'Sign the waiver' }) : null);

  const p = platform();
  let steps;
  if (isInstalled()) steps = h('p', { text: 'This app is installed on your device.' });
  else if (p === 'ios') steps = h('ol', null, h('li', { text: 'Open this page in Safari.' }), h('li', { text: 'Tap the Share button.' }), h('li', { text: 'Choose Add to Home Screen.' }), h('li', { text: 'Tap Add.' }));
  else if (p === 'android') steps = h('ol', null, h('li', { text: 'Open this page in Chrome.' }), h('li', { text: 'Tap the menu (three dots).' }), h('li', { text: 'Choose Install app or Add to Home screen.' }), h('li', { text: 'Tap Install.' }));
  else steps = h('p', { text: 'On your phone, open this page and use Share → Add to Home Screen (iPhone) or menu → Install app (Android).' });

  const out = h('button', { class: 'btn block', type: 'button', text: 'Sign out' });
  out.addEventListener('click', async function () {
    setBusy(out, true, 'Signing out…');
    try { await call('signOut', {}); } catch (e) { /* sign out locally either way */ }
    clearToken();
    ctx.afterSignOut();
  });

  root.append(
    h('h1', { text: 'Account' }),
    h('section', { class: 'card' },
      h('h2', { text: fullName(m) }),
      h('p', { class: 'hint', text: m.email + (m.is_owner ? ' · Owner' : '') })),
    h('section', { class: 'card' }, h('h2', { text: 'Waiver' }), waiver),
    h('section', { class: 'card' }, h('h2', { text: 'Booking and Payment Terms' }), termsBlock(me)),
    h('section', { class: 'card' }, h('h2', { text: 'Add to Home Screen' }),
      h('p', { class: 'hint', text: 'Open the app like any other app, straight from your home screen.' }), steps),
    errSlot,
    out);
}
