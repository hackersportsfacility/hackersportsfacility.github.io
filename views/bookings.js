import { call } from '../api.js';
import { h, add, clear, fmtRange, money, nowLocal, hoursUntil, fullName, hashParams, clearHashParams } from '../util.js';
import { banner, skeleton, pill, sharePill, setBusy, field } from '../ui.js';

export async function renderBookings(root, ctx) {
  const state = ctx.state;
  let showPast = false;
  const listSlot = h('div');
  const noteSlot = h('div');
  const seg = h('div', { class: 'segs toggle', role: 'group', 'aria-label': 'Which bookings' });
  root.append(h('h1', { text: 'My bookings' }), noteSlot, seg, listSlot);

  function renderToggle() {
    clear(seg);
    [['Upcoming', false], ['Past', true]].forEach(function (o) {
      seg.append(h('button', {
        type: 'button', class: 'seg-btn' + (showPast === o[1] ? ' on' : ''), 'aria-pressed': showPast === o[1] ? 'true' : 'false', text: o[0],
        onclick: function () { if (showPast !== o[1]) { showPast = o[1]; renderToggle(); load(); } },
      }));
    });
  }

  // Coming back from Stripe Checkout: #/bookings?paid=1&cs=...
  const rp = hashParams();
  if (rp.paid) {
    clearHashParams();
    if (rp.cs) {
      try {
        await call('confirmPayment', { cs: rp.cs });
        noteSlot.append(banner('Payment received', 'info'));
      } catch (e) {
        noteSlot.append(banner(e));
      }
      if (ctx.stale()) return;
    }
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
        h('p', { class: 'hint' }, (bk.pay_mode === 'BookerPays' ? 'Booker covers everyone' : 'Everyone pays their share') + ' · Total ' + money(bk.total_amount)),
        errSlot, actions);
      const own = bk.players.filter(function (p) { return p.can_pay && p.share_id; })[0];
      if (own) {
        const pay = h('button', { class: 'btn primary', type: 'button', text: 'Pay ' + money(own.share_amount) + ' now' });
        pay.addEventListener('click', function () { payNow(pay, own); });
        actions.append(pay);
      }
      if (bk.can_cancel) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Cancel booking', onclick: function () { confirmCancel(bk); } }));
      }
    }

    async function payNow(btn, p) {
      clear(errSlot);
      setBusy(btn, true, 'Paying…');
      try {
        const out = await call('payShare', { share_id: p.share_id });
        if (out && out.url) { location.href = out.url; return; }
        // { paid: true } (or the demo's mock_paid): refresh the list
        noteSlot.replaceChildren(banner(out && out.credit_applied > 0 ? 'Payment received. ' + money(out.credit_applied) + ' of your credit was used.' : 'Payment received', 'info'));
        ctx.loadMe().catch(function () { /* credit balance refresh is best effort */ });
        await load();
      } catch (e) {
        errSlot.append(banner(e));
        setBusy(btn, false);
      }
    }

    // What the cancel will mean: Pending requests and Approved bookings more than the free window ahead
    // cost nothing; an Approved booking inside the window is a late cancellation (charges stand).
    function confirmCancel(bk) {
      clear(actions);
      clear(errSlot);
      const free = state.me.settings.free_cancel_hours;
      const isOwner = !!state.me.member.is_owner;
      const late = bk.status === 'Approved' && !isOwner && hoursUntil(bk.start) <= free;
      const anyPaid = bk.players.some(function (p) { return p.share_status === 'Paid'; });
      const reason = late ? h('textarea', { rows: '3', maxlength: '300', 'aria-label': 'Reason (optional)' }) : null;
      const yes = h('button', { class: 'btn danger', type: 'button', text: late ? 'Cancel booking' : 'Yes, cancel booking' });
      const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm cancel' },
        h('p', { text: late
          ? "This is within " + free + " hours of the start, so the charges stand. If you have a good reason, tell the owner below and they may return it as a credit."
          : "Cancel this booking? There's no charge." }),
        late ? field('Reason (optional)', reason) : null,
        h('div', { class: 'btn-row' }, yes,
          h('button', { class: 'btn', type: 'button', text: 'Keep booking', onclick: function () { paint(bk); } })));
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Cancelling…');
        const asked = late ? reason.value.trim() : '';
        try {
          const out = await call('cancelBooking', { booking_id: bk.booking_id, reason: asked || undefined });
          paint(out.booking);
          let msg;
          if (late) msg = asked ? 'Cancelled. The owner has been asked about a credit.' : 'Cancelled. The charges stand.';
          else msg = 'Cancelled. No charge.' + (anyPaid ? ' Payments already made will be returned.' : '');
          errSlot.append(banner(msg, 'info'));
          ctx.loadMe().catch(function () { /* usage refresh is best effort */ });
        } catch (e) {
          clear(errSlot);
          errSlot.append(banner(e));
          setBusy(yes, false);
        }
      });
      actions.append(panel);
      (reason || yes).focus();
    }

    paint(b);
    return card;
  }

  renderToggle();
  await load();
}

function playerRow(bk, p) {
  let status = p.share_status;
  if (!status && bk.pay_mode === 'BookerPays' && !(p.share_amount > 0)) status = 'CoveredByBooker';
  const showAmount = status !== 'Waived' && status !== 'CoveredByBooker' && status !== 'Cancelled' && p.share_amount > 0;
  return h('li', null,
    h('span', { class: 'pname' }, fullName(p),
      p.status && p.status !== 'Active' ? h('span', { class: 'tag warn', text: p.status === 'Pending' ? 'Awaiting approval' : p.status }) : null),
    h('span', { class: 'share-cell' },
      showAmount ? h('span', { class: 'mono share', text: money(p.share_amount) }) : null,
      showAmount && p.credit_applied > 0 ? h('span', { class: 'hint credit-used', text: '(' + money(p.credit_applied) + ' credit used)' }) : null,
      sharePill(status)));
}
