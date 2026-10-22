// Public route #/go?t=TOKEN: the page every approval / guardian-signing email links to (Release 2.2).
// Works signed in or out. The token is the credential; linkInfo only reads, linkConfirm acts.
import { call } from '../api.js';
import { h, clear, icon, hashParams } from '../util.js';
import { banner, field, setBusy } from '../ui.js';
import { agreementEl, onReachEnd } from './waiver.js';

const LABELS = {
  players: 'Players', price: 'Price', total: 'Total', total_amount: 'Total', booker: 'Requested by', requested_by: 'Requested by',
  name: 'Name', email: 'Email', phone: 'Phone', minor: 'Participant', minor_name: 'Participant', minor_dob: 'Date of birth',
  date_of_birth: 'Date of birth', dob: 'Date of birth', relationship: 'Relationship', guardian_name: 'Parent or guardian',
};

// details may be an array of [label, value] pairs (what the engine sends), strings or
// {label,value} objects, a plain object, or a string.
function detailRows(details) {
  const rows = [];
  if (!details) return rows;
  if (typeof details === 'string') return [['', details]];
  if (Array.isArray(details)) {
    details.forEach(function (d) {
      if (d == null) return;
      if (Array.isArray(d)) rows.push([String(d[0] == null ? '' : d[0]), String(d[1] == null ? '' : d[1])]);
      else if (typeof d === 'object') rows.push([String(d.label || ''), String(d.value == null ? '' : d.value)]);
      else rows.push(['', String(d)]);
    });
    return rows;
  }
  Object.keys(details).forEach(function (k) {
    const v = details[k];
    if (v == null || v === '' || typeof v === 'object') return;
    rows.push([LABELS[k] || k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }), String(v)]);
  });
  return rows;
}

function detailList(details) {
  const rows = detailRows(details);
  if (!rows.length) return null;
  const ul = h('ul', { class: 'go-details' });
  rows.forEach(function (r) {
    ul.append(h('li', null, r[0] ? h('strong', { text: r[0] + ': ' }) : null, r[1]));
  });
  return ul;
}

function objectOf(x) { return x && !Array.isArray(x) && typeof x === 'object' ? x : {}; }

function minorNameOf(info) {
  if (info.minor) return String(info.minor); // the engine sends the minor's name at the top level
  const d = info.details;
  const o = objectOf(d);
  const n = o.minor_name || o.minor || o.participant_name || o.name;
  if (n) return String(n);
  if (Array.isArray(d)) {
    const hit = d.filter(function (x) { return x && typeof x === 'object' && /participant|minor|name/i.test(x.label || ''); })[0];
    if (hit && hit.value) return String(hit.value);
  }
  const m = /for (.+?)[?.]?$/.exec(info.summary || '');
  return m ? m[1] : 'the minor';
}

export async function renderGo(root, ctx) {
  const t = String(hashParams().t || '').trim();
  const content = h('div');
  root.append(h('h1', { text: 'Hacker Sports Facility' }), content);
  const toApp = function () { return h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/', text: 'Go to the app' })); };

  function message(kind, text) {
    clear(content);
    content.append(h('section', { class: 'card done' },
      h('div', { class: 'done-mark ' + (kind === 'ok' ? '' : 'warn-mark') }, icon(kind === 'ok' ? 'check' : 'alert', 30)),
      h('p', { class: 'done-msg', text: text }),
      toApp()));
  }

  // ---- booking / member approve or reject ----
  function paintDecision(i) {
    const approve = i.d !== 'reject';
    const errSlot = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn ' + (approve ? 'primary' : 'danger'), type: 'button', text: approve ? 'Approve' : 'Reject' });
    btn.addEventListener('click', async function () {
      clear(errSlot);
      setBusy(btn, true, approve ? 'Approving…' : 'Rejecting…');
      try {
        const r = await call('linkConfirm', { t: t });
        if (ctx.stale()) return;
        message('ok', (r && r.message) || (approve ? 'Approved.' : 'Rejected.'));
      } catch (e) { errSlot.append(banner(e)); setBusy(btn, false); }
    });
    clear(content);
    content.append(h('section', { class: 'card' },
      h('h2', { text: i.summary }), detailList(i.details), errSlot,
      h('div', { class: 'btn-row' }, btn)), toApp());
  }

  // ---- guardian signs the minor's agreement ----
  function paintGuardian(i) {
    const d = objectOf(i.details);
    const text = i.agreement || d.agreement || d.waiver_text;
    const who = minorNameOf(i);
    clear(content);
    if (!text || !text.sections) {
      content.append(banner('The agreement could not be loaded. Please open the link again.'), toApp());
      return;
    }
    const gate = h('p', { class: 'gate-note', role: 'status', text: 'Scroll to the end of the agreement to continue.' });
    const agree = h('input', { type: 'checkbox', id: 'go-agree' });
    const agreeRow = h('label', { class: 'check-row agree-row', for: 'go-agree' }, agree,
      h('span', { text: 'I am the parent or legal guardian of ' + who + ' and I agree to the Participant Agreement on their behalf, including the release of liability, the binding arbitration agreement and the jury trial waiver.' }));
    const sig = h('input', { type: 'text', autocomplete: 'name' });
    const sigField = field('Type your full legal name as your electronic signature.', sig);
    const errSlot = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'Sign' });
    const fields = h('fieldset', { class: 'sign-fields', disabled: true }, h('legend', { class: 'sr-only', text: 'Sign' }), agreeRow, sigField, errSlot, submit);
    const form = h('form', { class: 'card sign-form', novalidate: true }, h('h2', { text: 'Sign the agreement' }), gate, fields);
    const ag = agreementEl(text);
    content.append(
      h('section', { class: 'card' }, h('h2', { text: i.summary }), detailList(i.details)),
      h('p', { class: 'hint', text: 'Please read the whole agreement, then sign at the bottom.' }),
      ag.el, form);
    onReachEnd(ag.end, function () {
      fields.disabled = false;
      gate.textContent = 'You have reached the end of the agreement. Check the box and sign below.';
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clear(errSlot);
      if (fields.disabled) return;
      if (!agree.checked) { errSlot.append(banner('Please check the box to agree.')); agree.focus(); return; }
      if (!sig.value.trim()) { errSlot.append(banner('Please type your full legal name.')); sig.focus(); return; }
      setBusy(submit, true, 'Signing…');
      try {
        const r = await call('linkConfirm', { t: t, name: sig.value.trim() });
        if (ctx.stale()) return;
        window.scrollTo(0, 0);
        message('ok', (r && r.message) || 'Thank you. The agreement is signed.');
      } catch (err) { errSlot.append(banner(err)); setBusy(submit, false); }
    });
  }

  if (!t) { message('bad', 'This link is incomplete. Open the link from your email again.'); return; }

  let info;
  try { info = await call('linkInfo', { t: t }); }
  catch (e) {
    if (ctx.stale()) return;
    clear(content);
    content.append(banner(e), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { ctx.go(location.hash); } }), toApp());
    return;
  }
  if (ctx.stale()) return;

  if (info.state === 'invalid') return message('bad', info.summary || 'This link is not valid. Please use the link from your most recent email.');
  if (info.state === 'expired') return message('bad', info.summary || 'This link has expired. Ask for a new email and try again.');
  if (info.state === 'already') return message('ok', info.summary || 'This has already been done. Nothing more is needed.');
  if (info.state !== 'ready') return message('bad', 'This link could not be used.');
  if (info.kind === 'guardian') paintGuardian(info);
  else paintDecision(info);
}
