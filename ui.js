// Shared UI pieces: banners, skeletons, pills, modal sheet.
import { h, icon, clear, termsLink } from './util.js';
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
};
export function sharePill(status) {
  const d = SHARE_PILL[status];
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
