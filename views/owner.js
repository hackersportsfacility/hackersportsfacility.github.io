import { call } from '../api.js';
import { h, clear, fmtRange, fmtDay, fmtDate, timeRange, money, fullName, parseLocal } from '../util.js';
import { banner, skeleton, pill, rolePill, field, setBusy } from '../ui.js';

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
    dashSlot.append(stats(d), pendingBookings(d), pendingMembers(d), awaitingGuardian(d), upcoming(d));
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
    const reject = h('button', { class: 'btn danger-ghost', type: 'button', text: 'Reject' });
    const row = h('div', { class: 'btn-row' }, approve, reject);
    wrap.append(errSlot, row);

    async function send(decision, reason, btn, label) {
      clear(errSlot);
      setBusy(btn, true, label);
      approve.disabled = true; reject.disabled = true;
      try {
        await opts.send(decision, reason);
        await loadDash();
      } catch (e) {
        errSlot.append(banner(e));
        setBusy(btn, false);
        approve.disabled = false; reject.disabled = false;
      }
    }
    approve.addEventListener('click', function () { send('approve', '', approve, 'Approving…'); });
    reject.addEventListener('click', function () {
      clear(row);
      const input = h('input', { type: 'text', maxlength: '200', autocomplete: 'off' });
      const go = h('button', { class: 'btn danger', type: 'button', text: 'Confirm reject' });
      const back = h('button', { class: 'btn', type: 'button', text: 'Back', onclick: function () { clear(row); row.append(approve, reject); } });
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
            h('span', { class: 'pname' }, fullName(p), p.status !== 'Active' ? h('span', { class: 'tag warn', text: p.status === 'Pending' ? 'Guest needs approval' : p.status }) : null),
            h('span', { class: 'mono share', text: p.share_status === 'Waived' ? 'Waived' : money(p.share_amount) }));
        })),
        decisionRow({
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

  function upcoming(d) {
    const sec = h('section', null, h('h2', { text: 'Next 7 days' }));
    if (!d.upcoming.length) { sec.append(h('p', { class: 'empty', text: 'Nothing booked in the next 7 days.' })); return sec; }
    const ul = h('ul', { class: 'agenda' });
    d.upcoming.forEach(function (b) {
      ul.append(h('li', null,
        h('span', { class: 'mono', text: fmtDay(b.start) + ' · ' + timeRange(b.start, b.end, true) }),
        h('span', { text: b.resource_name + ' · ' + fullName(b.booker) })));
    });
    sec.append(ul);
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
    function paint(mm) {
      clear(card); clear(actions);
      card.append(
        h('div', { class: 'bk-head' }, h('div', null, h('h3', { text: fullName(mm) }), h('p', { class: 'hint', text: [mm.email, mm.phone].filter(Boolean).join(' · ') })),
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
