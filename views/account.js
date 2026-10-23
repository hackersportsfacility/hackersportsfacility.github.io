import { call, clearToken, clearCache } from '../api.js';
import { h, add, clear, fullName, termsLink, fmtDate, hashParams, clearHashParams, cardLabel, money } from '../util.js';
import { banner, setBusy, startCardFlow } from '../ui.js';
import { waiverOf, resendGuardian } from './waiver.js';

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
  if (me.member.role === 'Family') {
    return h('div', null,
      h('p', { class: 'hint', text: 'Fees, payments, cancellations and credits. As a family member, you don’t need to accept these.' }),
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

function waiverBlock(me) {
  const w = waiverOf(me);
  if (w.status === 'signed') {
    return h('div', null,
      h('p', null, h('span', { class: 'pill ok', text: 'On file' }), ' Your waiver is on file.'),
      h('a', { class: 'btn', href: '#/waiver', text: 'Read the agreement' }));
  }
  if (w.status === 'awaiting_guardian') {
    const slot = h('div');
    const resend = h('button', { class: 'btn', type: 'button', text: 'Resend email' });
    resend.addEventListener('click', function () { resendGuardian(resend, slot); });
    return h('div', null,
      h('p', null, h('span', { class: 'pill warn', text: 'Pending' }), ' Waiting for parent/guardian (' + (w.guardian_email || 'email sent') + ')'),
      slot,
      h('div', { class: 'btn-row' }, resend, h('a', { class: 'btn', href: '#/waiver', text: 'View status' })));
  }
  return h('div', null,
    h('p', null, h('span', { class: 'pill warn', text: 'Needed' }), ' We do not have your waiver yet.'),
    h('a', { class: 'btn primary', href: '#/waiver', text: 'Sign the waiver' }));
}

// Payment card card: add / replace / remove. Re-reads ctx.state.me.card each time it paints.
function cardBlock(ctx, noteSlot) {
  const wrap = h('div');
  const errSlot = h('div');
  const actions = h('div', { class: 'btn-row' });

  async function refreshMe() {
    clearCache();
    await ctx.loadMe();
    paint();
  }
  async function onSaved() {
    await refreshMe();
    clear(noteSlot);
    noteSlot.append(banner('Card saved', 'info'));
  }

  function paint() {
    const me = ctx.state.me;
    const card = me.card;
    clear(wrap);
    clear(actions);
    if (card) {
      const replace = h('button', { class: 'btn', type: 'button', text: 'Replace card' });
      replace.addEventListener('click', function () { clear(noteSlot); startCardFlow(replace, errSlot, null, onSaved); });
      actions.append(replace, h('button', { class: 'btn danger-ghost', type: 'button', text: 'Remove card', onclick: confirmRemove }));
      wrap.append(h('p', { class: 'card-line' }, h('span', { class: 'pill ok', text: 'Saved' }), ' ', cardLabel(card)));
    } else {
      const add = h('button', { class: 'btn primary', type: 'button', text: 'Add payment card' });
      add.addEventListener('click', function () { clear(noteSlot); startCardFlow(add, errSlot, null, onSaved); });
      actions.append(add);
      wrap.append(h('p', { text: "You haven't added a payment card yet." }));
    }
    add(wrap,
      h('p', { class: 'hint', text: (card ? 'Your card has been stored by Stripe' : 'Cards are stored by Stripe') + ', our secure payment processor. Hacker Sports Facility never sees or keeps your card number. Your card is charged about 24 hours before each booking.' }),
      me.payments_enabled === false ? h('p', { class: 'hint', text: 'Automatic charging is paused right now.' }) : null,
      errSlot, actions);
  }

  function confirmRemove() {
    clear(actions);
    clear(errSlot);
    clear(noteSlot);
    const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, remove card' });
    const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm remove card' },
      h('p', { text: 'Remove your saved card?' }),
      h('p', { class: 'hint', text: 'You will need to add a card again before you can request bookings.' }),
      h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep card', onclick: paint })));
    yes.addEventListener('click', async function () {
      setBusy(yes, true, 'Removing…');
      try {
        await call('removeCard', {});
        await refreshMe();
        noteSlot.append(banner('Card removed', 'info'));
      } catch (e) {
        clear(errSlot);
        errSlot.append(banner(e));
        setBusy(yes, false);
      }
    });
    actions.append(panel);
    yes.focus();
  }

  paint();
  return wrap;
}

// Facility credit: shown when there is a balance or any unexpired lot.
function creditsBlock(me) {
  const c = me.credits;
  const lots = (c && c.lots) || [];
  const balance = c ? Number(c.balance) || 0 : 0;
  if (!(balance > 0) && !lots.length) return null;
  const ul = h('ul', { class: 'players detail credit-lots' });
  lots.forEach(function (l) {
    ul.append(h('li', null, h('span', { class: 'mono', text: money(l.amount_remaining) + ', expires ' + fmtDate(l.expires_at) })));
  });
  return h('section', { class: 'card' },
    h('h2', { text: money(balance) + ' in facility credit' }),
    lots.length ? ul : null,
    h('p', { class: 'hint', text: 'Credit is used automatically on your next booking.' }));
}

export async function renderAccount(root, ctx) {
  // Coming back from Stripe: #/account?card=done&cs=... or ?card=cancel
  const noteSlot = h('div');
  const params = hashParams();
  if (params.card) {
    clearHashParams();
    if (params.card === 'done' && params.cs) {
      try {
        await call('confirmCardSetup', { cs: params.cs });
        clearCache();
        await ctx.loadMe();
        noteSlot.append(banner('Card saved', 'info'));
      } catch (e) {
        noteSlot.append(banner(e));
      }
      if (ctx.stale()) return;
    } else if (params.card === 'cancel') {
      noteSlot.append(banner('No card was saved.', 'info'));
    }
  }
  const me = ctx.state.me;
  const m = me.member;
  const errSlot = h('div');

  const waiver = waiverBlock(me);

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

  add(root,
    h('h1', { text: 'Account' }),
    h('section', { class: 'card' },
      h('h2', { text: fullName(m) }),
      h('p', { class: 'hint', text: m.email + (m.is_owner ? ' · Owner' : '') }),
      m.role === 'Family' ? h('p', { class: 'hint', text: 'Family member' }) : null),
    h('section', { class: 'card' }, h('h2', { text: 'Waiver' }), waiver),
    h('section', { class: 'card' }, h('h2', { text: 'Booking and Payment Terms' }), termsBlock(me)),
    h('section', { class: 'card' }, h('h2', { text: 'Payment card' }), noteSlot, cardBlock(ctx, noteSlot)),
    creditsBlock(me),
    h('section', { class: 'card' }, h('h2', { text: 'Add to Home Screen' }),
      h('p', { class: 'hint', text: 'Open the app like any other app, straight from your home screen.' }), steps),
    errSlot,
    out);

  // Now that this screen is fully drawn, let a background refresh redraw it with the latest details.
  if (!ctx.stale()) ctx.state.onFresh = function () { ctx.go('#/account'); };
}
