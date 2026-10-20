import { call, isMock } from '../api.js';
import { h, clear, isEmail } from '../util.js';
import { banner, field, setBusy } from '../ui.js';

export async function renderSignin(root, ctx) {
  let email = '';
  const card = h('section', { class: 'card narrow' });
  root.append(h('h1', { text: 'Sign in' }), card);

  function stepEmail(notice) {
    clear(card);
    const slot = h('div');
    const input = h('input', { type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false', required: true, value: email });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Send code' });
    const form = h('form', { novalidate: true }, field('Email', input, 'We will email you a 6-digit code. No password needed.'), slot, btn);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clear(slot);
      email = input.value.trim().toLowerCase();
      if (!isEmail(email)) { slot.append(banner('Enter the email address you signed up with.')); input.focus(); return; }
      setBusy(btn, true, 'Sending…');
      try {
        await call('requestCode', { email: email });
        stepCode(true);
      } catch (err) {
        slot.append(banner(err));
        setBusy(btn, false);
      }
    });
    card.append(form);
    if (notice) slot.append(banner(notice, 'info'));
    if (isMock()) card.append(h('p', { class: 'hint demo-hint', text: 'Demo: any email works. Use alex@example.com to see the member view. The code is 123456.' }));
    card.append(h('p', { class: 'center' }, 'Not a member yet? ', h('a', { href: '#/join', text: 'Request membership' })));
  }

  function stepCode(justSent) {
    clear(card);
    const slot = h('div');
    if (justSent) slot.append(banner('If that email belongs to a member, a code is on its way. It expires in 10 minutes.', 'info'));
    const input = h('input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'one-time-code',
      class: 'code-input', required: true, 'aria-describedby': 'code-hint',
    });
    const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Sign in' });
    const form = h('form', { novalidate: true },
      h('p', { id: 'code-hint', class: 'hint', text: 'Enter the 6-digit code sent to ' + email + '.' }),
      field('Code', input), slot, btn);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clear(slot);
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { slot.append(banner('The code has 6 digits.')); input.focus(); return; }
      setBusy(btn, true, 'Signing in…');
      try {
        await call('verifyCode', { email: email, code: code });
        await ctx.afterSignIn();
      } catch (err) {
        slot.append(banner(err));
        setBusy(btn, false);
        input.select();
      }
    });
    card.append(form,
      h('div', { class: 'row-links' },
        h('button', { class: 'link', type: 'button', text: 'Use a different email', onclick: function () { stepEmail(); } }),
        h('button', {
          class: 'link', type: 'button', text: 'Send a new code', onclick: async function (ev) {
            clear(slot);
            const b = ev.currentTarget;
            b.disabled = true;
            try { await call('requestCode', { email: email }); slot.append(banner('New code sent.', 'info')); }
            catch (err) { slot.append(banner(err)); }
            b.disabled = false;
          },
        })));
    input.focus();
  }

  stepEmail();
}

export async function renderJoin(root, ctx) {
  const card = h('section', { class: 'card narrow' });
  root.append(h('h1', { text: 'Request membership' }),
    h('p', { class: 'lede', text: 'Hacker Sports Facility is private and members-only. Tell us about yourself and the owner will review your request.' }),
    card);

  const f = {
    first_name: h('input', { type: 'text', autocomplete: 'given-name', required: true }),
    last_name: h('input', { type: 'text', autocomplete: 'family-name', required: true }),
    email: h('input', { type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', required: true }),
    phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true }),
    emergency_contact_name: h('input', { type: 'text', autocomplete: 'off', required: true }),
    emergency_contact_phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', required: true }),
  };
  const slot = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Send request' });
  const form = h('form', { novalidate: true },
    h('div', { class: 'grid2' }, field('First name', f.first_name), field('Last name', f.last_name)),
    field('Email', f.email),
    field('Mobile phone', f.phone),
    h('h2', { class: 'small-h', text: 'Emergency contact' }),
    h('div', { class: 'grid2' }, field('Contact name', f.emergency_contact_name), field('Contact phone', f.emergency_contact_phone)),
    slot, btn);
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clear(slot);
    const body = {};
    for (const k of Object.keys(f)) body[k] = f[k].value.trim();
    for (const k of Object.keys(body)) {
      if (!body[k]) { slot.append(banner('Please fill in every field.')); f[k].focus(); return; }
    }
    if (!isEmail(body.email)) { slot.append(banner('That email address does not look right.')); f.email.focus(); return; }
    setBusy(btn, true, 'Sending…');
    try {
      await call('requestMembership', body);
      clear(card);
      card.append(h('div', { class: 'thanks' },
        h('h2', { text: 'Thank you' }),
        h('p', { text: 'Your request is in. The owner will review it and email you at ' + body.email + ' when it is approved.' }),
        h('a', { class: 'btn', href: '#/signin', text: 'Back to sign in' })));
    } catch (err) {
      slot.append(banner(err));
      setBusy(btn, false);
    }
  });
  card.append(form, h('p', { class: 'center' }, h('a', { href: '#/signin', text: 'Already a member? Sign in' })));
}
