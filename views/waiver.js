// In-app Participant Agreement (Phase 2A): read, scroll to the end, fill in, sign.
// Minors (under 18) enter a parent/guardian, who is emailed a link to sign; the waiver is on file after that.
import { call, isMock, friendlyMessage, saveCache } from '../api.js';
import { h, icon, clear, isEmail, fullName, todayYmd, parseLocal } from '../util.js';
import { banner, field, setBusy } from '../ui.js';

const TEXT_KEY = 'hsf_waiver_text';

// me.waiver, with a fallback for an engine that only sends waiver_on_file.
export function waiverOf(me) {
  if (me && me.waiver && me.waiver.status) return me.waiver;
  return { status: me && me.waiver_on_file ? 'signed' : 'none', version: 1 };
}

// ---- agreement text (cached by version; never cached in demo mode so demo text can't leak into the real app) ----
async function getText(wantVersion) {
  if (!isMock()) {
    try {
      const c = JSON.parse(localStorage.getItem(TEXT_KEY) || 'null');
      if (c && wantVersion && c.version === wantVersion && Array.isArray(c.sections)) return c;
    } catch (e) { /* no cache */ }
  }
  const t = await call('waiverText', {});
  if (!isMock()) { try { localStorage.setItem(TEXT_KEY, JSON.stringify(t)); } catch (e) { /* optional */ } }
  return t;
}

// Body text uses blank lines between paragraphs and "• " at the start of bullet lines.
function bodyNodes(body) {
  const out = [];
  String(body || '').split(/\n\s*\n/).forEach(function (block) {
    let list = null;
    block.split('\n').forEach(function (line) {
      if (/^\s*•\s?/.test(line)) {
        if (!list) { list = h('ul'); out.push(list); }
        list.append(h('li', { text: line.replace(/^\s*•\s?/, '') }));
      } else if (line.trim()) {
        list = null;
        out.push(h('p', { text: line.trim() }));
      }
    });
  });
  return out;
}

// Returns { el, end } where end is the sentinel placed after the last section.
function agreementEl(t) {
  const end = h('div', { class: 'agreement-end', 'aria-hidden': 'true' });
  const el = h('article', { class: 'agreement', tabindex: '0', 'aria-label': 'Participant Agreement text' },
    h('p', { class: 'hint', text: 'Version ' + t.version + ' · Effective ' + t.effective }),
    h('h2', { class: 'ag-title', text: t.title }),
    t.subtitle ? h('p', { class: 'ag-sub', text: t.subtitle }) : null,
    t.intro ? h('p', { class: 'ag-box', text: t.intro }) : null,
    (t.sections || []).map(function (s) { return h('section', null, h('h3', { text: s.heading }), bodyNodes(s.body)); }),
    end);
  return { el: el, end: end };
}

// ---- dates ----
function formatDobInput(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + '/' + d.slice(2);
  return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
}
// 'MM/DD/YYYY' -> { y, m, d } or null if not a real date from 1900 on.
function parseDob(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = +m[1], d = +m[2], y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (y < 1900 || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y: y, m: mo, d: d };
}
function ageOf(dob) {
  const t = parseLocal(todayYmd());
  let age = t.y - dob.y;
  if (t.mo < dob.m || (t.mo === dob.m && t.d < dob.d)) age--;
  return age;
}
function inFuture(dob) {
  const t = parseLocal(todayYmd());
  return dob.y * 10000 + dob.m * 100 + dob.d > t.y * 10000 + t.mo * 100 + t.d;
}
// 'YYYY-MM-DD...' (as the engine may store it) -> 'MM/DD/YYYY'; other text is passed through if it already looks right.
function dobPrefill(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (m) return m[2] + '/' + m[3] + '/' + m[1];
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(s || '')) ? s : '';
}

// ---- resend (shared with the Account screen) ----
// Sends the guardian email again; shows the result in `slot`. Returns the guardian email or ''.
export async function resendGuardian(btn, slot) {
  clear(slot);
  setBusy(btn, true, 'Sending…');
  try {
    const r = await call('resendGuardianEmail', {});
    slot.append(banner('Email sent' + (r && r.guardian_email ? ' to ' + r.guardian_email : '') + '.', 'info'));
    return (r && r.guardian_email) || '';
  } catch (e) {
    const msg = e && e.code === 'RATE_LIMITED'
      ? (e.message || 'We just sent that email. Please wait a few minutes before sending it again.')
      : friendlyMessage(e);
    slot.append(banner(msg));
    return '';
  } finally {
    setBusy(btn, false);
  }
}

export async function renderWaiver(root, ctx) {
  try { await ctx.loadMe(); } catch (e) { if (e && e.code === 'UNAUTHORIZED') return; /* use what we have */ }
  if (ctx.stale()) return;

  const content = h('div');
  root.append(h('h1', { text: 'Participant Agreement' }), content);

  function remember() {
    // Keep the saved startup copy in step so the Book banner is right on the next launch.
    const s = ctx.state;
    if (s.resources && s.avail) saveCache({ me: s.me, resources: s.resources, availability: s.avail });
  }

  async function paint() {
    clear(content);
    const w = waiverOf(ctx.state.me);
    if (w.status === 'signed') return paintSigned(w);
    if (w.status === 'awaiting_guardian') return paintWaiting(w.guardian_email, false);
    return paintForm();
  }

  // ---- already signed ----
  function paintSigned(w) {
    const textSlot = h('div');
    const toggle = h('button', { class: 'btn block', type: 'button', 'aria-expanded': 'false', text: 'Read the agreement' });
    let loaded = false;
    toggle.addEventListener('click', async function () {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) { textSlot.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Read the agreement'; return; }
      textSlot.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Hide the agreement';
      if (loaded) return;
      setBusy(toggle, true);
      try {
        const t = await getText(w.version);
        clear(textSlot);
        textSlot.append(agreementEl(t).el);
        loaded = true;
      } catch (e) { clear(textSlot); textSlot.append(banner(e)); }
      setBusy(toggle, false);
      toggle.textContent = 'Hide the agreement';
    });
    content.append(
      h('section', { class: 'card' },
        h('p', null, h('span', { class: 'pill ok', text: 'On file' }), ' Your waiver is on file (Version ' + (w.version || 1) + ').'),
        toggle),
      textSlot,
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/book', text: 'Back to the app' })));
  }

  // ---- minor: waiting for the parent or guardian ----
  function paintWaiting(guardianEmail, justSent) {
    const slot = h('div');
    const resend = h('button', { class: 'btn', type: 'button', text: 'Resend email' });
    resend.addEventListener('click', function () { resendGuardian(resend, slot); });
    const rows = [resend, h('a', { class: 'btn primary', href: '#/book', text: 'Back to the app' })];
    if (isMock()) {
      const demo = h('button', { class: 'btn ghost', type: 'button', text: 'Demo: simulate parent signing' });
      demo.addEventListener('click', async function () {
        setBusy(demo, true, 'Signing…');
        try {
          await call('mockGuardianSign', {});
          await ctx.loadMe();
          remember();
          if (!ctx.stale()) paint();
        } catch (e) { clear(slot); slot.append(banner(e)); setBusy(demo, false); }
      });
      rows.push(demo);
    }
    content.append(h('section', { class: 'card done' },
      h('div', { class: 'done-mark' }, icon('clock', 30)),
      h('p', { class: 'done-msg', text: justSent ? 'Almost done' : 'Waiting for your parent or guardian' }),
      h('p', { text: 'We emailed ' + (guardianEmail || 'your parent or guardian') + '. Your waiver will be on file once they sign. The link works for 14 days.' }),
      slot,
      h('div', { class: 'btn-row' }, rows)));
  }

  // ---- adult: signed ----
  function paintDone() {
    content.append(h('section', { class: 'card done' },
      h('div', { class: 'done-mark' }, icon('check', 30)),
      h('p', { class: 'done-msg', text: 'Your waiver is on file.' }),
      h('p', { text: 'A copy was emailed to you.' }),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/book', text: 'Back to the app' }))));
  }

  // ---- the form ----
  async function paintForm() {
    content.append(h('div', { class: 'skeletons' }, h('div', { class: 'skeleton tall' }), h('div', { class: 'skeleton tall' })));
    let t;
    try { t = await getText(waiverOf(ctx.state.me).version); }
    catch (e) {
      if (ctx.stale()) return;
      clear(content);
      content.append(banner(e), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: paint }));
      return;
    }
    if (ctx.stale()) return;
    clear(content);

    const m = ctx.state.me.member;
    const ag = agreementEl(t);
    const gate = h('p', { class: 'gate-note', role: 'status', text: 'Scroll to the end of the agreement to continue.' });

    const name = h('input', { type: 'text', autocomplete: 'name', value: fullName(m).trim() });
    const dob = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'MM/DD/YYYY', maxlength: '10', value: dobPrefill(m.date_of_birth) });
    const phone = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: m.phone || '' });
    const ecName = h('input', { type: 'text', autocomplete: 'off', value: m.emergency_contact_name || '' });
    const ecPhone = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: m.emergency_contact_phone || '' });

    const gName = h('input', { type: 'text', autocomplete: 'off' });
    const gEmail = h('input', { type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const gRel = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Mother, father, legal guardian…' });
    const guardianSet = h('fieldset', { class: 'guardian', hidden: true },
      h('legend', { text: 'Parent or guardian' }),
      h('p', { class: 'hint', text: "We'll email your parent or guardian to review and sign. Your waiver is on file once they sign." }),
      field('Parent or guardian full name', gName),
      field('Parent or guardian email', gEmail, 'Must be their own email, not yours.'),
      field('Relationship to you', gRel));

    const agree = h('input', { type: 'checkbox', id: 'wv-agree' });
    const agreeRow = h('label', { class: 'check-row agree-row', for: 'wv-agree' }, agree,
      h('span', { text: 'I have read and agree to the Participant Agreement (Version ' + t.version + '), including the release of liability, the binding arbitration agreement and the jury trial waiver.' }));
    const sig = h('input', { type: 'text', autocomplete: 'off' });
    const sigField = field('Type your full legal name as your electronic signature.', sig);
    const sigLabel = sigField.querySelector('label');
    const errSlot = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn primary block', type: 'submit', text: 'Sign the agreement' });

    const fields = h('fieldset', { class: 'sign-fields', disabled: true },
      h('legend', { class: 'sr-only', text: 'Your details' }),
      field('Full legal name', name),
      field('Date of birth', dob, 'MM/DD/YYYY'),
      field('Mobile phone', phone),
      h('div', { class: 'grid2' }, field('Emergency contact name', ecName), field('Emergency contact phone', ecPhone)),
      guardianSet,
      agreeRow, sigField, errSlot, submit);
    const form = h('form', { class: 'card sign-form', novalidate: true }, h('h2', { text: 'Sign the agreement' }), gate, fields);

    let minor = false;
    function refreshMinor() {
      const d = parseDob(dob.value);
      minor = !!d && !inFuture(d) && ageOf(d) < 18;
      guardianSet.hidden = !minor;
      submit.textContent = minor ? 'Send to my parent/guardian' : 'Sign the agreement';
      sigLabel.textContent = minor ? 'Type your full name to acknowledge the agreement.' : 'Type your full legal name as your electronic signature.';
    }
    dob.addEventListener('input', function () {
      const f = formatDobInput(dob.value);
      if (f !== dob.value) dob.value = f;
      refreshMinor();
    });
    refreshMinor();

    content.append(
      h('p', { class: 'hint', text: 'Please read the whole agreement, then sign at the bottom.' }),
      ag.el, form);

    // The fields unlock only once the end of the agreement has been scrolled into view (same idea as terms.html).
    function unlock() {
      if (!fields.disabled) return;
      fields.disabled = false;
      gate.textContent = 'You have reached the end of the agreement. Fill in your details below.';
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { unlock(); io.disconnect(); }
      });
      io.observe(ag.end);
    } else {
      const check = function () {
        if (ag.end.getBoundingClientRect().top <= window.innerHeight) { unlock(); window.removeEventListener('scroll', check); }
      };
      window.addEventListener('scroll', check, { passive: true });
      check();
    }

    function problem() {
      const need = [[name, 'your full legal name'], [phone, 'your mobile phone'], [ecName, 'an emergency contact name'], [ecPhone, 'an emergency contact phone']];
      for (let i = 0; i < need.length; i++) if (!need[i][0].value.trim()) return [need[i][0], 'Please enter ' + need[i][1] + '.'];
      const d = parseDob(dob.value);
      if (!d) return [dob, 'Enter your date of birth as MM/DD/YYYY, for example 04/23/1990.'];
      if (inFuture(d)) return [dob, 'Your date of birth cannot be in the future.'];
      if (minor) {
        if (!gName.value.trim()) return [gName, "Please enter your parent or guardian's name."];
        if (!isEmail(gEmail.value)) return [gEmail, "Please enter your parent or guardian's email address."];
        if (gEmail.value.trim().toLowerCase() === String(m.email || '').toLowerCase()) return [gEmail, 'A parent or guardian must use their own email address.'];
        if (!gRel.value.trim()) return [gRel, 'Please enter how they are related to you (for example, mother or legal guardian).'];
      }
      if (!agree.checked) return [agree, 'Please check the box to agree to the Participant Agreement.'];
      if (!sig.value.trim()) return [sig, minor ? 'Please type your full name.' : 'Please type your full legal name as your signature.'];
      return null;
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clear(errSlot);
      if (fields.disabled) return;
      const p = problem();
      if (p) { errSlot.append(banner(p[1])); p[0].focus(); return; }
      const params = {
        version: t.version,
        participant_name: name.value.trim(),
        date_of_birth: dob.value,
        phone: phone.value.trim(),
        emergency_contact_name: ecName.value.trim(),
        emergency_contact_phone: ecPhone.value.trim(),
        agreed: true,
        signature: sig.value.trim(),
      };
      if (minor) params.guardian = { name: gName.value.trim(), email: gEmail.value.trim(), relationship: gRel.value.trim() };
      setBusy(submit, true, minor ? 'Sending…' : 'Signing…');
      let r;
      try { r = await call('signWaiver', params); }
      catch (err) { errSlot.append(banner(err)); setBusy(submit, false); return; }
      try { await ctx.loadMe(); remember(); } catch (err) { /* the result is shown either way */ }
      if (ctx.stale()) return;
      clear(content);
      window.scrollTo(0, 0);
      if (r && r.status === 'AwaitingGuardian') paintWaiting((r.guardian_email || params.guardian.email), true);
      else paintDone();
    });
  }

  await paint();
}
