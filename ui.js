// Shared UI pieces: banners, skeletons, pills, modal sheet.
import { h, icon, clear, termsLink, money } from './util.js';
import { friendlyMessage, call, clearCache } from './api.js';

export function banner(errOrMsg, kind) {
  const msg = typeof errOrMsg === 'string' ? errOrMsg : friendlyMessage(errOrMsg);
  return h('div', { class: 'banner ' + (kind || 'error'), role: kind === 'info' ? 'status' : 'alert' },
    icon(kind === 'info' ? 'check' : 'alert', 18), h('span', { text: msg }));
}

// Replace the contents of a slot element with a banner (or empty it).
export function showError(slot, err) {
  clear(slot);
  if (err) slot.append(banner(err));
}

export function skeleton(rows, tall) {
  const wrap = h('div', { class: 'skeletons', 'aria-hidden': 'true' });
  for (let i = 0; i < (rows || 3); i++) wrap.append(h('div', { class: 'skeleton' + (tall ? ' tall' : '') }));
  return wrap;
}

const PILL = {
  Pending: 'warn', Approved: 'ok', Active: 'ok', Completed: 'muted', Cancelled: 'muted', Rejected: 'danger',
  NoShow: 'danger', Suspended: 'warn', Revoked: 'danger',
};
export function pill(status) {
  return h('span', { class: 'pill ' + (PILL[status] || 'muted'), text: status });
}

const ROLE_PILL = { Owner: 'court', Family: 'ok', Member: 'muted', Guest: 'warn' };
export function rolePill(role) {
  return h('span', { class: 'pill ' + (ROLE_PILL[role] || 'muted'), text: role || 'Member' });
}

// Payment share pills (Phase 2B).
const SHARE_PILL = {
  Paid: ['ok', 'Paid'], Pending: ['warn', 'Pending'], Unpaid: ['danger', 'Unpaid'],
  CoveredByBooker: ['muted', 'Covered by booker'], Waived: ['muted', 'Waived'],
  Cancelled: ['muted', 'Cancelled'], Refunded: ['court', 'Refunded'], Credited: ['ok', 'Credited'],
  Owed: ['danger', 'Owed'], BookerOwes: ['warn', 'Booker owes'],
};
export function sharePill(status) {
  const d = SHARE_PILL[status];
  return d ? h('span', { class: 'pill ' + d[0], text: d[1] }) : null;
}

// Invitation status pills (Phase 2C-2). invite_status is '' for the booker and for legacy players.
const INVITE_PILL = { invited: ['warn', 'Invited'], accepted: ['ok', 'Accepted'], declined: ['muted', 'Declined'], no_response: ['muted', 'No response'] };
export function invitePill(status) {
  const d = INVITE_PILL[status];
  return d ? h('span', { class: 'pill ' + d[0], text: d[1] }) : null;
}

// Starts the Stripe card setup. Demo mode answers { mock_saved: true } and we call onSaved();
// otherwise the browser goes to the Stripe page. returnTo is 'book' or omitted (Account).
export async function startCardFlow(btn, errSlot, returnTo, onSaved) {
  clear(errSlot);
  setBusy(btn, true, 'Opening…');
  let out;
  try {
    out = await call('startCardSetup', returnTo ? { return_to: returnTo } : {});
  } catch (e) {
    errSlot.append(banner(e));
    if (e && e.code === 'TERMS_REQUIRED') errSlot.append(h('a', { class: 'btn primary block', href: termsLink(returnTo || 'account'), text: 'Read and accept the terms' }));
    setBusy(btn, false);
    return;
  }
  if (out && out.mock_saved) {
    clearCache();
    try { await onSaved(); } catch (e) { errSlot.append(banner(e)); }
    setBusy(btn, false);
    return;
  }
  if (out && out.url) {
    location.href = out.url;
    setTimeout(function () { setBusy(btn, false); }, 5000); // in case the page stays (back button)
    return;
  }
  errSlot.append(banner('Could not open the card page. Please try again.'));
  setBusy(btn, false);
}

// True when a member owes money (Amount Owed). Owner and Family never do; an older saved `me` has no `owed` at all.
export function owedAmount(me) {
  const o = me && me.owed;
  return o && Number(o.amount) > 0 ? Number(o.amount) : 0;
}

// The red "Amount owed" card (Account and Book). onPaid() runs after a successful payment: reload `me` and repaint.
// A declined card (or no card) offers Add / Replace card right here; returnTo is 'book' or omitted (Account).
export function owedCard(me, returnTo, onPaid) {
  if (!owedAmount(me)) return null;
  const items = (me.owed.items || []);
  const errSlot = h('div', { 'aria-live': 'polite' });
  const cardSlot = h('div');
  const pay = h('button', { class: 'btn danger', type: 'button', text: 'Pay now' });
  pay.addEventListener('click', async function () {
    clear(errSlot);
    clear(cardSlot);
    setBusy(pay, true, 'Paying…');
    try {
      await call('payOwed', {});
      clearCache();
      await onPaid();
    } catch (e) {
      errSlot.append(banner(e));
      if (e && (e.code === 'CARD_DECLINED' || e.code === 'NO_CARD')) {
        const label = e.code === 'NO_CARD' ? 'Add payment card' : 'Replace card';
        const fix = h('button', { class: 'btn primary', type: 'button', text: label });
        fix.addEventListener('click', function () {
          startCardFlow(fix, errSlot, returnTo, async function () {
            clear(errSlot);
            errSlot.append(banner('Card saved. Tap Pay now to try again.', 'info'));
            clear(cardSlot);
            await onPaid(true); // reload details only; this card stays so the member can pay
          });
        });
        cardSlot.append(fix);
      }
      setBusy(pay, false);
    }
  });
  return h('section', { class: 'card owed-card', role: 'region', 'aria-label': 'Amount owed' },
    h('h2', { text: 'Amount owed: ' + money(owedAmount(me)) }),
    h('ul', { class: 'players detail' }, items.map(function (it) {
      return h('li', null, h('span', { text: it.resource_name + ', ' + it.when }), h('span', { class: 'mono share', text: money(it.amount) }));
    })),
    h('p', { class: 'hint', text: 'You can’t make new bookings or accept invitations until this is paid. Facility credit is used first.' }),
    errSlot, h('div', { class: 'btn-row' }, pay, cardSlot));
}

export function setBusy(btn, busy, busyLabel) {
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel) btn.textContent = busyLabel;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null);
}

// Modal bottom sheet. Returns { body, close }.
export function openSheet(title, onClose) {
  const opener = document.activeElement;
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x', 20));
  const titleEl = h('h2', { id: 'sheet-title', text: title });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', tabindex: '-1' },
    h('div', { class: 'sheet-head' }, titleEl, closeBtn), body);
  const overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(); } }, sheet);

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const f = sheet.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    overlay.remove();
    if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* ignore */ } }
    if (onClose) onClose();
  }
  document.addEventListener('keydown', onKey);
  document.body.classList.add('no-scroll');
  document.body.append(overlay);
  sheet.focus();
  return { body: body, close: close, setTitle: function (t) { titleEl.textContent = t; } };
}
