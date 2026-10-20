import { call } from '../api.js';
import { h, add, clear, fmtRange, money, nowLocal, hoursUntil, fullName } from '../util.js';
import { banner, skeleton, pill, setBusy } from '../ui.js';

export async function renderBookings(root, ctx) {
  const state = ctx.state;
  let showPast = false;
  const listSlot = h('div');
  const seg = h('div', { class: 'segs toggle', role: 'group', 'aria-label': 'Which bookings' });
  root.append(h('h1', { text: 'My bookings' }), seg, listSlot);

  function renderToggle() {
    clear(seg);
    [['Upcoming', false], ['Past', true]].forEach(function (o) {
      seg.append(h('button', {
        type: 'button', class: 'seg-btn' + (showPast === o[1] ? ' on' : ''), 'aria-pressed': showPast === o[1] ? 'true' : 'false', text: o[0],
        onclick: function () { if (showPast !== o[1]) { showPast = o[1]; renderToggle(); load(); } },
      }));
    });
  }

  async function load() {
    clear(listSlot);
    listSlot.append(skeleton(3, true));
    let data;
    try {
      data = await call('myBookings', { include_past: showPast });
    } catch (e) {
      if (ctx.stale()) return;
      clear(listSlot);
      listSlot.append(banner(e), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: load }));
      return;
    }
    if (ctx.stale()) return;
    const now = nowLocal();
    let list = (data.bookings || []).filter(function (b) { return showPast ? b.start < now : b.start >= now; });
    list.sort(function (a, b) { return (a.start < b.start ? -1 : 1) * (showPast ? -1 : 1); });
    clear(listSlot);
    if (!list.length) {
      listSlot.append(h('div', { class: 'empty' },
        h('p', { text: showPast ? 'No past bookings yet.' : 'You have no upcoming bookings.' }),
        showPast ? null : h('a', { class: 'btn primary', href: '#/book', text: 'Book a court' })));
      return;
    }
    list.forEach(function (b) { listSlot.append(bookingCard(b)); });
  }

  function bookingCard(b) {
    const card = h('article', { class: 'card booking' });
    const errSlot = h('div');
    const actions = h('div', { class: 'btn-row' });

    function paint(bk) {
      clear(card);
      clear(actions);
      add(card,
        h('div', { class: 'bk-head' }, h('div', null, h('h2', { text: bk.resource_name }), h('p', { class: 'mono', text: fmtRange(bk.start, bk.end) })), pill(bk.status)),
        bk.late_cancel ? h('p', { class: 'hint warn-text', text: 'Cancelled within the free cancellation window.' }) : null,
        bk.is_booker ? null : h('p', { class: 'hint', text: 'Booked by ' + fullName(bk.booker) }),
        h('ul', { class: 'players detail' }, bk.players.map(function (p) { return playerRow(bk, p); })),
        h('p', { class: 'hint' }, (bk.pay_mode === 'BookerPays' ? 'Booker covers everyone' : 'Everyone pays their share') + ' · Total ' + money(bk.total_amount) + " · Payment isn't collected yet."),
        errSlot, actions);
      if (bk.can_cancel) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Cancel booking', onclick: function () { confirmCancel(bk); } }));
      }
    }

    function confirmCancel(bk) {
      clear(actions);
      clear(errSlot);
      const late = hoursUntil(bk.start) < state.me.settings.free_cancel_hours;
      const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, cancel booking' });
      const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm cancel' },
        h('p', { text: 'Cancel this booking for ' + fmtRange(bk.start, bk.end) + '?' }),
        late ? h('p', { class: 'warn-text', text: 'This is within ' + state.me.settings.free_cancel_hours + ' hours of the start and may be charged.' }) : null,
        h('div', { class: 'btn-row' }, yes,
          h('button', { class: 'btn', type: 'button', text: 'Keep booking', onclick: function () { paint(bk); } })));
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Cancelling…');
        try {
          const out = await call('cancelBooking', { booking_id: bk.booking_id });
          paint(out.booking);
          ctx.loadMe().catch(function () { /* usage refresh is best effort */ });
        } catch (e) {
          clear(errSlot);
          errSlot.append(banner(e));
          setBusy(yes, false);
        }
      });
      actions.append(panel);
      yes.focus();
    }

    paint(b);
    return card;
  }

  renderToggle();
  await load();
}

function playerRow(bk, p) {
  let share;
  if (bk.pay_mode === 'BookerPays' && !(p.share_amount > 0)) share = 'Covered by booker';
  else share = money(p.share_amount) + (p.share_status ? ' · ' + p.share_status : '');
  return h('li', null,
    h('span', { class: 'pname' }, fullName(p),
      p.status && p.status !== 'Active' ? h('span', { class: 'tag warn', text: p.status === 'Pending' ? 'Awaiting approval' : p.status }) : null),
    h('span', { class: 'mono share', text: share }));
}
