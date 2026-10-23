import { call } from '../api.js';
import { h, add, clear, fmtRange, money, nowLocal, hoursUntil, fullName, playerName, hashParams, clearHashParams } from '../util.js';
import { banner, skeleton, pill, sharePill, invitePill, setBusy, field } from '../ui.js';

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

    // The engine flags only the viewer's own entry (waiver_needed) when their Participant Agreement is missing.
    function waiverNote(bk) {
      const mine = bk.players.filter(function (p) { return p.member_id === state.me.member.member_id && p.waiver_needed; })[0];
      if (!mine || bk.status === 'Cancelled' || bk.status === 'Rejected') return null;
      return h('p', { class: 'hint warn-text' }, 'Please sign the waiver before you play. ', h('a', { href: '#/waiver', text: 'Sign the waiver' }));
    }

    function paint(bk) {
      clear(card);
      clear(actions);
      if (bk.is_block) { paintBlock(bk); return; }
      add(card,
        h('div', { class: 'bk-head' }, h('div', null, h('h2', { text: bk.resource_name }), h('p', { class: 'mono', text: fmtRange(bk.start, bk.end) })), pill(bk.status)),
        bk.late_cancel ? h('p', { class: 'hint warn-text', text: 'Cancelled within the free cancellation window.' }) : null,
        bk.is_booker ? null : h('p', { class: 'hint', text: 'Booked by ' + fullName(bk.booker) }),
        waiverNote(bk),
        h('ul', { class: 'players detail' }, bk.players.map(function (p) { return playerRow(bk, p); })),
        h('p', { class: 'hint' }, (bk.pay_mode === 'BookerPays' ? 'Booker covers everyone' : 'Everyone pays their share') + ' · Total ' + money(bk.total_amount)),
        errSlot, actions);
      const own = bk.players.filter(function (p) { return p.can_pay && p.share_id; })[0];
      if (own) {
        const pay = h('button', { class: 'btn primary', type: 'button', text: 'Pay ' + money(own.share_amount) + ' now' });
        pay.addEventListener('click', function () { payNow(pay, own); });
        actions.append(pay);
      }
      if (bk.can_release) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Release remaining time', onclick: function () { confirmRelease(bk); } }));
      }
      if (bk.can_cancel) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Cancel booking', onclick: function () { confirmCancel(bk); } }));
      }
    }

    // An owner block: "Blocked: reason" with Remove block (any time, even after it has started) and Release remaining time.
    function paintBlock(bk) {
      add(card,
        h('div', { class: 'bk-head' }, h('div', null, h('h2', { text: 'Blocked' + (bk.block_reason ? ': ' + bk.block_reason : '') }),
          h('p', { class: 'mono', text: bk.resource_name + ' · ' + fmtRange(bk.start, bk.end) })), pill(bk.status)),
        bk.series_id ? h('p', { class: 'hint', text: 'Part of a repeating block.' }) : null,
        errSlot, actions);
      if (bk.can_release) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Release remaining time', onclick: function () { confirmRelease(bk); } }));
      }
      if (bk.can_remove_block) {
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Remove block', onclick: function () { confirmRemoveBlock(bk); } }));
      }
    }

    function confirmRemoveBlock(bk) {
      clear(actions);
      clear(errSlot);
      const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, remove block' });
      const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm remove block' },
        h('p', { text: 'Remove this block? The court opens up for booking right away.' }),
        bk.series_id ? h('p', { class: 'hint', text: 'Only this date is removed. The repeating block carries on; stop it from the Owner screen.' }) : null,
        h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep block', onclick: function () { paint(bk); } })));
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Removing…');
        try {
          const out = await call('ownerRemoveBlock', { booking_id: bk.booking_id });
          if (ctx.stale()) return;
          paint(out.booking);
          errSlot.append(banner('Block removed.', 'info'));
        } catch (e) {
          clear(errSlot);
          errSlot.append(banner(e));
          setBusy(yes, false);
        }
      });
      actions.append(panel);
      yes.focus();
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

    // Resend / Remove for an invitee who has not accepted (booker only).
    function playerRow(bk, p) {
      const li = baseRow(bk, p);
      if (bk.is_booker && p.invite_id && p.invite_status === 'invited' && (bk.status === 'Pending' || bk.status === 'Approved') && bk.start > nowLocal()) {
        li.classList.add('has-actions');
        const row = h('div', { class: 'invite-actions' });
        const resend = h('button', { class: 'btn small', type: 'button', text: 'Resend' });
        resend.addEventListener('click', async function () {
          clear(errSlot);
          setBusy(resend, true, 'Sending…');
          try {
            await call('resendInvite', { invite_id: p.invite_id });
            errSlot.append(banner('Invitation sent again.', 'info'));
          } catch (e) { errSlot.append(banner(e)); }
          setBusy(resend, false);
        });
        row.append(resend, h('button', { class: 'btn small danger-ghost', type: 'button', text: 'Remove', onclick: function () { confirmRemove(bk, p); } }));
        li.append(row);
      }
      return li;
    }

    function confirmRemove(bk, p) {
      clear(actions);
      clear(errSlot);
      const free = state.me.settings.free_cancel_hours;
      const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, remove' });
      const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm remove' },
        h('p', { text: 'Remove ' + playerName(p) + ' from this booking? Their invitation will stop working.' }),
        h('p', { class: 'hint', text: hoursUntil(bk.start) > free
          ? 'Their share is taken off and the cost is split between the other players.'
          : 'This is close to the start, so their share is charged to you at the start time.' }),
        h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep them', onclick: function () { paint(bk); } })));
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Removing…');
        try {
          const out = await call('removeInvite', { booking_id: bk.booking_id, invite_id: p.invite_id });
          if (ctx.stale()) return;
          if (out && out.booking) { paint(out.booking); errSlot.append(banner('Removed.', 'info')); }
          else await load();
        } catch (e) {
          clear(errSlot);
          errSlot.append(banner(e));
          setBusy(yes, false);
        }
      });
      actions.append(panel);
      yes.focus();
    }

    // A booking in progress: the current 2-hour block stays, later blocks open up for others. No money changes.
    function confirmRelease(bk) {
      clear(actions);
      clear(errSlot);
      const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, release it' });
      const panel = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm release' },
        h('p', { text: 'Release the rest of this booking? The time slot you are in now stays yours; every later slot opens up for other members.' }),
        h('p', { class: 'hint', text: 'Nothing is refunded or charged.' }),
        h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep booking', onclick: function () { paint(bk); } })));
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Releasing…');
        try {
          const out = await call('releaseRemaining', { booking_id: bk.booking_id });
          if (ctx.stale()) return;
          paint(out.booking);
          errSlot.append(banner('Released. The later time slots are open for others now.', 'info'));
        } catch (e) {
          clear(errSlot);
          errSlot.append(banner(e));
          setBusy(yes, false);
        }
      });
      actions.append(panel);
      yes.focus();
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

function baseRow(bk, p) {
  let status = p.share_status;
  if (!status && bk.pay_mode === 'BookerPays' && !(p.share_amount > 0)) status = 'CoveredByBooker';
  const invited = p.invite_status === 'invited' || p.invite_status === 'no_response' || p.invite_status === 'declined';
  const showAmount = !invited && status !== 'Waived' && status !== 'CoveredByBooker' && status !== 'Cancelled' && p.share_amount > 0;
  return h('li', null,
    h('span', { class: 'pname' }, playerName(p),
      p.status && p.status !== 'Active' ? h('span', { class: 'tag warn', text: p.status === 'Pending' ? 'Awaiting approval' : p.status }) : null),
    h('span', { class: 'share-cell' },
      showAmount ? h('span', { class: 'mono share', text: money(p.share_amount) }) : null,
      showAmount && p.credit_applied > 0 ? h('span', { class: 'hint credit-used', text: '(' + money(p.credit_applied) + ' credit used)' }) : null,
      invited ? null : sharePill(status),
      invitePill(p.invite_status)));
}
