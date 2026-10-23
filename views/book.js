import { call, clearCache } from '../api.js';
import { h, add, icon, clear, parseLocal, todayYmd, addDays, dowName, monthName, dayNum, mondayOf, fmtDay, timeRange, fmtRange, money, isEmail, fullName, termsLink, hashParams, clearHashParams } from '../util.js';
import { banner, skeleton, field, setBusy, openSheet, startCardFlow } from '../ui.js';
import { waiverOf } from './waiver.js';

const GOLF = 'GOLF';
const FALLBACK_COLUMNS = [
  { resource_id: 'COURT1', name: 'Court 1', courts: 1 },
  { resource_id: 'COURT2', name: 'Court 2', courts: 1 },
  { resource_id: 'BOTH', name: 'Both Courts', courts: 2 },
];
// Remembered while the app is open, so the week and the Courts / Golf Sim choice survive tab switches.
let selectedDate = '';
let weekFrom = '';
let viewTab = 'courts';

// Owner and Family can book several sessions and look any distance ahead.
function isPriv(me) {
  const m = (me && me.member) || {};
  return !!(me && me.unlimited_ahead === true) || m.is_owner === true || m.role === 'Owner' || m.role === 'Family';
}

// How many time slots one request may hold: null = unlimited (Owner and Family), else a whole number >= 1.
function maxSlotsOf(me) {
  if (me && me.max_slots !== undefined) return me.max_slots === null ? null : Math.max(1, Number(me.max_slots) || 1);
  return isPriv(me) ? null : 1;
}

// Merge sessions exactly like the engine: sort by resource then start; same resource and end === next start joins.
export function mergeSessions(list) {
  const s = list.map(function (x) { return { resource_id: x.resource_id, start: x.start, end: x.end }; });
  s.sort(function (a, b) {
    if (a.resource_id !== b.resource_id) return a.resource_id < b.resource_id ? -1 : 1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });
  const out = [];
  s.forEach(function (x) {
    const last = out[out.length - 1];
    if (last && last.resource_id === x.resource_id && last.end === x.start) last.end = x.end;
    else out.push(x);
  });
  return out;
}

function hoursBetween(start, end) {
  const a = parseLocal(start), b = parseLocal(end);
  return ((b.h * 60 + b.mi) - (a.h * 60 + a.mi)) / 60;
}

function shortDay(ymd) { return dowName(ymd) + ' ' + monthName(ymd) + ' ' + dayNum(ymd); }

export async function renderBook(root, ctx) {
  const state = ctx.state;
  let me = state.me;
  let priv = isPriv(me);
  const today = todayYmd();
  if (priv && (!weekFrom || weekFrom < today)) weekFrom = today;

  root.append(h('h1', { text: 'Book a court' }));
  const cardNoteSlot = h('div');
  const waiverSlot = h('div');
  const usageSlot = h('p', { class: 'usage' });
  const noteSlot = h('p', { class: 'usage updating', role: 'status' });
  const errSlot = h('div');
  const controlsSlot = h('div');
  const navSlot = h('div');
  const pickerSlot = h('div', { class: 'daypicker-wrap' });
  const DEFAULT_HINT = 'Tap open times to select them.';
  const hintSlot = h('p', { class: 'hint sel-hint', role: 'status', text: DEFAULT_HINT });
  const gridSlot = h('div');
  const selbar = h('div', { class: 'selbar', role: 'region', 'aria-label': 'Selected times', hidden: true });
  root.append(cardNoteSlot, waiverSlot, usageSlot, noteSlot, errSlot, controlsSlot, navSlot, pickerSlot, hintSlot, gridSlot, selbar);
  gridSlot.append(skeleton(5));

  let resources = state.resources || [];
  let days = [];
  const picks = new Map(); // 'RES|start' -> { resource_id, start, end }; one entry is one time slot
  let barHint = ''; // limit message shown in the selection bar
  let navId = 0;

  function setHint(msg) { hintSlot.textContent = msg || DEFAULT_HINT; }
  function limit() { return maxSlotsOf(me); }

  function renderUsage() {
    if (priv) usageSlot.textContent = 'No weekly limit.';
    else usageSlot.textContent = me.week.used + ' of ' + me.week.limit + ' bookings used this week';
  }
  function renderNote() {
    if (state.fromCache) noteSlot.textContent = state.refreshFailed ? "Couldn't update. Showing saved times." : 'Updating…';
    else noteSlot.textContent = '';
  }
  // Nothing is blocked by the waiver (Phase 2A); this only nudges.
  function renderWaiverNote() {
    clear(waiverSlot);
    if (waiverOf(me).status === 'signed') return;
    const b = banner('Please sign the Participant Agreement before your first visit.', 'info');
    b.append(h('a', { href: '#/waiver', text: 'Sign now' }));
    waiverSlot.append(b);
  }
  renderUsage();
  renderNote();
  renderWaiverNote();

  // Coming back from Stripe card setup: #/book?card=done&cs=... or ?card=cancel
  const rp = hashParams();
  if (rp.card) {
    clearHashParams();
    if (rp.card === 'done' && rp.cs) {
      try {
        await call('confirmCardSetup', { cs: rp.cs });
        clearCache();
        me = await ctx.loadMe();
        cardNoteSlot.append(banner('Card saved. You can request bookings now.', 'info'));
      } catch (e) {
        cardNoteSlot.append(banner(e));
      }
      if (ctx.stale()) return;
    } else if (rp.card === 'cancel') {
      cardNoteSlot.append(banner('No card was saved.', 'info'));
    }
  }

  // ---- data ----
  function usable(a) {
    if (!a || !a.days || !a.days.length) return false;
    const young = (state.fromCache && !state.refreshFailed) || (Date.now() - state.availAt < 20000);
    if (!young) return false;
    return a.days[0].date === (priv ? weekFrom : today);
  }
  function setDays(data) {
    const list = data.days || [];
    days = priv ? list.slice(0, 7) : list;
    if (!days.some(function (d) { return d.date === selectedDate; })) selectedDate = days.length ? days[0].date : '';
  }
  async function loadAvail() {
    const data = await call('availability', priv ? { from: weekFrom, days: 7 } : {});
    state.avail = data;
    state.availAt = Date.now();
    setDays(data);
  }
  function prunePicks() {
    Array.from(picks.keys()).forEach(function (pk) {
      const p = picks.get(pk);
      const day = days.filter(function (d) { return d.date === p.start.slice(0, 10); })[0];
      if (!day) return; // another week: keep it
      const b = day.blocks.filter(function (x) { return x.start === p.start; })[0];
      if (!b || !b.slots || b.slots[p.resource_id] !== 'free') picks.delete(pk);
    });
  }

  if (usable(state.avail)) setDays(state.avail);
  else {
    await loadAvail();
    if (ctx.stale()) return;
  }
  if (!resources.length) {
    resources = state.resources = await call('resources', {});
    if (ctx.stale()) return;
  }

  // ---- helpers ----
  function resObj(key) { return resources.filter(function (x) { return x.resource_id === key; })[0]; }
  function resName(key) {
    const r = resObj(key) || FALLBACK_COLUMNS.filter(function (x) { return x.resource_id === key; })[0];
    return r ? r.name : key;
  }
  function hasGolf() { return resources.some(function (r) { return r.resource_id === GOLF; }); }
  function columns() {
    const list = resources.length ? resources : FALLBACK_COLUMNS;
    if (priv && hasGolf()) {
      return list.filter(function (r) { return viewTab === 'golf' ? r.resource_id === GOLF : r.resource_id !== GOLF; });
    }
    return list;
  }
  function dayLabel(date) {
    if (date === today) return 'Today';
    if (date === addDays(today, 1)) return 'Tomorrow';
    return dowName(date);
  }
  function pkOf(key, start) { return key + '|' + start; }

  // ---- controls: Courts | Golf Sim ----
  function renderControls() {
    clear(controlsSlot);
    if (!priv || !hasGolf()) return;
    const row = h('div', { class: 'ctl-row' });
    const seg = h('div', { class: 'segs', role: 'group', 'aria-label': 'Courts or Golf Simulator' });
    [['courts', 'Courts'], ['golf', 'Golf Sim']].forEach(function (o) {
      const on = viewTab === o[0];
      seg.append(h('button', {
        type: 'button', class: 'seg-btn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', text: o[1],
        onclick: function () { if (viewTab !== o[0]) { viewTab = o[0]; setHint(''); barHint = ''; renderControls(); renderGrid(); renderSelbar(); } },
      }));
    });
    row.append(seg);
    controlsSlot.append(row);
  }

  // ---- week navigation (unlimited-ahead members) ----
  const nav = { prev: null, next: null, input: null, range: null };
  function buildNav() {
    if (!priv) return;
    nav.prev = h('button', { type: 'button', class: 'btn', onclick: function () { goWeek(addDays(weekFrom, -7) < today ? today : addDays(weekFrom, -7)); } }, '‹ Previous week');
    nav.next = h('button', { type: 'button', class: 'btn', onclick: function () { goWeek(addDays(weekFrom, 7)); } }, 'Next week ›');
    nav.input = h('input', {
      type: 'date', min: today, value: weekFrom,
      onchange: function () {
        const v = nav.input.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        goWeek(v < today ? today : v);
      },
    });
    nav.range = h('p', { class: 'weekrange', 'aria-live': 'polite' });
    navSlot.append(
      h('div', { class: 'weeknav' }, nav.prev, nav.next),
      nav.range,
      h('div', { class: 'jump' }, field('Jump to date', nav.input)));
    syncNav();
  }
  function syncNav() {
    if (!priv || !nav.prev) return;
    nav.prev.disabled = weekFrom <= today;
    nav.input.value = weekFrom;
    nav.range.textContent = 'Week of ' + shortDay(weekFrom) + ' to ' + shortDay(addDays(weekFrom, 6));
  }
  async function goWeek(from) {
    if (from === weekFrom) return;
    const prev = weekFrom;
    const id = ++navId;
    weekFrom = from;
    syncNav();
    clear(errSlot);
    clear(gridSlot);
    gridSlot.append(skeleton(5));
    try {
      await loadAvail();
    } catch (e) {
      if (id !== navId || ctx.stale()) return;
      weekFrom = prev;
      syncNav();
      errSlot.append(banner(e));
    }
    if (id !== navId || ctx.stale()) return;
    renderPicker(); renderGrid(); renderSelbar();
  }

  // ---- day picker ----
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

  // ---- grid ----
  function renderGrid(focusPk) {
    clear(gridSlot);
    const day = days.filter(function (d) { return d.date === selectedDate; })[0];
    if (!day) { gridSlot.append(h('p', { class: 'empty', text: 'No times to show for this day.' })); return; }
    const cols = columns();
    gridSlot.append(h('h2', { class: 'day-title', text: fmtDay(day.date) }));
    const grid = h('div', { class: 'slotgrid', role: 'table', 'aria-label': 'Availability for ' + fmtDay(day.date), style: '--cols:' + cols.length });
    const head = h('div', { class: 'srow shead', role: 'row' }, h('span', { class: 'tcol', role: 'columnheader', text: 'Time' }));
    cols.forEach(function (r) {
      head.append(h('div', { class: 'ccol', role: 'columnheader' }, h('span', { text: r.name }), limit() === null ? wholeButton(day, r) : null));
    });
    grid.append(head);
    day.blocks.forEach(function (b) {
      const row = h('div', { class: 'srow', role: 'row' }, h('span', { class: 'tcol mono', role: 'rowheader', text: timeRange(b.start, b.end, false) }));
      cols.forEach(function (r) { row.append(slotCell(b, r.resource_id)); });
      grid.append(row);
    });
    gridSlot.append(grid, legend());
    if (focusPk) {
      const el = gridSlot.querySelector('[data-pk="' + focusPk + '"]');
      if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  function slotCell(b, key) {
    const st = (b.slots && b.slots[key]) || 'busy';
    const label = resName(key) + ', ' + timeRange(b.start, b.end, true);
    if (st === 'free') {
      const pk = pkOf(key, b.start);
      const on = picks.has(pk);
      return h('div', { class: 'cw', role: 'cell' }, h('button', {
        type: 'button', class: 'cell open' + (on ? ' selected' : ''), 'data-pk': pk, 'aria-pressed': on ? 'true' : 'false',
        'aria-label': label + (on ? ', selected. Tap to deselect.' : ', open. Tap to select.'),
        onclick: function () { togglePick(b, key); },
      }, icon(on ? 'check' : 'plus', 14), h('span', { text: on ? 'Selected' : 'Open' })));
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

  // ---- tap to select ----

  // Resources that can't be booked at the same time as each other. Both Courts covers
  // Court 1 and Court 2. Uses the engine's conflicts_with when it sends one, else this map.
  const BUILTIN_CLASH = { BOTH: ['COURT1', 'COURT2'], COURT1: ['BOTH'], COURT2: ['BOTH'] };
  function clashList(key) {
    const r = resObj(key);
    if (r && Array.isArray(r.conflicts_with)) return r.conflicts_with;
    return BUILTIN_CLASH[key] || [];
  }
  function clashes(a, b) {
    return a !== b && (clashList(a).indexOf(b) !== -1 || clashList(b).indexOf(a) !== -1);
  }

  // Unchecks picks that clash with key at an overlapping time. Returns the names it unchecked.
  function dropClashes(key, start, end) {
    const names = [];
    Array.from(picks.keys()).forEach(function (pk) {
      const p = picks.get(pk);
      if (clashes(p.resource_id, key) && p.start < end && p.end > start) {
        picks.delete(pk);
        const n = resName(p.resource_id);
        if (names.indexOf(n) === -1) names.push(n);
      }
    });
    return names;
  }
  function replacedHint(names, key, when) {
    return names.length ? 'Replaced ' + names.join(' and ') + ' ' + when + ' with ' + resName(key) + '.' : '';
  }

  function togglePick(b, key) {
    const pk = pkOf(key, b.start);
    const max = limit();
    let note = '';
    barHint = '';
    if (picks.has(pk)) picks.delete(pk);
    else if (max === 1) { picks.clear(); picks.set(pk, { resource_id: key, start: b.start, end: b.end }); } // one slot: move the selection
    else {
      const removed = dropClashes(key, b.start, b.end); // e.g. Both Courts replaces Court 1 / Court 2 at this time
      if (max !== null && picks.size >= max) barHint = 'You can select up to ' + max + ' time slots at a time.';
      else picks.set(pk, { resource_id: key, start: b.start, end: b.end });
      note = replacedHint(removed, key, 'at ' + timeRange(b.start, b.end, false));
    }
    setHint(note);
    renderGrid(pk); renderSelbar();
  }

  // Blocks a "Whole day" press would select for one column: every open block, or for a capped
  // resource (Golf Simulator) the earliest open contiguous run, up to max_hours.
  function wholeDayBlocks(day, r) {
    const key = r.resource_id;
    const cap = Number(r.max_hours) || 0;
    const open = function (b) { return b.slots && b.slots[key] === 'free'; };
    if (!cap) return day.blocks.filter(open);
    const run = [];
    let total = 0;
    for (let i = 0; i < day.blocks.length; i++) {
      const b = day.blocks[i];
      if (!open(b)) { if (run.length) break; continue; }
      const hrs = hoursBetween(b.start, b.end);
      if (total + hrs > cap) break;
      run.push(b);
      total += hrs;
    }
    return run;
  }

  function wholeButton(day, r) {
    const blocks = wholeDayBlocks(day, r);
    const all = blocks.length > 0 && blocks.every(function (b) { return picks.has(pkOf(r.resource_id, b.start)); });
    const pk = 'whole|' + r.resource_id;
    return h('button', {
      type: 'button', class: 'whole', 'data-pk': pk, 'aria-pressed': all ? 'true' : 'false',
      'aria-label': 'Whole day, ' + r.name + ', ' + fmtDay(day.date),
      onclick: function () { toggleWhole(day, r); },
    }, all ? icon('check', 14) : null, 'Whole day');
  }

  function toggleWhole(day, r) {
    const key = r.resource_id;
    const blocks = wholeDayBlocks(day, r);
    const cap = Number(r.max_hours) || 0;
    const all = blocks.length > 0 && blocks.every(function (b) { return picks.has(pkOf(key, b.start)); });
    if (all) {
      blocks.forEach(function (b) { picks.delete(pkOf(key, b.start)); });
      setHint('');
    } else if (!blocks.length) {
      setHint('Nothing is open in ' + r.name + ' on this day.');
    } else {
      if (cap) {
        // Replace this column's picks for the day so the capped run stands alone.
        Array.from(picks.keys()).forEach(function (pk) {
          const p = picks.get(pk);
          if (p.resource_id === key && p.start.slice(0, 10) === day.date) picks.delete(pk);
        });
      }
      const removed = [];
      blocks.forEach(function (b) {
        dropClashes(key, b.start, b.end).forEach(function (n) { if (removed.indexOf(n) === -1) removed.push(n); });
        picks.set(pkOf(key, b.start), { resource_id: key, start: b.start, end: b.end });
      });
      const note = replacedHint(removed, key, 'on this day');
      setHint(cap ? r.name + ' bookings can be up to ' + cap + ' hours.' + (note ? ' ' + note : '') : note);
    }
    renderGrid('whole|' + key); renderSelbar();
  }

  function renderSelbar() {
    clear(selbar);
    const n = picks.size;
    const show = n > 0;
    selbar.hidden = !show;
    gridSlot.classList.toggle('has-selbar', show);
    if (!show) return;
    if (barHint) selbar.append(h('p', { class: 'hint selbar-hint', role: 'status', text: barHint }));
    selbar.append(
      h('div', { class: 'selbar-in' },
        h('span', { class: 'selcount', 'aria-live': 'polite', text: n + ' selected' }),
        h('button', { type: 'button', class: 'btn', text: 'Clear', onclick: function () { picks.clear(); barHint = ''; setHint(''); renderGrid(); renderSelbar(); } }),
        h('button', { type: 'button', class: 'btn primary', text: 'Book', onclick: function () { openSelected(); } })));
  }

  // ---- opening the booking sheet ----
  async function refreshAfterBooking() {
    try { me = await ctx.loadMe(); renderUsage(); renderWaiverNote(); } catch (e) { /* ignore */ }
    if (ctx.stale()) return;
    try { await loadAvail(); prunePicks(); renderPicker(); renderGrid(); renderSelbar(); } catch (e) { /* ignore */ }
  }
  function openSelected() {
    if (!picks.size) return;
    bookingSheet(ctx, resources, resName, Array.from(picks.values()), {
      onChanged: refreshAfterBooking,
      onBooked: function () { picks.clear(); barHint = ''; setHint(''); renderGrid(); renderSelbar(); },
    });
  }

  // ---- live data landed (after cached start) ----
  state.onFresh = function () {
    if (ctx.stale()) return;
    if (isPriv(state.me) !== priv) { ctx.go('#/book'); return; }
    me = state.me;
    resources = state.resources || resources;
    renderUsage();
    renderWaiverNote();
    const a = state.avail;
    if (a && a.days && a.days.length && !state.refreshFailed) {
      const nd = priv ? a.days.slice(0, 7) : a.days;
      if (!days.length || nd[0].date === days[0].date) {
        days = nd;
        if (!days.some(function (d) { return d.date === selectedDate; })) selectedDate = days[0].date;
        prunePicks();
      }
    }
    renderNote();
    renderControls(); renderPicker(); renderGrid(); renderSelbar();
  };

  clear(gridSlot);
  buildNav();
  renderControls();
  renderPicker();
  renderGrid();
  renderSelbar();
}

function bookingSheet(ctx, resources, resName, sessions, hooks) {
  const state = ctx.state, me = state.me, settings = me.settings;
  const priv = isPriv(me);
  const isOwner = me.member.is_owner === true || me.member.role === 'Owner';
  const merged = mergeSessions(sessions);
  const multi = merged.length > 1;
  const resList = merged.map(function (s) {
    return resources.filter(function (r) { return r.resource_id === s.resource_id; })[0] ||
      { resource_id: s.resource_id, courts: s.resource_id === 'BOTH' ? 2 : 1, rate_per_hour: 0, block_hours: settings.block_hours };
  });
  const maxPlayers = settings.max_players_per_court * Math.min.apply(null, resList.map(function (r) { return r.courts || 1; }));
  // Each merged booking costs rate x hours; one slot is one block of the resource's block_hours.
  const prices = merged.map(function (s, i) { return priv ? 0 : (Number(resList[i].rate_per_hour) || 0) * hoursBetween(s.start, s.end); });
  const total = prices.reduce(function (a, b) { return a + b; }, 0);
  // Weekly limit counted by slot, per calendar week. Only this week's usage is known here; the engine checks the rest.
  const weekSlots = {};
  merged.forEach(function (s, i) {
    const bh = Number(resList[i].block_hours) || Number(settings.block_hours) || 2;
    const wk = mondayOf(s.start.slice(0, 10));
    weekSlots[wk] = (weekSlots[wk] || 0) + Math.max(1, Math.round(hoursBetween(s.start, s.end) / bh));
  });
  const limitHit = !priv && Object.keys(weekSlots).some(function (wk) {
    const used = wk === me.week.week_start ? me.week.used : 0;
    return used + weekSlots[wk] > me.week.limit;
  });
  const termsNeeded = !priv && !!me.terms && !me.terms.accepted;
  let cardNeeded = !priv && total > 0 && !me.card;
  const capErrors = [];
  merged.forEach(function (s, i) {
    const cap = Number(resList[i].max_hours) || 0;
    if (cap && hoursBetween(s.start, s.end) > cap) {
      const msg = resList[i].name + ' bookings can be up to ' + cap + ' hours.';
      if (capErrors.indexOf(msg) === -1) capErrors.push(msg);
    }
  });

  const sheet = openSheet(isOwner ? 'Book' : (multi ? 'Request bookings' : 'Request a booking'), hooks.onChanged);
  const body = sheet.body;
  const guests = []; // { member_id, first_name, last_name } for a known player, or { email } for an email invite
  let payMode = 'Split';
  let known = [];

  const summary = h('div', { class: 'summary' }, h('ul', { class: 'sessions' }, merged.map(function (s) {
    return h('li', null, h('strong', { text: resName(s.resource_id) }),
      h('span', { class: 'mono', text: ' · ' + shortDay(s.start) + ' · ' + timeRange(s.start, s.end, true) }));
  })));

  const playersSlot = h('div');
  const knownSlot = h('div');
  const priceSlot = h('div', { class: 'price', 'aria-live': 'polite' });
  const errSlot = h('div');
  const actionSlot = h('div');
  const submit = h('button', { class: 'btn primary block', type: 'button', text: isOwner ? 'Book' : (multi ? 'Request bookings' : 'Request booking') });

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
        h('span', { text: g.email || fullName(g) }),
        h('span', { class: 'tag warn', text: 'Invited' }),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Remove ' + (g.email || fullName(g)), onclick: function () { guests.splice(i, 1); refresh(); } }, icon('x', 16))));
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
          onclick: function () { guests.push({ member_id: k.member_id, first_name: k.first_name, last_name: k.last_name }); refresh(); },
        }, icon('plus', 14), fullName(k)));
      });
      knownSlot.append(h('h3', { class: 'small-h', text: 'Known players' }), chips);
    }
    const email = h('input', { type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', disabled: atMax, placeholder: 'name@example.com' });
    const slot = h('div', { 'aria-live': 'polite' });
    const addBtn = h('button', { class: 'btn', type: 'button', disabled: atMax, text: 'Add' });
    function addEmail() {
      clear(slot);
      const e = email.value.trim().toLowerCase();
      if (!isEmail(e)) { slot.append(banner('That email address does not look right.')); email.focus(); return; }
      const dupe = e === me.member.email.toLowerCase() || guests.some(function (x) { return x.email && x.email.toLowerCase() === e; });
      if (dupe) { slot.append(banner('That person is already on this booking.')); email.focus(); return; }
      guests.push({ email: e });
      refresh();
      const again = knownSlot.querySelector('input[type=email]');
      if (again && !again.disabled) again.focus();
    }
    addBtn.addEventListener('click', addEmail);
    email.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addEmail(); } });
    knownSlot.append(h('h3', { class: 'small-h', text: 'Invite by email' }),
      h('div', { class: 'invite-row' }, field('Email', email), addBtn), slot,
      h('p', { class: 'hint', text: "Each player gets an email to accept. If they don't accept, their share is charged to you at the start time." }));
    if (atMax) knownSlot.append(h('p', { class: 'hint', text: 'This booking is full.' }));
  }

  function renderPrice() {
    clear(priceSlot);
    const n = guests.length + 1;
    if (priv) { priceSlot.append(h('p', { text: 'Free for owner and family.' })); return; }
    if (payMode === 'BookerPays') {
      priceSlot.append(h('p', null, 'You pay ', h('strong', { class: 'mono', text: money(total) }), multi ? ' for all the bookings.' : ' for the whole booking.'));
    } else {
      // Per person, summed over the merged bookings (each booking is split on its own).
      const each = prices.reduce(function (a, p) { return a + Math.ceil(p * 100 / n) / 100; }, 0);
      const even = prices.every(function (p) { return Math.round(p * 100) % n === 0; });
      priceSlot.append(h('p', null, 'Total ', h('span', { class: 'mono', text: money(total) }), ' · ',
        h('strong', { class: 'mono', text: (even ? '' : 'About ') + money(each) + ' each' }), ' for ' + n + (n === 1 ? ' player' : ' players')));
    }
    const credit = me.credits && Number(me.credits.balance) > 0 ? Number(me.credits.balance) : 0;
    if (credit > 0) priceSlot.append(h('p', { class: 'hint credit-note', text: 'You have ' + money(credit) + ' in credit, which will be used first.' }));
  }

  function refresh() { renderPlayers(); renderKnown(); renderPrice(); }

  const usageMsg = priv ? 'No weekly limit.' : (me.week.used + ' of ' + me.week.limit + ' bookings used this week');
  const limitMsg = !priv && limitHit ? 'This would go over your ' + me.week.limit + ' bookings this week (each 2-hour time counts as one).' : '';
  add(body,
    summary,
    h('p', { class: 'usage', text: usageMsg }),
    limitHit ? banner(limitMsg) : null,
    capErrors.map(function (m) { return banner(m); }),
    h('h3', { class: 'small-h', text: 'Players' }), playersSlot, knownSlot,
    priv ? null : h('fieldset', { class: 'paymode' }, h('legend', { text: 'Payment' }), h('div', { class: 'segs' }, radios)),
    priceSlot,
    priv ? null : h('p', { class: 'hint', text: "Your card is charged about 24 hours before the booking. Players who don't pay are charged to you at the start time." }),
    errSlot,
    actionSlot);
  refresh();
  renderAction();

  function renderAction() {
    clear(actionSlot);
    if (termsNeeded) actionSlot.append(termsGate());
    else if (cardNeeded) actionSlot.append(cardGate());
    else actionSlot.append(submit);
  }

  function cardGate() {
    const slot = h('div');
    const add = h('button', { class: 'btn primary block', type: 'button', text: 'Add payment card' });
    add.addEventListener('click', function () {
      clear(errSlot);
      startCardFlow(add, slot, 'book', async function () {
        const fresh = await ctx.loadMe();
        cardNeeded = !fresh.card;
        renderAction();
      });
    });
    return h('div', { class: 'card-gate' },
      banner('Add a payment card to request bookings.'), slot, add);
  }

  function termsGate() {
    return h('div', { class: 'terms-gate' },
      banner('Before your first booking, please read the Booking and Payment Terms all the way through and accept them.'),
      h('a', { class: 'btn primary block', href: termsLink('book'), text: 'Read and accept the terms' }));
  }

  call('knownPlayers', {}).then(function (list) { known = list || []; renderKnown(); }).catch(function () { /* quick-add is optional */ });

  if (limitHit || capErrors.length) submit.disabled = true;
  submit.addEventListener('click', async function () {
    clear(errSlot);
    setBusy(submit, true, 'Sending…');
    const payload = guests.map(function (g) {
      return g.member_id ? { member_id: g.member_id } : { email: g.email };
    });
    try {
      const req = {
        sessions: merged.map(function (s) { return { resource_id: s.resource_id, start: s.start, end: s.end }; }),
        guests: payload,
      };
      if (!priv) req.pay_mode = payMode;
      const out = await call('createBookings', req);
      showDone(out.bookings || []);
    } catch (err) {
      errSlot.append(banner(err));
      if (err.code === 'CARD_REQUIRED') { cardNeeded = true; renderAction(); }
      if (err.code === 'TERMS_REQUIRED') errSlot.append(h('a', { class: 'btn primary block', href: termsLink('book'), text: 'Read and accept the terms' }));
      setBusy(submit, false);
      // The sheet stays open; the grid behind it refreshes so the selection can be adjusted.
      if (err.code === 'SLOT_TAKEN' || err.code === 'LIMIT_REACHED') hooks.onChanged();
    }
  });

  function showDone(list) {
    if (hooks.onBooked) hooks.onBooked();
    const approved = list.length > 0 && list.every(function (b) { return b.status === 'Approved'; });
    const plural = list.length > 1;
    clear(body);
    sheet.setTitle(approved ? 'Booked' : (plural ? 'Requests sent' : 'Request sent'));
    body.append(h('div', { class: 'done' },
      h('div', { class: 'done-mark' }, icon('check', 28)),
      h('p', { class: 'done-msg', text: approved ? 'Booked' : (plural ? "Requests sent — you'll get an email when they're approved" : "Request sent — you'll get an email when it's approved") }),
      list.map(function (b) { return h('p', { class: 'mono', text: b.resource_name + ' · ' + fmtRange(b.start, b.end) }); }),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: '#/bookings', onclick: function () { sheet.close(); }, text: 'View my bookings' }),
        h('button', { class: 'btn', type: 'button', onclick: function () { sheet.close(); }, text: 'Done' }))));
  }
}
