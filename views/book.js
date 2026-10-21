import { call } from '../api.js';
import { h, add, icon, clear, todayYmd, addDays, dowName, monthName, dayNum, fmtDay, timeRange, fmtRange, money, isEmail, fullName, termsLink } from '../util.js';
import { banner, skeleton, field, setBusy, openSheet } from '../ui.js';

const KEYS = ['COURT1', 'COURT2', 'BOTH'];
let selectedDate = '';

export async function renderBook(root, ctx) {
  const state = ctx.state;
  root.append(h('h1', { text: 'Book a court' }));
  const usageSlot = h('p', { class: 'usage' });
  const errSlot = h('div');
  const pickerSlot = h('div', { class: 'daypicker-wrap' });
  const gridSlot = h('div');
  root.append(usageSlot, errSlot, pickerSlot, gridSlot);
  gridSlot.append(skeleton(5));

  function renderUsage() {
    const me = state.me;
    if (me.member.is_owner) usageSlot.textContent = 'Owner bookings have no weekly limit and are approved right away.';
    else usageSlot.textContent = me.week.used + ' of ' + me.week.limit + ' bookings used this week';
  }
  renderUsage();

  const resources = await getResources(state);
  let days;
  async function loadAvail() {
    const data = await call('availability', {});
    days = data.days || [];
    if (!days.some(function (d) { return d.date === selectedDate; })) selectedDate = days.length ? days[0].date : '';
  }
  await loadAvail();
  if (ctx.stale()) return;

  function resName(key) {
    const r = resources.filter(function (x) { return x.resource_id === key; })[0];
    return r ? r.name : key === 'BOTH' ? 'Both Courts' : key === 'COURT1' ? 'Court 1' : 'Court 2';
  }

  function dayLabel(date) {
    const t = todayYmd();
    if (date === t) return 'Today';
    if (date === addDays(t, 1)) return 'Tomorrow';
    return dowName(date);
  }

  function renderPicker() {
    clear(pickerSlot);
    const list = h('div', { class: 'daypicker', role: 'group', 'aria-label': 'Choose a day' });
    days.forEach(function (d) {
      const on = d.date === selectedDate;
      list.append(h('button', {
        type: 'button', class: 'daybtn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: function () { selectedDate = d.date; renderPicker(); renderGrid(); },
      }, h('span', { class: 'dn', text: dayLabel(d.date) }), h('span', { class: 'dd', text: monthName(d.date) + ' ' + dayNum(d.date) })));
    });
    pickerSlot.append(list);
    const sel = list.querySelector('.on');
    if (sel && sel.scrollIntoView) { try { list.scrollLeft = sel.offsetLeft - 16; } catch (e) { /* ignore */ } }
  }

  function renderGrid() {
    clear(gridSlot);
    const day = days.filter(function (d) { return d.date === selectedDate; })[0];
    if (!day) { gridSlot.append(h('p', { class: 'empty', text: 'No times to show for this day.' })); return; }
    gridSlot.append(h('h2', { class: 'day-title', text: fmtDay(day.date) }));
    const grid = h('div', { class: 'slotgrid', role: 'table', 'aria-label': 'Availability for ' + fmtDay(day.date) });
    const head = h('div', { class: 'srow shead', role: 'row' }, h('span', { class: 'tcol', role: 'columnheader', text: 'Time' }));
    KEYS.forEach(function (k) { head.append(h('span', { class: 'ccol', role: 'columnheader', text: resName(k) })); });
    grid.append(head);
    day.blocks.forEach(function (b) {
      const row = h('div', { class: 'srow', role: 'row' }, h('span', { class: 'tcol mono', role: 'rowheader', text: timeRange(b.start, b.end, false) }));
      KEYS.forEach(function (k) { row.append(slotCell(b, k)); });
      grid.append(row);
    });
    gridSlot.append(grid, legend());
  }

  function slotCell(b, key) {
    const st = (b.slots && b.slots[key]) || 'busy';
    const label = resName(key) + ', ' + timeRange(b.start, b.end, true);
    if (st === 'free') {
      return h('button', {
        type: 'button', class: 'cell open', role: 'cell', 'aria-label': label + ', open. Tap to book.',
        onclick: function () { openBooking(b, key); },
      }, icon('plus', 14), h('span', { text: 'Open' }));
    }
    if (st === 'mine') {
      return h('a', { class: 'cell mine', role: 'cell', href: '#/bookings', 'aria-label': label + ', yours. View my bookings.' },
        h('i', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: 'Yours' }));
    }
    if (st === 'past') return h('span', { class: 'cell past', role: 'cell', 'aria-label': label + ', past' }, h('span', { text: 'Past' }));
    return h('span', { class: 'cell busy', role: 'cell', 'aria-label': label + ', booked' }, h('span', { text: 'Booked' }));
  }

  function legend() {
    return h('ul', { class: 'legend', 'aria-label': 'Key' },
      h('li', null, h('span', { class: 'swatch open' }), 'Open'),
      h('li', null, h('span', { class: 'swatch busy' }), 'Booked'),
      h('li', null, h('span', { class: 'swatch mine' }), 'Yours'),
      h('li', null, h('span', { class: 'swatch past' }), 'Past'));
  }

  function openBooking(block, key) {
    bookingSheet(ctx, resources, resName, block, key, async function () {
      try { await ctx.loadMe(); renderUsage(); } catch (e) { /* ignore */ }
      try { await loadAvail(); renderPicker(); renderGrid(); } catch (e) { /* ignore */ }
    });
  }

  clear(gridSlot);
  renderPicker();
  renderGrid();
}

async function getResources(state) {
  if (!state.resources) state.resources = await call('resources', {});
  return state.resources;
}

function bookingSheet(ctx, resources, resName, block, key, onChanged) {
  const state = ctx.state, me = state.me, settings = me.settings;
  const res = resources.filter(function (r) { return r.resource_id === key; })[0] || { courts: key === 'BOTH' ? 2 : 1, rate_per_hour: 0, block_hours: settings.block_hours };
  const isOwner = me.member.is_owner;
  const maxPlayers = settings.max_players_per_court * (res.courts || 1);
  const total = isOwner ? 0 : res.rate_per_hour * res.block_hours;
  const slotDate = block.start.slice(0, 10);
  const inThisWeek = slotDate >= me.week.week_start && slotDate <= me.week.week_end;
  const limitHit = !isOwner && inThisWeek && me.week.used >= me.week.limit;
  const termsNeeded = !isOwner && !!me.terms && !me.terms.accepted;

  const sheet = openSheet('Request a booking', onChanged);
  const body = sheet.body;
  const guests = []; // { member_id?, first_name, last_name, email?, phone?, isNew }
  let payMode = 'Split';
  let known = [];
  let addingNew = false;

  const summary = h('div', { class: 'summary' },
    h('strong', { text: resName(key) }),
    h('span', { class: 'mono', text: fmtRange(block.start, block.end) }));

  const playersSlot = h('div');
  const knownSlot = h('div');
  const newSlot = h('div');
  const priceSlot = h('div', { class: 'price', 'aria-live': 'polite' });
  const errSlot = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button', text: 'Request booking' });

  const radios = [['Split', 'Everyone pays their share'], ['BookerPays', "I'll cover everyone"]].map(function (o, i) {
    const input = h('input', { type: 'radio', name: 'paymode', value: o[0], id: 'pm' + i, checked: o[0] === 'Split' });
    input.addEventListener('change', function () { payMode = o[0]; renderPrice(); });
    return h('label', { class: 'seg', for: 'pm' + i }, input, h('span', { text: o[1] }));
  });

  function renderPlayers() {
    clear(playersSlot);
    const ul = h('ul', { class: 'players' });
    ul.append(h('li', null, h('span', { text: fullName(me.member) }), h('span', { class: 'tag', text: 'You' })));
    guests.forEach(function (g, i) {
      ul.append(h('li', null,
        h('span', { text: fullName(g) }),
        g.isNew ? h('span', { class: 'tag warn', text: 'Needs approval' }) : null,
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Remove ' + fullName(g), onclick: function () { guests.splice(i, 1); refresh(); } }, icon('x', 16))));
    });
    playersSlot.append(h('p', { class: 'count', text: (guests.length + 1) + ' of ' + maxPlayers + ' players' }), ul);
  }

  function renderKnown() {
    clear(knownSlot);
    const atMax = guests.length + 1 >= maxPlayers;
    const avail = known.filter(function (k) { return !guests.some(function (g) { return g.member_id === k.member_id; }) && k.member_id !== me.member.member_id; });
    if (avail.length) {
      const chips = h('div', { class: 'chips' });
      avail.forEach(function (k) {
        chips.append(h('button', {
          class: 'chip', type: 'button', disabled: atMax, 'aria-label': 'Add ' + fullName(k),
          onclick: function () { guests.push({ member_id: k.member_id, first_name: k.first_name, last_name: k.last_name, isNew: false }); refresh(); },
        }, icon('plus', 14), fullName(k)));
      });
      knownSlot.append(h('h3', { class: 'small-h', text: 'Known players' }), chips);
    }
    if (!addingNew) {
      knownSlot.append(h('button', {
        class: 'btn ghost', type: 'button', disabled: atMax, text: 'Add new guest',
        onclick: function () { addingNew = true; renderNew(); renderKnown(); const f = newSlot.querySelector('input'); if (f) f.focus(); },
      }));
    }
    if (atMax) knownSlot.append(h('p', { class: 'hint', text: 'This booking is full.' }));
  }

  function renderNew() {
    clear(newSlot);
    if (!addingNew) return;
    const f = {
      first_name: h('input', { type: 'text', autocomplete: 'off' }),
      last_name: h('input', { type: 'text', autocomplete: 'off' }),
      email: h('input', { type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none' }),
      phone: h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off' }),
    };
    const slot = h('div');
    const form = h('div', { class: 'guest-form' },
      h('h3', { class: 'small-h', text: 'New guest' }),
      h('div', { class: 'grid2' }, field('First name', f.first_name), field('Last name', f.last_name)),
      field('Email', f.email), field('Mobile phone', f.phone),
      h('p', { class: 'hint', text: 'New guests need owner approval before they can play.' }),
      slot,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', type: 'button', text: 'Add guest', onclick: function () {
            clear(slot);
            const g = { isNew: true };
            for (const k of Object.keys(f)) g[k] = f[k].value.trim();
            if (!g.first_name || !g.last_name || !g.email || !g.phone) { slot.append(banner('Fill in all four fields for the guest.')); return; }
            if (!isEmail(g.email)) { slot.append(banner('That guest email does not look right.')); return; }
            const dupe = g.email.toLowerCase() === me.member.email.toLowerCase() || guests.some(function (x) { return x.email && x.email.toLowerCase() === g.email.toLowerCase(); });
            if (dupe) { slot.append(banner('That person is already on this booking.')); return; }
            guests.push(g);
            addingNew = false;
            refresh();
          },
        }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: function () { addingNew = false; refresh(); } })));
    newSlot.append(form);
  }

  function renderPrice() {
    clear(priceSlot);
    const n = guests.length + 1;
    if (isOwner) { priceSlot.append(h('p', { text: 'Owner bookings are $0.00.' })); return; }
    if (payMode === 'BookerPays') {
      priceSlot.append(h('p', null, 'You pay ', h('strong', { class: 'mono', text: money(total) }), ' for the whole booking.'));
    } else {
      const each = Math.ceil(total * 100 / n) / 100;
      const even = Math.round(total * 100) % n === 0;
      priceSlot.append(h('p', null, 'Total ', h('span', { class: 'mono', text: money(total) }), ' · ',
        h('strong', { class: 'mono', text: (even ? '' : 'About ') + money(each) + ' each' }), ' for ' + n + (n === 1 ? ' player' : ' players')));
    }
  }

  function refresh() { renderPlayers(); renderKnown(); renderNew(); renderPrice(); }

  const usageMsg = isOwner ? null : (me.week.used + ' of ' + me.week.limit + ' bookings used this week');
  add(body,
    summary,
    usageMsg ? h('p', { class: 'usage', text: usageMsg }) : null,
    limitHit ? banner("You've used all of this week's bookings. Pick a day next week.") : null,
    h('h3', { class: 'small-h', text: 'Players' }), playersSlot, knownSlot, newSlot,
    h('fieldset', { class: 'paymode' }, h('legend', { text: 'Payment' }), h('div', { class: 'segs' }, radios)),
    priceSlot,
    h('p', { class: 'hint', text: "Payment isn't collected yet — you'll be notified when payments start." }),
    errSlot,
    termsNeeded ? termsGate() : submit);
  refresh();

  function termsGate() {
    return h('div', { class: 'terms-gate' },
      banner('Before your first booking, please read the Booking and Payment Terms all the way through and accept them.'),
      h('a', { class: 'btn primary block', href: termsLink('book'), text: 'Read and accept the terms' }));
  }

  call('knownPlayers', {}).then(function (list) { known = list || []; renderKnown(); }).catch(function () { /* quick-add is optional */ });

  if (limitHit) submit.disabled = true;
  submit.addEventListener('click', async function () {
    clear(errSlot);
    setBusy(submit, true, 'Sending…');
    const payload = guests.map(function (g) {
      return g.member_id ? { member_id: g.member_id } : { first_name: g.first_name, last_name: g.last_name, email: g.email, phone: g.phone };
    });
    try {
      const out = await call('createBooking', { resource_id: key, start: block.start, pay_mode: payMode, guests: payload });
      showDone(out.booking);
    } catch (err) {
      errSlot.append(banner(err));
      if (err.code === 'TERMS_REQUIRED') errSlot.append(h('a', { class: 'btn primary block', href: termsLink('book'), text: 'Read and accept the terms' }));
      setBusy(submit, false);
      if (err.code === 'SLOT_TAKEN' || err.code === 'LIMIT_REACHED') onChanged();
    }
  });

  function showDone(b) {
    clear(body);
    sheet.setTitle(b.status === 'Approved' ? 'Booked' : 'Request sent');
    body.append(h('div', { class: 'done' },
      h('div', { class: 'done-mark' }, icon('check', 28)),
      h('p', { class: 'done-msg', text: b.status === 'Approved' ? 'Booked' : "Request sent — you'll get an email when it's approved" }),
      h('p', { class: 'mono', text: b.resource_name + ' · ' + fmtRange(b.start, b.end) }),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: '#/bookings', onclick: function () { sheet.close(); }, text: 'View my bookings' }),
        h('button', { class: 'btn', type: 'button', onclick: function () { sheet.close(); }, text: 'Done' }))));
  }
}
