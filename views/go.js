// Public route #/go?t=TOKEN: the page every approval / guardian-signing email links to (Release 2.2).
// Works signed in or out. The token is the credential; linkInfo only reads, linkConfirm acts.
import { call, getToken } from '../api.js';
import { h, clear, icon, hashParams, money, fullName } from '../util.js';
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
    // One button per link: label, busy label, fallback message and an optional note, by link kind and d.
    const V = {
      approve: ['Approve', 'Approving…', 'Approved.', 'primary'],
      reject: ['Reject', 'Rejecting…', 'Rejected.', 'danger'],
      approve_waive: ['Approve and waive fees', 'Approving…', 'Approved with fees waived.', 'primary',
        'This approves the booking and waives every player’s fee. Anything already paid is returned as a facility credit.'],
      credit: ['Waive as credit', 'Waiving…', 'Done. The payments were returned as facility credit.', 'primary',
        'Every payment for this booking is returned to the player as a facility credit, good for 12 months.'],
      keep: ['Keep the charges', 'Saving…', 'Done. The charges stand.', 'primary',
        'The charges for this late cancellation stay as they are.'],
      bump: ['Bump this booking', 'Bumping…', 'Done. The booking was cancelled and the players have been emailed.', 'danger',
        'Cancels the member’s booking for free. Anything they paid comes back as for any cancellation by the facility, and the players are emailed. Then your repeating entry takes the court.'],
      skip: ['Skip this date', 'Skipping…', 'Done. This date is skipped.', 'primary',
        'The member’s booking stays as it is and this date is left out of your repeating entry.'],
    };
    const v = V[i.d] || V.approve;
    const errSlot = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn ' + v[3], type: 'button', text: v[0] });
    btn.addEventListener('click', async function () {
      clear(errSlot);
      setBusy(btn, true, v[1]);
      try {
        const r = await call('linkConfirm', { t: t });
        if (ctx.stale()) return;
        message('ok', (r && r.message) || v[2]);
      } catch (e) { errSlot.append(banner(e)); setBusy(btn, false); }
    });
    clear(content);
    content.append(h('section', { class: 'card' },
      h('h2', { text: i.summary }), detailList(i.details), v[4] ? h('p', { class: 'hint', text: v[4] }) : null, errSlot,
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

  // ---- a booker's invitation to play: Accept / Decline (Phase 2C-2) ----
  function paintInvite(i) {
    const inv = i.invite || {};
    const booker = inv.booker_name || 'Someone';
    const me = ctx.state.member;
    const items = inv.items || [];
    const errSlot = h('div', { 'aria-live': 'polite' });
    const acceptBtn = h('button', { class: 'btn primary', type: 'button', text: me && inv.needs_signup ? 'Accept as ' + fullName(me).trim() : 'Accept' });
    const declineBtn = h('button', { class: 'btn', type: 'button', text: 'Decline' });
    const formSlot = h('div');
    const btnRow = h('div', { class: 'btn-row' }, acceptBtn, declineBtn);

    async function send(btn, label, params, doneText) {
      clear(errSlot);
      acceptBtn.disabled = true; declineBtn.disabled = true;
      setBusy(btn, true, label);
      try {
        const r = await call('linkConfirm', Object.assign({ t: t }, params));
        if (ctx.stale()) return;
        window.scrollTo(0, 0);
        message('ok', doneText || (r && r.message));
      } catch (e) {
        errSlot.append(banner(e));
        // Someone who owes money must pay first (Amount Owed): send them to the Account screen, where Pay now is.
        if (e && e.code === 'AMOUNT_OWED') errSlot.append(h('a', { class: 'btn primary block', href: '#/account', text: 'Go to Account to pay' }));
        setBusy(btn, false);
        acceptBtn.disabled = false; declineBtn.disabled = false;
      }
    }
    declineBtn.addEventListener('click', function () { send(declineBtn, 'Declining…', { choice: 'decline' }, "Thanks, we've let " + booker + ' know.'); });

    function showSignup() {
      btnRow.hidden = true;
      clear(formSlot);
      clear(errSlot);
      const f = {
        first_name: h('input', { type: 'text', autocomplete: 'given-name', required: true }),
        last_name: h('input', { type: 'text', autocomplete: 'family-name', required: true }),
        phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true }),
        emergency_contact_name: h('input', { type: 'text', autocomplete: 'off', required: true }),
        emergency_contact_phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', required: true }),
      };
      const emailBox = h('input', { type: 'text', value: inv.masked_email || '', disabled: true });
      const slot = h('div', { 'aria-live': 'polite' });
      const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'Join and accept' });
      const form = h('form', { class: 'card', novalidate: true },
        h('h2', { text: 'Tell us about yourself' }),
        h('p', { class: 'hint', text: 'Hacker Sports Facility is members-only. The owner will review your details before you can play.' }),
        h('div', { class: 'grid2' }, field('First name', f.first_name), field('Last name', f.last_name)),
        field('Email', emailBox, 'This is the address the invitation was sent to.'),
        field('Mobile phone', f.phone),
        h('h3', { class: 'small-h', text: 'Emergency contact' }),
        h('div', { class: 'grid2' }, field('Contact name', f.emergency_contact_name), field('Contact phone', f.emergency_contact_phone)),
        slot, submit,
        me ? null : h('p', { class: 'center' }, h('a', { href: '#/signin?next=' + encodeURIComponent('#/go?t=' + t), text: 'I already have an account under a different email' })));
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        clear(slot);
        const signup = {};
        for (const k of Object.keys(f)) signup[k] = f[k].value.trim();
        for (const k of Object.keys(signup)) {
          if (!signup[k]) { slot.append(banner('Please fill in every field.')); f[k].focus(); return; }
        }
        setBusy(submit, true, 'Sending…');
        try {
          await call('linkConfirm', { t: t, choice: 'accept', signup: signup });
          if (ctx.stale()) return;
          window.scrollTo(0, 0);
          message('ok', "Thanks! The facility owner will review your membership. You'll get an email when it's approved.");
        } catch (err) { slot.append(banner(err)); setBusy(submit, false); }
      });
      formSlot.append(form);
      f.first_name.focus();
    }

    acceptBtn.addEventListener('click', function () {
      if (!inv.needs_signup) return send(acceptBtn, 'Accepting…', { choice: 'accept' }, "You're in! " + booker + ' can see you on the booking.');
      if (me) return send(acceptBtn, 'Accepting…', { choice: 'accept', session: getToken() }, "You're in! " + booker + ' can see you on the booking.');
      showSignup();
    });

    const list = h('ul', { class: 'invite-times' }, items.map(function (it) {
      const closed = it.booking_status === 'Cancelled' || it.booking_status === 'Rejected';
      return h('li', null,
        h('span', null, h('strong', { text: it.resource_name }), h('span', { class: 'mono', text: ' · ' + it.when }),
          closed ? h('span', { class: 'tag warn', text: it.booking_status }) : null,
          it.booking_status === 'Pending' ? h('span', { class: 'tag', text: 'Awaiting approval' }) : null),
        h('span', { class: 'share', text: it.share_label || (it.share_amount > 0 ? 'Your share: ' + money(it.share_amount) : 'No charge') }));
    }));
    clear(content);
    content.append(
      h('section', { class: 'card' },
        h('h2', { text: i.summary || booker + ' invited you to play' }),
        list,
        inv.needs_signup && me ? h('p', { class: 'hint', text: 'You are signed in as ' + fullName(me).trim() + '.' }) : null,
        h('p', { class: 'hint', text: "If you don't accept, nothing is charged to you." }),
        errSlot, btnRow,
        inv.needs_signup && me ? h('p', { class: 'center' }, h('button', { class: 'link', type: 'button', text: 'Sign up as a new person instead', onclick: showSignup })) : null),
      formSlot, toApp());
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
  if (info.kind === 'invite') paintInvite(info);
  else if (info.kind === 'guardian') paintGuardian(info);
  else paintDecision(info);
}
