import { call, isMock } from '../api.js';
import { h, add, clear, fmtRange, fmtDay, fmtDate, timeRange, money, fullName, playerName, parseLocal } from '../util.js';
import { banner, skeleton, pill, rolePill, sharePill, invitePill, field, setBusy } from '../ui.js';

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
    add(dashSlot, stats(d), pendingBookings(d), owedSection(d), lateCancellations(d), pendingMembers(d), awaitingGuardian(d), upcoming(d));
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

  function upcoming(d) {
    const sec = h('section', null, h('h2', { text: 'Next 7 days' }));
    if (!d.upcoming.length) { sec.append(h('p', { class: 'empty', text: 'Nothing booked in the next 7 days.' })); return sec; }
    const ul = h('ul', { class: 'agenda' });
    d.upcoming.forEach(function (b) {
      const panelSlot = h('div');
      const actions = h('div', { class: 'btn-row agenda-actions' });
      const li = h('li', null,
        h('span', { class: 'mono', text: fmtDay(b.start) + ' · ' + timeRange(b.start, b.end, true) }),
        h('span', { text: b.resource_name + ' · ' + fullName(b.booker) }),
        panelSlot, actions);
      const showActions = function () {
        clear(panelSlot); clear(actions);
        if (b.status !== 'Approved') return;
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
  async function loadBlock() {
    clear(blockSlot);
    blockSlot.append(h('h2', { text: 'Block time' }));
    let resources, avail;
    try {
      resources = ctx.state.resources || (ctx.state.resources = await call('resources', {}));
      avail = (await call('availability', {})).days;
    } catch (e) { blockSlot.append(banner(e)); return; }
    if (ctx.stale()) return;

    const resSel = h('select', null, resources.map(function (r) { return h('option', { value: r.resource_id, text: r.name }); }));
    const daySel = h('select', null, avail.map(function (d) { return h('option', { value: d.date, text: fmtDay(d.date) }); }));
    const blockSel = h('select');
    const note = h('input', { type: 'text', maxlength: '120', autocomplete: 'off' });
    const slot = h('div');
    const btn = h('button', { class: 'btn primary', type: 'button', text: 'Block time' });

    function fillBlocks() {
      clear(blockSel);
      const day = avail.filter(function (d) { return d.date === daySel.value; })[0];
      const free = day ? day.blocks.filter(function (b) { return b.slots[resSel.value] === 'free'; }) : [];
      free.forEach(function (b) { blockSel.append(h('option', { value: b.start, text: timeRange(b.start, b.end, true) })); });
      if (!free.length) blockSel.append(h('option', { value: '', text: 'No open times' }));
      btn.disabled = !free.length;
    }
    resSel.addEventListener('change', fillBlocks);
    daySel.addEventListener('change', fillBlocks);
    fillBlocks();

    btn.addEventListener('click', async function () {
      clear(slot);
      if (!blockSel.value) return;
      setBusy(btn, true, 'Blocking…');
      try {
        await call('ownerBlockTime', { resource_id: resSel.value, start: blockSel.value, note: note.value.trim() || undefined });
        await loadBlock();
        blockSlot.append(banner('Time blocked.', 'info'));
        loadDash();
      } catch (e) {
        slot.append(banner(e));
        setBusy(btn, false);
      }
    });
    blockSlot.append(
      h('div', { class: 'grid2' }, field('Court', resSel), field('Day', daySel)),
      field('Time', blockSel), field('Note (optional)', note), slot, btn);
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
