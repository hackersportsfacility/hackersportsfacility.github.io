import { call, isMock } from '../api.js';
import { h, add, clear, fmtRange, fmtDay, fmtDate, timeRange, money, fullName, playerName, parseLocal, pad, todayYmd, dowName } from '../util.js';
import { banner, skeleton, pill, rolePill, sharePill, invitePill, field, setBusy, weekdayPicker, endPicker } from '../ui.js';

function hoursLabel(start, end) {
  const a = parseLocal(start), b = parseLocal(end);
  const n = ((b.h * 60 + b.mi) - (a.h * 60 + a.mi)) / 60;
  return n + (n === 1 ? ' hour' : ' hours');
}

export async function renderOwner(root, ctx) {
  const dashSlot = h('div');
  const blockSlot = h('section', { class: 'card' });
  const membersSlot = h('section');
  root.append(h('h1', { text: 'Owner' }), dashSlot, blockSlot, membersSlot);
  if (isMock()) {
    import('../mock.js').then(function (m) {
      root.append(h('details', { class: 'card demo-links' }, h('summary', { text: 'Demo: open an email approval link' }),
        h('ul', null, m.DEMO_LINKS.map(function (l) { return h('li', null, h('a', { href: '#/go?t=' + l[0], text: l[1] })); }))));
    });
  }
  dashSlot.append(skeleton(4, true));

  async function loadDash() {
    let d;
    try { d = await call('ownerDashboard', {}); }
    catch (e) {
      if (ctx.stale()) return;
      clear(dashSlot);
      dashSlot.append(banner(e), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: loadDash }));
      return;
    }
    if (ctx.stale()) return;
    clear(dashSlot);
    add(dashSlot, stats(d), pendingBookings(d), clashesSection(d), owedSection(d), lateCancellations(d), pendingMembers(d), awaitingGuardian(d), upcoming(d), repeatingSection(d));
  }

  function stats(d) {
    const c = d.counts || {};
    const tile = function (n, label) { return h('div', { class: 'stat' }, h('strong', { class: 'mono', text: String(n) }), h('span', { text: label })); };
    return h('div', { class: 'stats' }, tile(c.active_members, 'Active members'), tile(c.bookings_this_week, 'Bookings this week'), tile(d.email_quota_remaining, 'Emails left today'));
  }

  // Generic approve/reject row with inline reason for reject.
  function decisionRow(opts) {
    const wrap = h('div');
    const errSlot = h('div');
    const approve = h('button', { class: 'btn primary', type: 'button', text: 'Approve' });
    const waive = opts.waive ? h('button', { class: 'btn', type: 'button', text: 'Approve and waive fees' }) : null;
    const reject = h('button', { class: 'btn danger-ghost', type: 'button', text: 'Reject' });
    const row = h('div', { class: 'btn-row' });
    const showRow = function () { clear(row); add(row, approve, waive, reject); };
    showRow();
    wrap.append(errSlot, row);

    async function send(decision, reason, btn, label) {
      clear(errSlot);
      setBusy(btn, true, label);
      approve.disabled = true; reject.disabled = true; if (waive) waive.disabled = true;
      try {
        await opts.send(decision, reason);
        await loadDash();
      } catch (e) {
        errSlot.append(banner(e));
        setBusy(btn, false);
        approve.disabled = false; reject.disabled = false; if (waive) waive.disabled = false;
      }
    }
    approve.addEventListener('click', function () { send('approve', '', approve, 'Approving…'); });
    if (waive) waive.addEventListener('click', function () { send('approve_waive', '', waive, 'Approving…'); });
    reject.addEventListener('click', function () {
      clear(row);
      const input = h('input', { type: 'text', maxlength: '200', autocomplete: 'off' });
      const go = h('button', { class: 'btn danger', type: 'button', text: 'Confirm reject' });
      const back = h('button', { class: 'btn', type: 'button', text: 'Back', onclick: showRow });
      go.addEventListener('click', function () { send('reject', input.value.trim(), go, 'Rejecting…'); });
      row.append(field(opts.reasonLabel, input), h('div', { class: 'btn-row' }, go, back));
      input.focus();
    });
    return wrap;
  }

  function pendingBookings(d) {
    const sec = h('section', null, h('h2', { text: 'Booking requests (' + d.pending_bookings.length + ')' }));
    if (!d.pending_bookings.length) sec.append(h('p', { class: 'empty', text: 'No bookings waiting for approval.' }));
    d.pending_bookings.forEach(function (b) {
      const email = (b.booker && b.booker.email) || b.booker_email || '';
      const phone = (b.booker && b.booker.phone) || b.booker_phone || '';
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: b.resource_name }), h('p', { class: 'mono', text: fmtRange(b.start, b.end) + ' (' + hoursLabel(b.start, b.end) + ')' })), pill(b.status)),
        h('p', null, h('strong', { text: fullName(b.booker) }), email ? ' · ' + email : '', phone ? ' · ' + phone : ''),
        h('ul', { class: 'players detail' }, b.players.map(function (p) {
          return h('li', null,
            h('span', { class: 'pname' }, playerName(p),
              p.status !== 'Active' && p.status !== 'Invited' ? h('span', { class: 'tag warn', text: p.status === 'Pending' ? 'Guest needs approval' : p.status }) : null,
              p.waiver_needed ? h('span', { class: 'tag warn', text: 'No waiver' }) : null,
              p.email && playerName(p) !== p.email ? h('span', { class: 'p-email', text: p.email }) : null),
            h('span', { class: 'share-cell' },
              h('span', { class: 'mono share', text: p.share_status === 'Waived' ? 'Waived' : money(p.share_amount) }),
              invitePill(p.invite_status)));
        })),
        decisionRow({
          waive: true,
          reasonLabel: 'Reason (optional)',
          send: function (decision, reason) { return call('ownerDecideBooking', { booking_id: b.booking_id, decision: decision, reason: reason || undefined }); },
        })));
    });
    return sec;
  }

  function pendingMembers(d) {
    const sec = h('section', null, h('h2', { text: 'Membership requests (' + d.pending_members.length + ')' }));
    if (!d.pending_members.length) sec.append(h('p', { class: 'empty', text: 'No members waiting for approval.' }));
    d.pending_members.forEach(function (m) {
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: fullName(m) }),
          h('p', { class: 'hint', text: m.role === 'Guest' ? 'Guest' + (m.invited_by_name ? ' invited by ' + m.invited_by_name : '') : 'New member request' })), pill('Pending')),
        h('p', { class: 'hint', text: [m.email, m.phone].filter(Boolean).join(' · ') }),
        decisionRow({
          reasonLabel: 'Note (optional)',
          send: function (decision, note) { return call('ownerDecideMember', { member_id: m.member_id, decision: decision, note: note || undefined }); },
        })));
    });
    return sec;
  }

  function awaitingGuardian(d) {
    const list = d.waivers_awaiting_guardian || [];
    if (!list.length) return null;
    const sec = h('section', null, h('h2', { text: 'Waiting for parent/guardian signature (' + list.length + ')' }));
    list.forEach(function (w) {
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: w.minor_name }),
          h('p', { class: 'hint', text: 'Guardian: ' + [w.guardian_name, w.guardian_email].filter(Boolean).join(' · ') })),
          h('span', { class: 'pill ' + (w.reminder_sent ? 'muted' : 'warn'), text: w.reminder_sent ? 'Reminder sent' : 'No reminder yet' })),
        h('p', { class: 'hint', text: 'Requested ' + (w.requested_at ? fmtDate(w.requested_at) : '') + (w.link_expires_at ? ' · link expires ' + fmtDate(w.link_expires_at) : '') })));
    });
    return sec;
  }

  // Radio group helper: returns { el, value() }.
  let radioN = 0;
  function radios(legend, opts, def) {
    const name = 'rg' + (++radioN);
    const inputs = opts.map(function (o) { return h('input', { type: 'radio', name: name, value: o[0], checked: o[0] === def }); });
    const el = h('fieldset', { class: 'opt-group' }, h('legend', { text: legend }),
      h('div', { class: 'segs col' }, opts.map(function (o, i) { return h('label', { class: 'seg' }, inputs[i], h('span', { text: o[1] })); })));
    return { el: el, value: function () { const c = inputs.filter(function (x) { return x.checked; })[0]; return c ? c.value : def; } };
  }
  const returnable = function (p) { return p.share_status === 'Paid' || p.share_status === 'CoveredByBooker'; };

  function waivePanel(b, close, done) {
    const errSlot = h('div', { 'aria-live': 'polite' });
    const checks = b.players.map(function (p) {
      const cb = h('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', sync);
      return { p: p, cb: cb };
    });
    const reason = h('input', { type: 'text', maxlength: '200', autocomplete: 'off' });
    const paidAs = radios('Return paid amounts as', [['credit', 'Credit (recommended)'], ['refund', 'Refund to card']], 'credit');
    const paidSlot = h('div');
    const go = h('button', { class: 'btn primary', type: 'button', text: 'Waive fees' });
    function sync() {
      clear(paidSlot);
      if (checks.some(function (c) { return c.cb.checked && returnable(c.p); })) paidSlot.append(paidAs.el);
    }
    go.addEventListener('click', async function () {
      clear(errSlot);
      const chosen = checks.filter(function (c) { return c.cb.checked; });
      if (!chosen.length) { errSlot.append(banner('Pick at least one player.')); return; }
      if (!reason.value.trim()) { errSlot.append(banner('Please type a reason.')); reason.focus(); return; }
      setBusy(go, true, 'Waiving…');
      const req = { booking_id: b.booking_id, reason: reason.value.trim() };
      if (chosen.length !== checks.length) req.member_ids = chosen.map(function (c) { return c.p.member_id; });
      if (paidSlot.firstChild) req.paid_as = paidAs.value();
      try {
        await call('ownerWaiveFees', req);
        done('Fees waived.');
      } catch (e) { errSlot.append(banner(e)); setBusy(go, false); }
    });
    const list = h('ul', { class: 'players detail' }, checks.map(function (c) {
      return h('li', null,
        h('label', { class: 'check-row tight' }, c.cb, h('span', { text: playerName(c.p) })),
        h('span', { class: 'share-cell' }, c.p.share_amount > 0 ? h('span', { class: 'mono share', text: money(c.p.share_amount) }) : null, sharePill(c.p.share_status)));
    }));
    sync();
    return h('div', { class: 'confirm', role: 'dialog', 'aria-label': 'Waive fees' },
      h('p', null, h('strong', { text: 'Waive fees' }), ' for ' + b.resource_name + ', ' + fmtRange(b.start, b.end)),
      list, paidSlot, field('Reason (required)', reason), errSlot,
      h('div', { class: 'btn-row' }, go, h('button', { class: 'btn', type: 'button', text: 'Back', onclick: close })));
  }

  function cancelPanel(b, close, done) {
    const errSlot = h('div', { 'aria-live': 'polite' });
    const paidAs = radios('Return paid amounts as', [['refund', 'Refund to card'], ['credit', 'Credit']], 'refund');
    const yes = h('button', { class: 'btn danger', type: 'button', text: 'Cancel booking' });
    const anyPaid = b.players.some(returnable);
    yes.addEventListener('click', async function () {
      clear(errSlot);
      setBusy(yes, true, 'Cancelling…');
      try {
        await call('cancelBooking', anyPaid ? { booking_id: b.booking_id, paid_as: paidAs.value() } : { booking_id: b.booking_id });
        done('Booking cancelled.');
      } catch (e) { errSlot.append(banner(e)); setBusy(yes, false); }
    });
    return h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm cancel booking' },
      h('p', { text: 'Cancel ' + b.resource_name + ', ' + fmtRange(b.start, b.end) + ' for ' + fullName(b.booker) + '?' }),
      h('p', { class: 'hint', text: 'Anyone who has not paid is not charged. No strikes. The players are emailed.' }),
      anyPaid ? paidAs.el : null, errSlot,
      h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep booking', onclick: close })));
  }

  function removePanel(b, close, done) {
    const errSlot = h('div', { 'aria-live': 'polite' });
    const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, remove block' });
    yes.addEventListener('click', async function () {
      clear(errSlot);
      setBusy(yes, true, 'Removing…');
      try {
        await call('ownerRemoveBlock', { booking_id: b.booking_id });
        done('Block removed.');
      } catch (e) { errSlot.append(banner(e)); setBusy(yes, false); }
    });
    return h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm remove block' },
      h('p', { text: 'Remove the block on ' + b.resource_name + ', ' + fmtRange(b.start, b.end) + '? The court opens up for booking right away.' }),
      b.series_id ? h('p', { class: 'hint', text: 'Only this date is removed. The repeating block carries on; stop it in the Repeating list.' }) : null, errSlot,
      h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep block', onclick: close })));
  }

  function upcoming(d) {
    const sec = h('section', null, h('h2', { text: 'Next 7 days' }));
    if (!d.upcoming.length) { sec.append(h('p', { class: 'empty', text: 'Nothing booked in the next 7 days.' })); return sec; }
    const ul = h('ul', { class: 'agenda' });
    d.upcoming.forEach(function (b) {
      const panelSlot = h('div');
      const actions = h('div', { class: 'btn-row agenda-actions' });
      const li = h('li', null,
        h('span', { class: 'mono', text: fmtDay(b.start) + ' · ' + timeRange(b.start, b.end, true) }),
        h('span', { text: b.is_block ? 'Blocked' + (b.block_reason ? ': ' + b.block_reason : '') + ' · ' + b.resource_name : b.resource_name + ' · ' + fullName(b.booker) }),
        panelSlot, actions);
      const showActions = function () {
        clear(panelSlot); clear(actions);
        if (b.status !== 'Approved') return;
        if (b.is_block) {
          if (b.can_remove_block !== false) {
            actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Remove block', 'aria-label': 'Remove block on ' + b.resource_name + ' ' + fmtDay(b.start), onclick: function () { open(removePanel); } }));
          }
          return;
        }
        actions.append(
          h('button', { class: 'btn', type: 'button', text: 'Waive fees', 'aria-label': 'Waive fees for ' + b.resource_name + ' ' + fmtDay(b.start), onclick: function () { open(waivePanel); } }),
          h('button', { class: 'btn danger-ghost', type: 'button', text: 'Cancel booking', 'aria-label': 'Cancel ' + b.resource_name + ' ' + fmtDay(b.start), onclick: function () { open(cancelPanel); } }));
      };
      function open(make) {
        clear(panelSlot); clear(actions);
        const p = make(b, showActions, function (msg) {
          clear(panelSlot);
          panelSlot.append(banner(msg, 'info'));
          loadDash();
        });
        panelSlot.append(p);
        const first = p.querySelector('input[type=text],button');
        if (first) first.focus();
      }
      showActions();
      ul.append(li);
    });
    sec.append(ul);
    return sec;
  }

  // A repeating entry's text: "Mon, Wed · 8:00–10:00 AM" / "Whole day", then when it starts and ends.
  function seriesWhen(sr) {
    const t = sr.whole_day ? 'Whole day' : timeRange('2000-01-01T' + sr.start_time, '2000-01-01T' + sr.end_time, true);
    return (sr.weekdays || []).join(', ') + ' · ' + t;
  }
  function seriesSpan(sr) {
    return 'From ' + fmtDate(sr.start_date) + (sr.end_date ? ' until ' + fmtDate(sr.end_date) : ' until you stop it');
  }
  const kindWord = function (kind) { return kind === 'block' ? 'block' : 'booking'; };

  // Repeating blocks / bookings that would overlap a member's booking: the owner picks Bump or Skip (both ask first).
  function clashesSection(d) {
    const list = d.clashes || [];
    if (!list.length) return null;
    const sec = h('section', null, h('h2', { text: 'Clashes (' + list.length + ')' }));
    list.forEach(function (c) {
      const panelSlot = h('div');
      const actions = h('div', { class: 'btn-row' });
      const names = [];
      c.bookings.forEach(function (b) { if (names.indexOf(b.booker_name) < 0) names.push(b.booker_name); });
      const who = names.join(' and ') || 'a member';
      const showActions = function () {
        clear(panelSlot); clear(actions);
        actions.append(
          h('button', { class: 'btn danger-ghost', type: 'button', text: 'Bump this booking', 'aria-label': 'Bump the booking on ' + fmtDay(c.date), onclick: function () { open('bump'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Skip this date', 'aria-label': 'Skip ' + fmtDay(c.date), onclick: function () { open('skip'); } }));
      };
      function open(how) {
        clear(panelSlot); clear(actions);
        const errSlot = h('div', { 'aria-live': 'polite' });
        const go = h('button', { class: 'btn ' + (how === 'bump' ? 'danger' : 'primary'), type: 'button', text: how === 'bump' ? 'Yes, bump' : 'Yes, skip' });
        go.addEventListener('click', async function () {
          clear(errSlot);
          setBusy(go, true, how === 'bump' ? 'Bumping…' : 'Skipping…');
          try {
            await call('ownerDecideClash', { clash_id: c.clash_id, decision: how });
            await loadDash();
          } catch (e) { errSlot.append(banner(e)); setBusy(go, false); }
        });
        panelSlot.append(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': how === 'bump' ? 'Confirm bump' : 'Confirm skip' },
          h('p', { text: how === 'bump'
            ? 'Bump ' + who + (c.bookings.length > 1 ? "'s bookings" : "'s booking") + ' on ' + fmtDay(c.date) + '?'
            : 'Skip ' + fmtDay(c.date) + '? ' + who + (c.bookings.length > 1 ? "'s bookings stay" : "'s booking stays") + " and your repeating " + kindWord(c.kind) + " won't be made for this date." }),
          how === 'bump' ? h('p', { class: 'hint', text: 'The booking is cancelled for free. Anything already paid comes back, and the players are emailed: “The facility needs the court at this time.”' }) : null,
          errSlot, h('div', { class: 'btn-row' }, go, h('button', { class: 'btn', type: 'button', text: 'Back', onclick: showActions }))));
        go.focus();
      }
      showActions();
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null,
          h('h3', { text: 'Repeating ' + kindWord(c.kind) + ' clashes with ' + who + (c.bookings.length > 1 ? "'s bookings" : "'s booking") }),
          h('p', { class: 'mono', text: c.resource_name + ' · ' + fmtRange(c.start, c.end) })), h('span', { class: 'pill warn', text: 'Needs a decision' })),
        c.reason ? h('p', { class: 'hint', text: (c.kind === 'block' ? 'Block' : 'Your booking') + ': ' + c.reason }) : null,
        h('ul', { class: 'players detail' }, c.bookings.map(function (b) {
          return h('li', null, h('span', { class: 'pname', text: b.booker_name + ' · ' + b.resource_name + ', ' + fmtRange(b.start, b.end) }), pill(b.status));
        })),
        h('p', { class: 'hint', text: 'If you do nothing, this date is skipped when their booking starts.' }),
        panelSlot, actions));
    });
    return sec;
  }

  // Active repeating blocks and owner bookings, each with Stop (asks first).
  function repeatingSection(d) {
    const list = d.series || [];
    const sec = h('section', null, h('h2', { text: 'Repeating (' + list.length + ')' }));
    if (!list.length) { sec.append(h('p', { class: 'empty', text: 'Nothing repeats right now. Use Repeat on the Block time card or when you book.' })); return sec; }
    list.forEach(function (sr) {
      const panelSlot = h('div');
      const actions = h('div', { class: 'btn-row' });
      const showActions = function () {
        clear(panelSlot); clear(actions);
        actions.append(h('button', { class: 'btn danger-ghost', type: 'button', text: 'Stop', 'aria-label': 'Stop repeating ' + kindWord(sr.kind) + ' on ' + sr.resource_name, onclick: open }));
      };
      function open() {
        clear(panelSlot); clear(actions);
        const errSlot = h('div', { 'aria-live': 'polite' });
        const yes = h('button', { class: 'btn danger', type: 'button', text: 'Yes, stop' });
        yes.addEventListener('click', async function () {
          clear(errSlot);
          setBusy(yes, true, 'Stopping…');
          try {
            await call('ownerStopSeries', { series_id: sr.series_id });
            await loadDash();
          } catch (e) { errSlot.append(banner(e)); setBusy(yes, false); }
        });
        panelSlot.append(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm stop' },
          h('p', { text: 'Stop this repeating ' + kindWord(sr.kind) + ' (' + sr.resource_name + ', ' + seriesWhen(sr) + ')?' }),
          h('p', { class: 'hint', text: 'The dates still to come are removed and the court opens up. Any date that has already started stays.' }),
          errSlot, h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'Keep it', onclick: showActions }))));
        yes.focus();
      }
      showActions();
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null,
          h('h3', { text: (sr.kind === 'block' ? 'Block' : 'Your booking') + ' · ' + sr.resource_name }),
          h('p', { class: 'mono', text: seriesWhen(sr) })), h('span', { class: 'pill muted', text: sr.kind === 'block' ? 'Block' : 'Booking' })),
        h('p', { class: 'hint', text: seriesSpan(sr) + (sr.reason ? ' · ' + sr.reason : '') }),
        panelSlot, actions));
    });
    return sec;
  }

  // Late cancellations from the last 14 days that the owner has not decided yet.
  function lateCancellations(d) {
    const list = d.late_cancellations || [];
    if (!list.length) return null;
    const sec = h('section', null, h('h2', { text: 'Late cancellations (' + list.length + ')' }));
    list.forEach(function (b) {
      const errSlot = h('div', { 'aria-live': 'polite' });
      const paid = b.players.filter(returnable).reduce(function (s, p) { return s + (Number(p.share_amount) || 0); }, 0);
      const credit = h('button', { class: 'btn primary', type: 'button', text: 'Waive as credit' });
      const keep = h('button', { class: 'btn', type: 'button', text: 'Keep charges' });
      async function decide(decision, btn, label) {
        clear(errSlot);
        setBusy(btn, true, label);
        credit.disabled = true; keep.disabled = true;
        try {
          await call('ownerDecideLateCancel', { booking_id: b.booking_id, decision: decision });
          await loadDash();
        } catch (e) {
          errSlot.append(banner(e));
          setBusy(btn, false);
          credit.disabled = false; keep.disabled = false;
        }
      }
      credit.addEventListener('click', function () { decide('credit', credit, 'Waiving…'); });
      keep.addEventListener('click', function () { decide('keep', keep, 'Saving…'); });
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: b.resource_name }), h('p', { class: 'mono', text: fmtRange(b.start, b.end) })), pill('Cancelled')),
        h('p', null, h('strong', { text: fullName(b.booker) }), ' cancelled' + (b.cancelled_at ? ' on ' + fmtDate(b.cancelled_at) : '') + '.' + (paid > 0 ? ' Charges standing: ' + money(paid) + '.' : '')),
        b.late_reason ? h('p', { class: 'late-reason', text: '“' + b.late_reason + '”' }) : h('p', { class: 'hint', text: 'No reason given.' }),
        errSlot, h('div', { class: 'btn-row' }, credit, keep)));
    });
    return sec;
  }

  // Amount owed: members who owe the facility money (their own share, or a share their card could not cover).
  // Mark as paid (cash or another way) or Waive (forgive it); both ask first, like the other panels.
  function owedSection(d) {
    const list = d.owed || [];
    if (!list.length) return null;
    const total = list.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
    const sec = h('section', null, h('h2', { text: 'Amount owed (' + list.length + ') · ' + money(total) }));
    list.forEach(function (o) {
      const panelSlot = h('div');
      const actions = h('div', { class: 'btn-row' });
      const showActions = function () {
        clear(panelSlot); clear(actions);
        actions.append(
          h('button', { class: 'btn primary', type: 'button', text: 'Mark as paid', 'aria-label': 'Mark ' + o.name + ' as paid', onclick: function () { open('paid'); } }),
          h('button', { class: 'btn danger-ghost', type: 'button', text: 'Waive', 'aria-label': 'Waive what ' + o.name + ' owes', onclick: function () { open('waive'); } }));
      };
      function open(how) {
        clear(panelSlot); clear(actions);
        const errSlot = h('div', { 'aria-live': 'polite' });
        const note = h('input', { type: 'text', maxlength: '200', autocomplete: 'off' });
        const go = h('button', { class: 'btn ' + (how === 'paid' ? 'primary' : 'danger'), type: 'button', text: how === 'paid' ? 'Yes, mark as paid' : 'Yes, waive' });
        go.addEventListener('click', async function () {
          clear(errSlot);
          if (how === 'waive' && !note.value.trim()) { errSlot.append(banner('Please type a reason.')); note.focus(); return; }
          setBusy(go, true, 'Saving…');
          try {
            await call('ownerSettleOwed', { member_id: o.member_id, how: how, note: note.value.trim() || undefined });
            await loadDash();
            loadMembers();
          } catch (e) { errSlot.append(banner(e)); setBusy(go, false); }
        });
        panelSlot.append(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': how === 'paid' ? 'Confirm mark as paid' : 'Confirm waive' },
          h('p', { text: (how === 'paid' ? 'Mark ' + money(o.amount) + ' as paid by ' : 'Waive the ' + money(o.amount) + ' that ') + o.name + (how === 'paid' ? '?' : ' owes?') }),
          h('p', { class: 'hint', text: how === 'paid' ? 'Use this when they paid you in cash or another way. No card is charged.' : 'They will no longer owe it and can book again. No card is charged.' }),
          field(how === 'paid' ? 'Note (optional)' : 'Reason (required)', note), errSlot,
          h('div', { class: 'btn-row' }, go, h('button', { class: 'btn', type: 'button', text: 'Back', onclick: showActions }))));
        note.focus();
      }
      showActions();
      sec.append(h('article', { class: 'card booking' },
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: o.name }), h('p', { class: 'hint', text: o.email || '' })),
          h('span', { class: 'pill danger mono', text: money(o.amount) })),
        h('ul', { class: 'players detail' }, (o.items || []).map(function (it) {
          return h('li', null, h('span', { text: it.resource_name + ', ' + it.when }), h('span', { class: 'mono share', text: money(it.amount) }));
        })),
        panelSlot, actions));
    });
    return sec;
  }

  // ---- block time ----
  // One block (several slots or the whole day, with an optional reason), or a repeating one on chosen weekdays.
  async function loadBlock() {
    clear(blockSlot);
    blockSlot.append(h('h2', { text: 'Block time' }));
    let resources;
    try { resources = ctx.state.resources || (ctx.state.resources = await call('resources', {})); }
    catch (e) { blockSlot.append(banner(e)); return; }
    if (ctx.stale()) return;
    const st = (ctx.state.me && ctx.state.me.settings) || {};
    const open = Number(st.open_hour) || 6, close = Number(st.close_hour) || 22;
    const today = todayYmd();

    const resSel = h('select', null, resources.map(function (r) { return h('option', { value: r.resource_id, text: r.name }); }));
    const dayInput = h('input', { type: 'date', min: today, value: today });
    const dayField = field('Day', dayInput);
    const dayLabel = dayField.querySelector('label');
    const timeSel = h('select');
    const lenSel = h('select');
    const timeField = field('Start time', timeSel);
    const lenField = field('How long', lenSel);
    const wholeCb = h('input', { type: 'checkbox', id: 'blk-whole' });
    const wholeRow = h('label', { class: 'check-row', for: 'blk-whole' }, wholeCb, h('span', { text: 'Whole day (' + timeRange('2000-01-01T' + pad(open) + ':00', '2000-01-01T' + pad(close) + ':00', false) + ')' }));
    const reason = h('input', { type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'For example, Maintenance' });
    const repeatCb = h('input', { type: 'checkbox', id: 'blk-repeat' });
    const repeatRow = h('label', { class: 'check-row', for: 'blk-repeat' }, repeatCb, h('span', { text: 'Repeat' }));
    const weekdays = weekdayPicker([dowName(today)]);
    const ends = endPicker(today);
    const repeatBox = h('div', { class: 'repeat-box' }, weekdays.el, ends.el);
    repeatBox.hidden = true;
    const slot = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Block time' });

    function blockHours() {
      const r = resources.filter(function (x) { return x.resource_id === resSel.value; })[0];
      return Number(r && r.block_hours) || Number(st.block_hours) || 2;
    }
    const clock = function (min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); };
    function fillTimes() {
      const keep = timeSel.value;
      clear(timeSel);
      const step = Math.round(blockHours() * 60);
      for (let m = Math.round(open * 60); m + step <= Math.round(close * 60); m += step) {
        timeSel.append(h('option', { value: clock(m), text: timeRange('2000-01-01T' + clock(m), '2000-01-01T' + clock(m + step), true) }));
      }
      if (keep && Array.from(timeSel.options).some(function (o) { return o.value === keep; })) timeSel.value = keep;
      fillLengths();
    }
    function fillLengths() {
      const keep = lenSel.value;
      clear(lenSel);
      const step = Math.round(blockHours() * 60);
      const startMin = Number(timeSel.value.slice(0, 2)) * 60 + Number(timeSel.value.slice(3, 5));
      for (let n = 1; startMin + n * step <= Math.round(close * 60); n++) {
        const hrs = n * step / 60;
        lenSel.append(h('option', { value: String(n), text: n + (n === 1 ? ' slot' : ' slots') + ' (' + hrs + (hrs === 1 ? ' hour)' : ' hours)') }));
      }
      if (keep && Array.from(lenSel.options).some(function (o) { return o.value === keep; })) lenSel.value = keep;
    }
    function sync() {
      const whole = wholeCb.checked, rep = repeatCb.checked;
      timeField.hidden = whole;
      lenField.hidden = whole;
      repeatBox.hidden = !rep;
      dayLabel.textContent = rep ? 'First date' : 'Day';
      btn.textContent = rep ? 'Repeat block' : 'Block time';
      if (rep) ends.setMin(dayInput.value || today);
    }
    resSel.addEventListener('change', fillTimes);
    timeSel.addEventListener('change', fillLengths);
    wholeCb.addEventListener('change', sync);
    repeatCb.addEventListener('change', sync);
    dayInput.addEventListener('change', function () {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayInput.value) && weekdays.value().length <= 1) weekdays.set([dowName(dayInput.value)]);
      sync();
    });
    fillTimes();
    sync();

    btn.addEventListener('click', async function () {
      clear(slot);
      const day = dayInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { slot.append(banner('Please pick a day.')); dayInput.focus(); return; }
      const whole = wholeCb.checked, rep = repeatCb.checked;
      const note = reason.value.trim();
      let call_, req;
      if (rep) {
        const days = weekdays.value();
        if (!days.length) { slot.append(banner('Pick at least one weekday.')); return; }
        if (ends.missing()) { slot.append(banner('Pick the last date, or choose Until I stop it.')); ends.focusDate(); return; }
        req = { kind: 'block', resource_id: resSel.value, weekdays: days, start_date: day, reason: note || undefined };
        if (whole) req.whole_day = true; else { req.start_time = timeSel.value; req.slots = Number(lenSel.value); }
        if (ends.value()) req.end_date = ends.value();
        call_ = 'ownerCreateSeries';
      } else {
        req = { resource_id: resSel.value, note: note || undefined };
        if (whole) { req.whole_day = true; req.date = day; } else { req.start = day + 'T' + timeSel.value; req.slots = Number(lenSel.value); }
        call_ = 'ownerBlockTime';
      }
      setBusy(btn, true, rep ? 'Setting up…' : 'Blocking…');
      try {
        const out = await call(call_, req);
        let msg = 'Time blocked.';
        if (rep) {
          const n = out.created || 0, c = out.clashes || 0;
          msg = 'Repeating block set up. ' + n + (n === 1 ? ' date is' : ' dates are') + ' blocked so far.' +
            (c ? ' ' + c + (c === 1 ? ' date clashes' : ' dates clash') + " with a member's booking; decide in the Clashes list." : '');
        }
        await loadBlock();
        blockSlot.append(banner(msg, 'info'));
        loadDash();
      } catch (e) {
        slot.append(banner(e));
        setBusy(btn, false);
      }
    });
    blockSlot.append(
      field('Court', resSel), dayField, wholeRow, h('div', { class: 'grid2' }, timeField, lenField),
      field('Reason (optional)', reason), repeatRow, repeatBox, slot, btn);
  }

  // ---- members ----
  let filter = '';
  async function loadMembers() {
    clear(membersSlot);
    membersSlot.append(h('h2', { text: 'Members' }));
    const sel = h('select', { id: 'mfilter', onchange: function () { filter = sel.value; loadMembers(); } },
      [['', 'All'], ['Active', 'Active'], ['Pending', 'Pending'], ['Suspended', 'Suspended'], ['Revoked', 'Revoked']]
        .map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === filter }); }));
    membersSlot.append(h('div', { class: 'field' }, h('label', { for: 'mfilter', text: 'Show' }), sel));
    const list = h('div');
    membersSlot.append(list);
    list.append(skeleton(3));
    let rows;
    try { rows = await call('ownerMembers', filter ? { status: filter } : {}); }
    catch (e) { clear(list); list.append(banner(e)); return; }
    if (ctx.stale()) return;
    clear(list);
    if (!rows.length) { list.append(h('p', { class: 'empty', text: 'No members with that status.' })); return; }
    rows.forEach(function (m) { list.append(memberRow(m)); });
  }

  function memberRow(m) {
    const card = h('article', { class: 'card member-row' });
    const errSlot = h('div');
    const actions = h('div', { class: 'btn-row' });
    const roleSlot = h('div');
    function paintRole(mm) {
      clear(roleSlot);
      if (mm.status !== 'Active' || mm.role === 'Owner' || mm.role === 'Guest') return;
      const sel = h('select', null, ['Member', 'Family'].map(function (r) { return h('option', { value: r, text: r, selected: r === mm.role }); }));
      sel.addEventListener('change', function () {
        const next = sel.value;
        if (next === mm.role) return;
        clear(errSlot);
        const yes = h('button', { class: 'btn primary', type: 'button', text: 'Yes, make ' + next.toLowerCase() });
        yes.addEventListener('click', async function () {
          setBusy(yes, true, 'Saving…');
          try {
            const out = await call('ownerSetMemberRole', { member_id: mm.member_id, role: next });
            paint(Object.assign({}, mm, out.member || { role: next }));
          } catch (e) { clear(errSlot); errSlot.append(banner(e)); setBusy(yes, false); }
        });
        const note = next === 'Family'
          ? ' They will book for free with no weekly limit, and their requests need your approval.'
          : ' They will pay normal prices and the weekly limit applies again.';
        clear(roleSlot);
        roleSlot.append(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Confirm role change' },
          h('p', { text: 'Change ' + fullName(mm) + ' to ' + next + '?' + note }),
          h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'No', onclick: function () { paintRole(mm); } }))));
        yes.focus();
      });
      roleSlot.append(field('Role', sel));
    }
    // Unpaid shares the booker had to cover (Strikes tab). Owner and Family play free, so they never get any.
    function strikesLine(mm) {
      const n = Number(mm.strike_count) || 0;
      const owes = Number(mm.amount_owed) || 0;
      return h('p', { class: 'hint' }, h('span', { class: 'pill ' + (n ? 'warn' : 'muted'), text: n + (n === 1 ? ' strike' : ' strikes') }),
        owes > 0 ? ' ' : null, owes > 0 ? h('span', { class: 'pill danger', text: 'Owes ' + money(owes) }) : null);
    }
  function paint(mm) {
      clear(card); clear(actions);
      card.append(
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: fullName(mm) }), h('p', { class: 'hint', text: [mm.email, mm.phone].filter(Boolean).join(' · ') }),
            mm.role === 'Owner' || mm.role === 'Family' ? null : strikesLine(mm)),
          h('div', { class: 'pills' }, rolePill(mm.role), pill(mm.status))),
        roleSlot, errSlot, actions);
      paintRole(mm);
      if (mm.role === 'Owner') return;
      const acts = [];
      if (mm.status === 'Active') acts.push(['Suspend', 'Suspended'], ['Revoke', 'Revoked']);
      else if (mm.status === 'Suspended') acts.push(['Reactivate', 'Active'], ['Revoke', 'Revoked']);
      else if (mm.status === 'Revoked') acts.push(['Reactivate', 'Active']);
      acts.forEach(function (a) {
        actions.append(h('button', { class: 'btn ' + (a[1] === 'Active' ? '' : 'danger-ghost'), type: 'button', text: a[0], onclick: function () { confirm(mm, a); } }));
      });
    }
    function confirm(mm, a) {
      clear(actions); clear(errSlot);
      const yes = h('button', { class: 'btn ' + (a[1] === 'Active' ? 'primary' : 'danger'), type: 'button', text: 'Yes, ' + a[0].toLowerCase() });
      yes.addEventListener('click', async function () {
        setBusy(yes, true, 'Saving…');
        try {
          const out = await call('ownerSetMemberStatus', { member_id: mm.member_id, status: a[1] });
          const merged = Object.assign({}, mm, out.member || {});
          if (filter && merged.status !== filter) { loadMembers(); } else paint(merged);
          loadDash();
        } catch (e) { errSlot.append(banner(e)); setBusy(yes, false); }
      });
      actions.append(h('div', { class: 'confirm' },
        h('p', { text: a[0] + ' ' + fullName(mm) + '?' + (a[1] !== 'Active' ? ' Their upcoming bookings will be cancelled.' : '') }),
        h('div', { class: 'btn-row' }, yes, h('button', { class: 'btn', type: 'button', text: 'No', onclick: function () { paint(mm); } }))));
      yes.focus();
    }
    paint(m);
    return card;
  }

  await Promise.all([loadDash(), loadBlock(), loadMembers()]);
}
