// In-memory fake of the booking engine (docs/phase1-api-contract.md). Demo mode only.
// Sign in with any email (alex@example.com = member (slot limit 1), priya@example.com = member (slot limit 3), jordan@example.com = family, anything else = owner). Code: 123456.
import { pad, ymdOf, hoursUntil, todayYmd, addDays, nowLocal, mondayOf, parseLocal, dowName, dowOf, monthName, dayNum, timeRange, fmtRange } from './util.js';

const FACILITY = 'Hacker Sports Facility';
const SETTINGS = { open_hour: 6, close_hour: 22, block_hours: 2, max_players_per_court: 4, free_cancel_hours: 24 };
const WEEKLY_LIMIT = 3;
const BOOK_AHEAD = 7;
const MAX_SLOTS_PER_REQUEST = 1;

const RESOURCES = [
  { resource_id: 'COURT1', name: 'Court 1', block_hours: 2, rate_per_hour: 20, courts: 1, visible_to: '', max_hours: null },
  { resource_id: 'COURT2', name: 'Court 2', block_hours: 2, rate_per_hour: 20, courts: 1, visible_to: '', max_hours: null },
  { resource_id: 'BOTH', name: 'Both Courts', block_hours: 2, rate_per_hour: 40, courts: 2, visible_to: '', max_hours: null },
  { resource_id: 'GOLF', name: 'Golf Simulator', block_hours: 2, rate_per_hour: 0, courts: 1, visible_to: 'Owner,Family', max_hours: 4 },
];

const now0 = nowLocal();
let seqM = 8, seqB = 0, seqS = 0;

function member(id, first, last, email, role, status, extra) {
  return Object.assign({
    member_id: id, status: status, role: role, first_name: first, last_name: last, email: email,
    phone: '555-010' + id.slice(-1), emergency_contact_name: 'Pat ' + last, emergency_contact_phone: '555-0199',
    is_minor: false, date_of_birth: '', guardian_name: '', guardian_email: '', invited_by_member_id: '',
    weekly_limit_override: '', book_ahead_override: '', max_slots_override: '', auto_approve: false, credit_balance: 0, strike_count: 0,
    waiver_version_signed: id === 'M0003' ? 0 : 1,
    // Alex (M0002) starts without accepting the Booking Terms, to demo the scroll-and-accept flow.
    booking_terms_version: id === 'M0002' ? 0 : 1, booking_terms_accepted_at: id === 'M0002' ? '' : addDays(todayYmd(), -29) + 'T09:05',
    created_at: addDays(todayYmd(), -30) + 'T09:00',
    approved_at: addDays(todayYmd(), -29) + 'T09:00', notes: '',
    card: null, // Phase 2B: { brand, last4, exp } when a card is saved
  }, extra || {});
}

const members = [
  member('M0001', 'Ryan', 'Hacker', 'ryan@example.com', 'Owner', 'Active'),
  member('M0002', 'Alex', 'Smith', 'alex@example.com', 'Member', 'Active', { card: { brand: 'visa', last4: '4242', exp: '12/30' } }),
  member('M0003', 'Jamie', 'Lee', 'jamie@example.com', 'Member', 'Active'),
  member('M0004', 'Priya', 'Patel', 'priya@example.com', 'Member', 'Active', { max_slots_override: 3 }),
  member('M0005', 'Sam', 'Rivera', 'sam@example.com', 'Guest', 'Pending', { invited_by_member_id: 'M0002', approved_at: '' }),
  member('M0006', 'Chris', 'Wong', 'chris@example.com', 'Member', 'Suspended'),
  member('M0007', 'Jordan', 'Hacker', 'jordan@example.com', 'Family', 'Active'),
  // Placeholder for an emailed invitee who is not a member yet (status Invited: cannot sign in).
  member('M0008', '', '', 'taylor@example.com', 'Guest', 'Invited', { invited_by_member_id: 'M0002', approved_at: '', phone: '', emergency_contact_name: '', emergency_contact_phone: '' }),
];

const bookings = [];
// Phase 2C-2: invites { invite_id, email, member_id, booker, booking_ids, share_ids, status, resent_count, sent_at (ms) }
const invites = [];
let seqI = 0;
const inviteById = function (id) { return invites.filter(function (i) { return i.invite_id === id; })[0]; };
const inviteOfPlayer = function (p) { return p.invite_id ? inviteById(p.invite_id) : null; };
const isAccepted = function (p) { const i = inviteOfPlayer(p); return !i || i.status === 'Accepted'; };
function maskEmail(e) {
  const m = /^([^@]+)@(.+)$/.exec(String(e || '').trim());
  return m ? m[1].charAt(0) + '***@' + m[2] : '***';
}
const played = { M0001: ['M0002'], M0002: ['M0001', 'M0003', 'M0004'] };

function endOf(start) {
  const p = parseLocal(start);
  return start.slice(0, 11) + pad(p.h + SETTINGS.block_hours) + ':00';
}
function dayAt(offset, hour) { return addDays(todayYmd(), offset) + 'T' + pad(hour) + ':00'; }
function resById(id) { return RESOURCES.filter(function (r) { return r.resource_id === id; })[0]; }
function memById(id) { return members.filter(function (m) { return m.member_id === id; })[0]; }
function memByEmail(e) {
  e = String(e || '').trim().toLowerCase();
  return members.filter(function (m) { return m.email.toLowerCase() === e; })[0];
}

function splitShares(total, n) {
  const cents = Math.round(total * 100), base = Math.floor(cents / n), rem = cents % n, out = [];
  for (let i = 0; i < n; i++) out.push((base + (i < rem ? 1 : 0)) / 100);
  return out;
}

function isPriv(m) { return !!m && (m.role === 'Owner' || m.role === 'Family'); }

function addBooking(o) {
  const res = resById(o.resource_id);
  const priv = isPriv(memById(o.booker));
  const total = priv ? 0 : res.rate_per_hour * hrsOf({ start: o.start, end: o.end || endOf(o.start) });
  const ids = [o.booker].concat(o.guests || []);
  const shares = o.pay_mode === 'BookerPays' ? [total] : splitShares(total, ids.length);
  seqB++;
  const b = {
    booking_id: 'B' + ('00000' + seqB).slice(-5), status: o.status, resource_id: o.resource_id,
    start: o.start, end: o.end || endOf(o.start), pay_mode: o.pay_mode || 'Split', total_amount: total,
    booker: o.booker, notes: o.notes || '', cancelled_at: '',
    players: ids.map(function (id, i) {
      seqS++;
      const sid = 'S' + ('00000' + seqS).slice(-5);
      if (priv) return { share_id: sid, member_id: id, share_amount: 0, share_status: 'Waived', credit_applied: 0 };
      return { share_id: sid, member_id: id, share_amount: shares[i] == null ? 0 : shares[i], share_status: shares[i] == null ? '' : 'Pending', credit_applied: 0 };
    }),
    created_at: o.created_at || now0,
  };
  bookings.push(b);
  return b;
}

// ---- seed data, relative to today ----
addBooking({ resource_id: 'COURT2', start: dayAt(1, 18), status: 'Approved', booker: 'M0002', guests: ['M0001', 'M0003'] });
addBooking({ resource_id: 'COURT1', start: dayAt(3, 10), status: 'Pending', booker: 'M0002', guests: ['M0003', 'M0005', 'M0008'] });
addBooking({ resource_id: 'COURT1', start: dayAt(4, 12), status: 'Approved', booker: 'M0001', guests: ['M0002'] });
addBooking({ resource_id: 'COURT1', start: dayAt(0, 20), status: 'Approved', booker: 'M0004', guests: ['M0003'] });
addBooking({ resource_id: 'COURT1', start: dayAt(1, 8), status: 'Approved', booker: 'M0004', guests: [] });
addBooking({ resource_id: 'BOTH', start: dayAt(2, 14), status: 'Approved', booker: 'M0004', guests: ['M0003', 'M0001'] });
addBooking({ resource_id: 'COURT2', start: dayAt(5, 16), status: 'Approved', booker: 'M0003', guests: ['M0004'] });
addBooking({ resource_id: 'COURT1', start: dayAt(-2, 10), status: 'Completed', booker: 'M0002', guests: ['M0001', 'M0004'] });
addBooking({ resource_id: 'COURT2', start: dayAt(-5, 16), status: 'Completed', booker: 'M0002', guests: ['M0003'] });
addBooking({ resource_id: 'COURT2', start: dayAt(-3, 8), status: 'Cancelled', booker: 'M0002', guests: ['M0003'], notes: 'LATE_CANCEL' });
addBooking({ resource_id: 'BOTH', start: dayAt(-4, 18), status: 'Completed', booker: 'M0001', guests: ['M0002', 'M0003', 'M0004'] });
// Golf Simulator (Owner and Family only)
addBooking({ resource_id: 'GOLF', start: dayAt(1, 10), status: 'Approved', booker: 'M0001', guests: [], pay_mode: 'BookerPays' });
addBooking({ resource_id: 'GOLF', start: dayAt(1, 18), status: 'Approved', booker: 'M0007', guests: [], pay_mode: 'BookerPays' });
addBooking({ resource_id: 'GOLF', start: dayAt(2, 14), end: dayAt(2, 18), status: 'Approved', booker: 'M0001', guests: ['M0007'], pay_mode: 'BookerPays' });
addBooking({ resource_id: 'GOLF', start: dayAt(3, 8), status: 'Pending', booker: 'M0007', guests: [], pay_mode: 'BookerPays' });
// Demo payment states (Phase 2B), so Pay now and every pill can be seen.
function setShare(bi, memberId, status) {
  const p = bookings[bi].players.filter(function (x) { return x.member_id === memberId; })[0];
  if (p && p.share_status !== 'Waived') p.share_status = status;
}
bookings.forEach(function (b, i) {
  if (b.status === 'Completed') b.players.forEach(function (p) { if (p.share_status !== 'Waived') p.share_status = 'Paid'; });
});
setShare(0, 'M0002', 'Unpaid');           // Alex's share on his own Approved booking: Pay now
setShare(0, 'M0003', 'Unpaid');
setShare(5, 'M0003', 'CoveredByBooker');  // Priya's booking: Jamie was covered
setShare(6, 'M0003', 'Paid');             // Jamie's booking: Priya's share still Pending
// Late-cancelled booking waiting for the owner's decision (Phase 2C-1): both players had paid.
setShare(9, 'M0002', 'Paid');
setShare(9, 'M0003', 'Paid');
bookings[9].cancelled_at = dayAt(-3, 7);
bookings[9].late_reason = 'My son came down with the flu and we could not make it.';
bookings[9].late_decision = '';
// Amount owed: Priya's own share of a finished booking was never paid, so she owes it (Pay now on Account and Book).
// Her first Pay now is declined (demo) so Replace card can be tried; a replaced card then works.
const owedBk = addBooking({ resource_id: 'COURT2', start: dayAt(-6, 10), status: 'Completed', booker: 'M0004', guests: ['M0003'] });
owedBk.players[0].share_status = 'Owed';
owedBk.players[0].owed_by = 'M0004';
owedBk.players[1].share_status = 'Paid';
memById('M0004').card = { brand: 'visa', last4: '0002', exp: '12/30' };
memById('M0004').declineNext = true;

// ---- credits (Phase 2C-1): lots with an expiry; used first-in-first-out by earliest expiry ----
const credits = [{ member_id: 'M0002', remaining: 10, expires_at: addDays(todayYmd(), 20), reason: 'owner cancellation' }];
const cents = function (x) { return Math.round((Number(x) || 0) * 100) / 100; };
function lotsOf(id) {
  const t = todayYmd();
  return credits.filter(function (c) { return c.member_id === id && c.remaining > 0 && c.expires_at >= t; })
    .sort(function (a, b) { return a.expires_at < b.expires_at ? -1 : a.expires_at > b.expires_at ? 1 : 0; });
}
function balanceOf(id) { return cents(lotsOf(id).reduce(function (s, c) { return s + c.remaining; }, 0)); }
function addCredit(id, amount, reason) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  credits.push({ member_id: id, remaining: cents(amount), expires_at: ymdOf(d), reason: reason });
}
function useCredit(id, amount) {
  let left = cents(amount), used = 0;
  lotsOf(id).forEach(function (c) {
    if (left <= 0) return;
    const take = Math.min(c.remaining, left);
    c.remaining = cents(c.remaining - take);
    left = cents(left - take);
    used = cents(used + take);
  });
  return used;
}

// ---- helpers ----
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }
function ok(data) { return { ok: true, data: data }; }
const active = function (b) { return b.status === 'Pending' || b.status === 'Approved'; };
// BOTH conflicts with each court; the golf simulator conflicts with nothing else.
const conflicts = function (a, b) { return a === b || (a !== 'GOLF' && b !== 'GOLF' && (a === 'BOTH' || b === 'BOTH')); };
const visibleTo = function (res, v) {
  const list = String(res.visible_to || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return !list.length || list.indexOf(v.role) !== -1;
};
const overlaps = function (a, b) { return a.start < b.end && a.end > b.start; };
const summary = function (m) {
  return { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, email: m.email, role: m.role, status: m.status, is_owner: m.role === 'Owner' };
};

function viewer(token) {
  const m = /^mock-(M\d{4})$/.exec(token || '');
  const mem = m && memById(m[1]);
  return mem && mem.status === 'Active' ? mem : null;
}

// Demo badge cycles Owner -> Member -> Family -> Owner.
export function switchUser(token) {
  if (token === 'mock-M0001') return 'mock-M0002';
  if (token === 'mock-M0002') return 'mock-M0007';
  return 'mock-M0001';
}

function inviteStatusOf(inv) {
  if (!inv) return '';
  if (inv.status === 'Accepted') return 'accepted';
  if (inv.status === 'Declined' || inv.status === 'Removed') return 'declined';
  if (inv.status === 'Expired') return 'no_response';
  return 'invited';
}

function detail(b, v, withContact) {
  const bk = memById(b.booker);
  const owner = v && v.role === 'Owner';
  const out = {
    booking_id: b.booking_id, status: b.status, resource_id: b.resource_id,
    resource_name: resById(b.resource_id).name, start: b.start, end: b.end, pay_mode: b.pay_mode,
    total_amount: b.total_amount, is_booker: !!v && b.booker === v.member_id,
    booker: { first_name: bk.first_name, last_name: bk.last_name },
    players: b.players.filter(function (p) {
      const inv = inviteOfPlayer(p);
      if (!inv || owner) return true;
      if (inv.status === 'Removed') return false;
      return inv.status !== 'Declined' || b.booker === (v && v.member_id); // declined invitees are shown to the booker only
    }).map(function (p) {
      const m = memById(p.member_id);
      const inv = inviteOfPlayer(p);
      const isBooker = !!v && b.booker === v.member_id;
      const o = { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, status: m.status, share_amount: p.share_amount, share_status: p.share_status, credit_applied: p.credit_applied || 0, invite_status: inviteStatusOf(inv) };
      if (inv && inv.status !== 'Accepted' && !owner) { // masked until they accept: no name, id or phone
        delete o.member_id;
        o.first_name = maskEmail(inv.email);
        o.last_name = '';
        o.name = maskEmail(inv.email);
        o.status = '';
      }
      if (owner && inv) { o.email = inv.email; o.name = (m.first_name + ' ' + m.last_name).trim() || inv.email; }
      if (isBooker && inv) { o.invite_id = inv.invite_id; o.share_id = p.share_id; }
      if (v && p.member_id === v.member_id) { // only the viewer's own share exposes its id
        o.share_id = p.share_id;
        o.can_pay = p.share_status === 'Unpaid' && p.share_amount > 0 && b.status === 'Approved' && isAccepted(p); // only after a failed automatic charge
      }
      return o;
    }),
    late_cancel: /LATE_CANCEL/.test(b.notes),
    can_cancel: !isBlock(b) && active(b) && b.start > nowLocal() && !!v && (b.booker === v.member_id || !!owner),
  };
  if (isBlock(b)) {
    out.is_block = true;
    if (owner) { out.block_reason = blockReason(b); out.can_remove_block = active(b) && b.end > nowLocal(); }
  }
  if (owner && seriesOf(b)) out.series_id = seriesOf(b);
  if (owner) { out.late_reason = b.late_reason || ''; out.cancelled_at = b.cancelled_at || ''; }
  if (withContact) { out.booker.email = bk.email; out.booker.phone = bk.phone; out.booker_email = bk.email; out.booker_phone = bk.phone; }
  return out;
}

function weekCount(memberId, ymd) {
  const ws = mondayOf(ymd), we = addDays(ws, 6);
  return bookings.filter(function (b) {
    const d = b.start.slice(0, 10);
    return b.booker === memberId && (b.status === 'Pending' || b.status === 'Approved' || b.status === 'Completed') && d >= ws && d <= we;
  }).reduce(function (sum, b) { return sum + slotsOf(b); }, 0);
}

// Slots in a stretch of time on a resource: one block of the resource's block_hours is one slot (minimum 1).
function slotsOf(s) {
  const res = resById(s.resource_id);
  return Math.max(1, Math.round(hrsOf(s) / ((res && res.block_hours) || SETTINGS.block_hours)));
}

// Most time slots one booking request may hold: null = unlimited (Owner and Family). Matches Bk.maxSlotsFor.
function maxSlotsFor(m) {
  if (isPriv(m)) return null;
  const o = Number(m.max_slots_override);
  return o > 0 ? o : Math.max(1, MAX_SLOTS_PER_REQUEST);
}

function isOnGrid(start) {
  const p = parseLocal(start);
  return p.mi === 0 && p.h >= SETTINGS.open_hour && p.h + SETTINGS.block_hours <= SETTINGS.close_hour && (p.h - SETTINGS.open_hour) % SETTINGS.block_hours === 0;
}

function delay(v) {
  return new Promise(function (r) { setTimeout(function () { r(v); }, 220); });
}

// ---- action handler ----
export async function handle(req) {
  return delay(run(req));
}

function run(req) {
  const a = req.action;
  try {
    if (a === 'ping') return ok({ facility_name: FACILITY, server_time: nowLocal() });
    if (a === 'requestMembership') return requestMembership(req);
    if (a === 'requestCode') return requestCode(req);
    if (a === 'verifyCode') return verifyCode(req);
    if (a === 'linkInfo') return linkInfo(req);
    if (a === 'linkConfirm') return linkConfirm(req);

    const v = viewer(req.token);
    if (!v) return err('UNAUTHORIZED', 'Please sign in again.');
    switch (a) {
      case 'me': return me(v);
      case 'resources': return ok(visibleResources(v));
      case 'availability': return availability(req, v);
      case 'startup': return startup(req, v);
      case 'createBooking': return createBooking(req, v);
      case 'createBookings': return createBookings(req, v);
      case 'myBookings': return myBookings(req, v);
      case 'cancelBooking': return cancelBooking(req, v);
      case 'knownPlayers': return knownPlayers(v);
      case 'removeInvite': return removeInvite(req, v);
      case 'resendInvite': return resendInvite(req, v);
      case 'acceptTerms': return acceptTerms(req, v);
      case 'startCardSetup': return startCardSetup(req, v);
      case 'confirmCardSetup': return confirmCardSetup(req, v);
      case 'removeCard': return removeCard(req, v);
      case 'payShare': return payShare(req, v);
      case 'payOwed': return payOwed(req, v);
      case 'confirmPayment': return confirmPayment(req, v);
      case 'waiverText': return ok(WAIVER_TEXT);
      case 'signWaiver': return signWaiver(req, v);
      case 'resendGuardianEmail': return resendGuardianEmail(v);
      case 'mockGuardianSign': return mockGuardianSign(v);
      case 'signOut': return ok({ signed_out: true });
    }
    if (a.indexOf('owner') === 0) {
      if (v.role !== 'Owner') return err('FORBIDDEN', 'Only the owner can do that.');
      return ownerAction(a, req, v);
    }
    return err('BAD_REQUEST', 'Unknown action: ' + a);
  } catch (e) {
    return err('SERVER', 'Something went wrong in the demo. ' + (e && e.message));
  }
}

// ---- email links (Release 2.2): sample tokens for #/go ----
// Booking and member links act on the first Pending booking / member in the demo data; guardian links only track a flag.
export const DEMO_LINKS = [
  ['demo-booking-approve', 'Booking request: approve'],
  ['demo-booking-approve_waive', 'Booking request: approve and waive fees'],
  ['demo-booking-reject', 'Booking request: reject'],
  ['demo-latecancel-credit', 'Late cancellation: waive as credit'],
  ['demo-latecancel-keep', 'Late cancellation: keep the charges'],
  ['demo-clash-bump', 'Repeating block clash: bump the booking'],
  ['demo-clash-skip', 'Repeating block clash: skip this date'],
  ['demo-member-approve', 'New member: approve'],
  ['demo-member-reject', 'New member: reject'],
  ['demo-guardian-sign', 'Parent or guardian: sign'],
  ['demo-invite-I00001', 'Invitation: new person (sign-up form)'],
  ['demo-invite-I00002', 'Invitation: existing member'],
  ['demo-expired', 'Expired link'],
  ['demo-bogus', 'Invalid link'],
];
const linkDone = {};
function linkParts(t) {
  const m = /^demo-(booking|member|guardian|latecancel|clash)-(approve_waive|approve|reject|sign|credit|keep|bump|skip)$/.exec(String(t || ''));
  return m ? { kind: m[1], d: m[2] } : null;
}
function linkInfo(r) {
  const t = String(r.t || '');
  if (/^demo-invite-/.test(t)) return inviteInfo(t);
  if (t === 'demo-expired') return ok({ kind: 'booking', d: 'approve', state: 'expired', summary: 'This link has expired. Ask for a new email and try again.', details: [] });
  const p = linkParts(t);
  if (!p) return ok({ kind: '', d: '', state: 'invalid', summary: 'This link is not valid. Please use the link from your most recent email.', details: [] });
  const base = { kind: p.kind, d: p.d };
  if (p.kind === 'booking') {
    const b = bookings.filter(function (x) { return x.status === 'Pending'; })[0];
    if (linkDone[t] || !b) return ok(Object.assign(base, { state: 'already', summary: 'This booking request was already decided. Nothing more is needed.', details: [] }));
    const bk = memById(b.booker);
    const day = b.start.slice(0, 10);
    return ok(Object.assign(base, {
      state: 'ready',
      summary: (p.d === 'reject' ? 'Reject ' : p.d === 'approve_waive' ? 'Approve and waive fees for ' : 'Approve ') + resById(b.resource_id).name + ', ' + dowName(day) + ' ' + monthName(day) + ' ' + dayNum(day) + ', ' + timeRange(b.start, b.end, true) + ' for ' + bk.first_name + ' ' + bk.last_name + '?',
      details: [
        { label: 'Players', value: b.players.map(function (x) { const m = memById(x.member_id); return m.first_name + ' ' + m.last_name; }).join(', ') },
        { label: 'Price', value: '$' + b.total_amount.toFixed(2) },
      ],
    }));
  }
  if (p.kind === 'clash') {
    const c = CLASHES.filter(function (x) { return x.status === 'Open'; })[0];
    if (linkDone[t] || !c) return ok(Object.assign(base, { state: 'already', summary: 'This clash was already decided. Nothing was changed.', details: [] }));
    const o = clashOut(c), day = o.date;
    const when = dowName(day) + ' ' + monthName(day) + ' ' + dayNum(day) + ', ' + timeRange(o.start, o.end, true);
    const who = o.bookings.map(function (b) { return b.booker_name + ' (' + b.status + ')'; }).join(', ');
    return ok(Object.assign(base, {
      state: 'ready',
      button: p.d === 'bump' ? 'Bump this booking' : 'Skip this date',
      note: p.d === 'bump' ? "Cancels the member's booking for free. Anything they paid comes back as for any cancellation by the facility, and the players are emailed. Then your repeating entry takes the court." : "The member's booking stays as it is and this date is left out of your repeating entry.",
      summary: (p.d === 'bump' ? 'Bump ' + (o.bookings[0] ? o.bookings[0].booker_name + "'s booking" : 'the booking') : 'Skip this date for the repeating ' + o.kind) + ' (' + o.resource_name + ', ' + when + ')?',
      details: [['Repeating', o.kind === 'block' ? 'Block' + (o.reason ? ': ' + o.reason : '') : 'Your booking'], ['Court', o.resource_name], ['When', when], ['Booked by', who]],
    }));
  }
  if (p.kind === 'latecancel') {
    const b = lateWaiting()[0];
    if (linkDone[t] || !b) return ok(Object.assign(base, { state: 'already', summary: 'This late cancellation was already decided. Nothing more is needed.', details: [] }));
    const bk = memById(b.booker), day = b.start.slice(0, 10);
    const paid = b.players.filter(paidShare).reduce(function (s, x) { return s + x.share_amount; }, 0);
    return ok(Object.assign(base, {
      state: 'ready',
      summary: (p.d === 'credit' ? 'Waive as credit: ' : 'Keep the charges: ') + resById(b.resource_id).name + ', ' + dowName(day) + ' ' + monthName(day) + ' ' + dayNum(day) + ', ' + timeRange(b.start, b.end, true) + ', cancelled by ' + bk.first_name + ' ' + bk.last_name + '?',
      details: [{ label: 'Reason', value: b.late_reason || 'None given' }, { label: 'Charges standing', value: '$' + paid.toFixed(2) }],
    }));
  }
  if (p.kind === 'member') {
    const m = members.filter(function (x) { return x.status === 'Pending'; })[0];
    if (linkDone[t] || !m) return ok(Object.assign(base, { state: 'already', summary: 'This membership request was already decided. Nothing more is needed.', details: [] }));
    return ok(Object.assign(base, {
      state: 'ready', summary: (p.d === 'reject' ? 'Reject' : 'Approve') + ' membership for ' + m.first_name + ' ' + m.last_name + '?',
      details: [{ label: 'Name', value: m.first_name + ' ' + m.last_name }, { label: 'Email', value: m.email }],
    }));
  }
  if (linkDone[t]) return ok(Object.assign(base, { state: 'already', summary: 'This agreement was already signed. Thank you.', details: [] }));
  return ok(Object.assign(base, {
    state: 'ready', summary: 'Parent or guardian signature for Riley Smith',
    details: [{ label: 'Participant', value: 'Riley Smith' }, { label: 'Date of birth', value: '06/14/2012' }, { label: 'Requested by', value: 'Alex Smith' }],
    agreement: WAIVER_TEXT,
  }));
}
function linkConfirm(r) {
  const t = String(r.t || '');
  if (/^demo-invite-/.test(t)) return inviteConfirm(r, t);
  const info = linkInfo({ t: t }).data;
  if (info.state === 'invalid' || info.state === 'expired') return err('BAD_REQUEST', info.summary);
  if (info.state === 'already') return ok({ ok: true, message: info.summary, final: true });
  if (info.kind === 'guardian') {
    if (!String(r.name || '').trim()) return err('BAD_REQUEST', 'Please type your full legal name to sign.');
    linkDone[t] = true;
    return ok({ ok: true, message: "Thank you. The agreement is signed and Riley's waiver is on file.", final: true });
  }
  linkDone[t] = true;
  const approve = info.d === 'approve' || info.d === 'approve_waive';
  if (info.kind === 'clash') {
    const c = CLASHES.filter(function (x) { return x.status === 'Open'; })[0];
    const e = decideClashImpl(c, info.d, memById('M0001'));
    if (e) return e;
    return ok({ ok: true, message: info.d === 'bump' ? 'Done. The booking was cancelled and the players have been emailed. Your repeating entry has the court.' : "Done. This date is skipped and the member's booking stays.", final: true });
  }
  if (info.kind === 'latecancel') {
    const lb = lateWaiting()[0];
    const e = decideLate(lb, info.d);
    if (e) return e;
    return ok({ ok: true, message: info.d === 'credit' ? 'Done. The payments were returned to the players as facility credit.' : 'Done. The charges stand.', final: true });
  }
  if (info.kind === 'booking') {
    const b = bookings.filter(function (x) { return x.status === 'Pending'; })[0];
    b.status = approve ? 'Approved' : 'Rejected';
    if (info.d === 'approve_waive') waiveShares(b, null, 'credit');
    return ok({ ok: true, message: info.d === 'approve_waive' ? 'Approved with fees waived. The booker has been emailed.' : approve ? 'Approved. The booker has been emailed.' : 'Rejected. The booker has been emailed.', final: true });
  }
  const m = members.filter(function (x) { return x.status === 'Pending'; })[0];
  m.status = approve ? 'Active' : 'Rejected';
  return ok({ ok: true, message: approve ? 'Approved. ' + m.first_name + ' can now sign in.' : 'Rejected. ' + m.first_name + ' has been notified.', final: true });
}

function requestMembership(r) {
  const need = ['first_name', 'last_name', 'email', 'phone', 'emergency_contact_name', 'emergency_contact_phone'];
  for (let i = 0; i < need.length; i++) {
    if (!String(r[need[i]] || '').trim()) return err('BAD_REQUEST', 'Please fill in every field.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return err('BAD_REQUEST', 'That email address does not look right.');
  if (memByEmail(r.email)) return err('BAD_REQUEST', 'That email is already registered. Try signing in.');
  seqM++;
  members.push(member('M' + ('0000' + seqM).slice(-4), r.first_name.trim(), r.last_name.trim(), r.email.trim(), 'Member', 'Pending', {
    phone: r.phone, emergency_contact_name: r.emergency_contact_name, emergency_contact_phone: r.emergency_contact_phone,
    created_at: nowLocal(), approved_at: '',
  }));
  return ok({ submitted: true });
}

function requestCode(r) {
  if (!r.email) return err('BAD_REQUEST', 'Enter your email address.');
  const m = memByEmail(r.email);
  if (!m || m.status === 'Invited' || m.status === 'Merged') return ok({ sent: true });
  if (m.status === 'Pending') return err('FORBIDDEN', 'Your membership is waiting for approval.');
  if (m.status !== 'Active') return err('FORBIDDEN', 'Your membership is not active. Contact the facility.');
  return ok({ sent: true });
}

function verifyCode(r) {
  // Demo: any unknown email signs in as the owner (the sign-in hint promises "any email works").
  const m = memByEmail(r.email) || memByEmail('ryan@example.com');
  if (!m || m.status !== 'Active') return err('UNAUTHORIZED', 'That code did not match. Try again.');
  if (String(r.code) !== '123456') return err('UNAUTHORIZED', 'That code did not match. (Demo code: 123456)');
  return ok({ token: 'mock-' + m.member_id, member: summary(m) });
}

const TERMS_VERSION = 1;
// terms.html is a separate page, so a demo acceptance is kept for the browser session.
const TERMS_KEY = 'hsf_mock_terms_';
function termsStatus(v) {
  try {
    const saved = sessionStorage.getItem(TERMS_KEY + v.member_id);
    if (saved && !v.booking_terms_version) { v.booking_terms_version = TERMS_VERSION; v.booking_terms_accepted_at = saved; }
  } catch (e) { /* storage unavailable */ }
  return {
    version: TERMS_VERSION,
    accepted: isPriv(v) || v.booking_terms_version >= TERMS_VERSION,
    accepted_version: v.booking_terms_version || 0,
    accepted_at: v.booking_terms_accepted_at || '',
  };
}
function acceptTerms(r, v) {
  if (Number(r.version) !== TERMS_VERSION) return err('BAD_REQUEST', 'These terms have been updated. Please reload the page and read the latest version.');
  v.booking_terms_version = TERMS_VERSION;
  v.booking_terms_accepted_at = nowLocal();
  try { sessionStorage.setItem(TERMS_KEY + v.member_id, v.booking_terms_accepted_at); } catch (e) { /* storage unavailable */ }
  return ok({ terms: termsStatus(v) });
}

// ---- waiver (Phase 2A) ----
const WAIVER_VERSION = 1;
const WAIVER_TEXT = {
  version: WAIVER_VERSION,
  effective: 'October 20, 2026',
  title: 'HACKER SPORTS FACILITY',
  subtitle: 'DEMO TEXT ONLY. Participant Agreement, Assumption of Risk, Release and Waiver of Liability, Indemnity, and Arbitration Agreement',
  intro: 'DEMO TEXT: THIS IS SAMPLE WORDING FOR THE DEMO AND IS NOT THE REAL AGREEMENT. PLEASE READ CAREFULLY BEFORE SIGNING. THE REAL AGREEMENT INCLUDES A RELEASE OF LIABILITY, BINDING ARBITRATION AND A JURY TRIAL WAIVER.',
  sections: [
    { heading: '1. Demo: Parties and Definitions', body: 'This is demo text. In the real app this section defines the Facility, the Owner and the Released Parties.\n\n• "Facility" means Hacker Sports Facility.\n• "Owner" means 3450 Centennial Rd LLC.\n• "Activities" means any use of the Facility.' },
    { heading: '2. Demo: Assumption of Risk', body: 'Sample paragraph. Playing sports involves risk of injury. This demo section is long enough to scroll so you can try the scroll-to-end step.\n\nSecond sample paragraph. I understand that no staff are present and that I am responsible for my own safety.\n\n• Slips, trips and falls\n• Collisions with people or equipment\n• Being struck by balls or paddles\n• Heat-related illness and other medical events' },
    { heading: '3. Demo: Release of Liability', body: 'Sample release language. In the real agreement, the participant releases the Released Parties from claims, including claims arising from their negligence, to the fullest extent permitted by Ohio law.\n\nSample paragraph about arbitration and the jury trial waiver.' },
    { heading: '4. Demo: Minors', body: 'If the Participant is under 18, a parent or legal guardian must sign this Agreement. By signing, the parent or guardian agrees on behalf of the minor and on their own behalf.' },
    { heading: '5. Demo: Electronic Signature', body: 'Typing my name and selecting "I agree" is my legal signature. A copy will be emailed to me.' },
  ],
};
const waivers = [];
let seqW = 0;
const RESEND_MIN_MS = 10 * 60 * 1000;

function awaitingRow(v) {
  return waivers.filter(function (w) { return w.member_id === v.member_id && w.status === 'AwaitingGuardian'; })[0];
}
function waiverStatus(v) {
  if (v.waiver_version_signed >= WAIVER_VERSION) return { status: 'signed', version: WAIVER_VERSION };
  const w = awaitingRow(v);
  if (w) return { status: 'awaiting_guardian', guardian_email: w.guardian_email, version: WAIVER_VERSION };
  return { status: 'none', version: WAIVER_VERSION };
}
function plusDays(n) { return addDays(todayYmd(), n) + 'T' + nowLocal().slice(11); }

// Same rules as the engine's Waivers.parseDob: MM/DD/YYYY, a real date.
function parseDobMock(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || ''));
  if (!m) return null;
  const mo = +m[1], d = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
  if (y < 1900 || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y: y, mo: mo, d: d };
}

function signWaiver(r, v) {
  const need = ['participant_name', 'date_of_birth', 'phone', 'emergency_contact_name', 'emergency_contact_phone', 'signature'];
  for (let i = 0; i < need.length; i++) if (!String(r[need[i]] || '').trim()) return err('BAD_REQUEST', 'Please fill in every field.');
  if (Number(r.version) !== WAIVER_VERSION) return err('BAD_REQUEST', 'The agreement was updated. Please reload and read the latest version.');
  if (r.agreed !== true) return err('BAD_REQUEST', 'Please check the box to agree to the Participant Agreement.');
  const dob = parseDobMock(r.date_of_birth);
  const t = parseLocal(todayYmd());
  if (!dob) return err('BAD_REQUEST', 'Enter the date of birth as MM/DD/YYYY.');
  if (dob.y * 10000 + dob.mo * 100 + dob.d > t.y * 10000 + t.mo * 100 + t.d) return err('BAD_REQUEST', 'The date of birth cannot be in the future.');
  let age = t.y - dob.y;
  if (t.mo < dob.mo || (t.mo === dob.mo && t.d < dob.d)) age--;
  const minor = age < 18;
  const g = r.guardian || {};
  if (minor) {
    if (!String(g.name || '').trim() || !String(g.email || '').trim() || !String(g.relationship || '').trim()) {
      return err('BAD_REQUEST', 'A parent or guardian name, email and relationship are required.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) return err('BAD_REQUEST', 'That parent or guardian email address does not look right.');
    if (String(g.email).trim().toLowerCase() === v.email.toLowerCase()) return err('BAD_REQUEST', 'A parent or guardian must use their own email address.');
  }
  if (v.waiver_version_signed >= WAIVER_VERSION) return err('BAD_REQUEST', 'Your waiver is already on file.');
  const old = awaitingRow(v);
  if (old) old.status = 'Expired';
  seqW++;
  const w = {
    waiver_id: 'W' + ('0000' + seqW).slice(-4), member_id: v.member_id, minor_name: '', guardian_name: '', guardian_email: '',
    status: minor ? 'AwaitingGuardian' : 'Signed', requested_at: nowLocal(), link_expires_at: plusDays(14), reminder_sent: false, last_resend: 0,
  };
  waivers.push(w);
  if (minor) {
    w.minor_name = String(r.participant_name).trim();
    w.guardian_name = String(g.name).trim();
    w.guardian_email = String(g.email).trim();
    return ok({ status: 'AwaitingGuardian', guardian_email: w.guardian_email, waiver: waiverStatus(v) });
  }
  v.waiver_version_signed = WAIVER_VERSION;
  if (!v.date_of_birth) v.date_of_birth = String(r.date_of_birth);
  return ok({ status: 'Signed', waiver: waiverStatus(v) });
}

function resendGuardianEmail(v) {
  const w = awaitingRow(v);
  if (!w) return err('BAD_REQUEST', 'There is no waiver waiting for a parent or guardian.');
  if (Date.now() - w.last_resend < RESEND_MIN_MS) return err('RATE_LIMITED', 'We just sent that email. Please wait about 10 minutes before sending it again.');
  w.last_resend = Date.now();
  if (w.link_expires_at < nowLocal()) w.link_expires_at = plusDays(14);
  return ok({ guardian_email: w.guardian_email });
}

// Demo only: stands in for the parent opening the emailed link and signing.
function mockGuardianSign(v) {
  const w = awaitingRow(v);
  if (!w) return err('BAD_REQUEST', 'There is no waiver waiting for a parent or guardian.');
  w.status = 'Signed';
  v.waiver_version_signed = WAIVER_VERSION;
  v.is_minor = true; v.guardian_name = w.guardian_name; v.guardian_email = w.guardian_email;
  return ok({ waiver: waiverStatus(v) });
}

// Owner and Family are never capped (matches the engine's Bk.capFor); max_hours applies to members only.
function capFor(r, v) { return isPriv(v) ? null : r.max_hours; }
function visibleResources(v) {
  return RESOURCES.filter(function (r) { return visibleTo(r, v); })
    .map(function (r) { return Object.assign({}, r, { max_hours: capFor(r, v) }); });
}

function startup(r, v) {
  const a = availability(r, v);
  if (!a.ok) return a;
  return ok({ me: me(v).data, resources: visibleResources(v), availability: a.data });
}

// Amount owed: the Owed shares a member owes, as the engine's `owed` block. Owner and Family never owe.
function owedBlock(id, forOwner) {
  const m = memById(id), items = [];
  if (!m || isPriv(m)) return { amount: 0, items: items };
  bookings.forEach(function (b) {
    b.players.forEach(function (p) {
      if (p.share_status === 'Owed' && p.owed_by === id && p.share_amount > 0) {
        const it = { booking_id: b.booking_id, resource_name: resById(b.resource_id).name, when: fmtRange(b.start, b.end), amount: p.share_amount };
        if (forOwner) { it.share_id = p.share_id; it.owed_at = b.end; }
        items.push(it);
      }
    });
  });
  return { amount: cents(items.reduce(function (s, x) { return s + x.amount; }, 0)), items: items };
}
function owedGate(v) {
  const o = owedBlock(v.member_id);
  return o.amount > 0 ? err('AMOUNT_OWED', 'You owe $' + o.amount.toFixed(2) + ' from an earlier booking. Please pay it in the app before booking again.') : null;
}
function payOwed(r, v) {
  const o = owedBlock(v.member_id);
  if (!(o.amount > 0)) return ok({ paid: false, amount: 0, credit_applied: 0, owed: o });
  const left = cents(o.amount - Math.min(balanceOf(v.member_id), o.amount));
  if (left > 0 && !v.card) return err('NO_CARD', 'Add a payment card to pay what you owe.');
  if (left > 0 && v.declineNext) return err('CARD_DECLINED', 'Your card was declined. Replace your card and try again.');
  const applied = useCredit(v.member_id, o.amount);
  bookings.forEach(function (b) {
    b.players.forEach(function (p) { if (p.share_status === 'Owed' && p.owed_by === v.member_id) p.share_status = 'Paid'; });
  });
  return ok({ paid: true, amount: o.amount, credit_applied: applied, owed: owedBlock(v.member_id) });
}
function settleOwed(r) {
  const m = memById(r.member_id);
  if (!m) return err('NOT_FOUND', 'That member could not be found.');
  if (r.how !== 'paid' && r.how !== 'waive') return err('BAD_REQUEST', 'how must be paid or waive.');
  if (r.how === 'waive' && !String(r.note || '').trim()) return err('BAD_REQUEST', 'Please give a reason for waiving.');
  let n = 0, sum = 0;
  bookings.forEach(function (b) {
    b.players.forEach(function (p) {
      if (p.share_status === 'Owed' && p.owed_by === r.member_id && (!r.share_ids || r.share_ids.indexOf(p.share_id) >= 0)) {
        p.share_status = r.how === 'paid' ? 'Paid' : 'Waived';
        n++; sum += p.share_amount;
      }
    });
  });
  if (!n) return err('BAD_REQUEST', 'That member does not owe anything.');
  return ok({ member_id: r.member_id, settled: n, amount: cents(sum), how: r.how, owed: null });
}

function me(v) {
  const t = todayYmd(), ws = mondayOf(t), priv = isPriv(v);
  return ok({
    member: Object.assign(summary(v), { phone: v.phone, emergency_contact_name: v.emergency_contact_name, emergency_contact_phone: v.emergency_contact_phone, date_of_birth: v.date_of_birth }),
    max_slots: maxSlotsFor(v),
    week: { used: weekCount(v.member_id, t), limit: priv ? null : WEEKLY_LIMIT, week_start: ws, week_end: addDays(ws, 6) },
    book_ahead_days: priv ? null : BOOK_AHEAD,
    unlimited_ahead: priv,
    waiver_on_file: v.waiver_version_signed >= 1,
    waiver: waiverStatus(v),
    waiver_form_url: 'https://example.com/waiver-demo',
    terms: termsStatus(v),
    card: v.card ? { brand: v.card.brand, last4: v.card.last4, exp: v.card.exp } : null,
    owed: owedBlock(v.member_id),
    credits: { balance: balanceOf(v.member_id), lots: lotsOf(v.member_id).map(function (c) { return { amount_remaining: c.remaining, expires_at: c.expires_at }; }) },
    payments_enabled: true,
    settings: Object.assign({}, SETTINGS),
  });
}

function availability(r, v) {
  const priv = isPriv(v);
  const from = r.from || todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return err('BAD_REQUEST', 'Invalid date.');
  if (from < todayYmd()) return err('BAD_REQUEST', 'That date is in the past.');
  const n = r.days == null ? (priv ? 7 : BOOK_AHEAD + 1) : Number(r.days);
  if (!(n >= 1 && n <= 14)) return err('BAD_REQUEST', 'days must be between 1 and 14.');
  const nowS = nowLocal(), days = [], last = addDays(todayYmd(), BOOK_AHEAD);
  const visible = visibleResources(v);
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i), blocks = [];
    if (!priv && date > last) break; // members never see past their window
    for (let h = SETTINGS.open_hour; h + SETTINGS.block_hours <= SETTINGS.close_hour; h += SETTINGS.block_hours) {
      const start = date + 'T' + pad(h) + ':00', end = endOf(start), slots = {}, reasons = {};
      visible.forEach(function (res) {
        let st = 'free';
        if (start <= nowS) st = 'past';
        else {
          let blockedBy = null;
          bookings.forEach(function (b) {
            if (!active(b) || !conflicts(b.resource_id, res.resource_id) || !overlaps(b, { start: start, end: end })) return;
            const mineB = !isBlock(b) && b.resource_id === res.resource_id && (b.booker === v.member_id || b.players.some(function (p) { return p.member_id === v.member_id; }));
            if (mineB) st = 'mine';
            else if (isBlock(b)) blockedBy = b;
            else if (st !== 'mine') st = 'busy';
          });
          if (st !== 'mine' && blockedBy) {
            st = v.role === 'Owner' ? 'blocked' : 'unavailable';
            if (v.role === 'Owner') reasons[res.resource_id] = blockReason(blockedBy);
          }
        }
        slots[res.resource_id] = st;
      });
      const cell = { start: start, end: end, slots: slots };
      if (Object.keys(reasons).length) cell.reasons = reasons;
      blocks.push(cell);
    }
    days.push({ date: date, blocks: blocks });
  }
  return ok({ days: days });
}

function createBooking(r, v) {
  if (!termsStatus(v).accepted) return err('TERMS_REQUIRED', 'Please read and accept the Booking and Payment Terms before booking. You can do this from the Account screen.');
  if (owedGate(v)) return owedGate(v);
  if (needsCard(v, [r])) return cardRequired();
  const res = resById(r.resource_id);
  if (!res || !r.start) return err('BAD_REQUEST', 'Missing or invalid booking details.');
  if (!visibleTo(res, v)) return err('FORBIDDEN', "That resource isn't available to you.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.start)) return err('BAD_REQUEST', 'Invalid start time.');
  const payMode = r.pay_mode || 'Split';
  if (payMode !== 'Split' && payMode !== 'BookerPays') return err('BAD_REQUEST', 'Invalid pay mode.');
  const priv = isPriv(v);
  if (!isOnGrid(r.start)) return err('OUT_OF_WINDOW', 'That time is outside the booking blocks.');
  if (r.start <= nowLocal()) return err('OUT_OF_WINDOW', 'That time has already passed.');
  if (!priv && r.start.slice(0, 10) > addDays(todayYmd(), BOOK_AHEAD)) return err('OUT_OF_WINDOW', 'You can book up to ' + BOOK_AHEAD + ' days ahead.');
  const end = endOf(r.start);
  const clash = bookings.some(function (b) { return active(b) && conflicts(b.resource_id, res.resource_id) && overlaps(b, { start: r.start, end: end }); });
  if (clash) return err('SLOT_TAKEN', 'Sorry, that time was just booked by someone else.');
  if (!priv && weekCount(v.member_id, r.start.slice(0, 10)) >= WEEKLY_LIMIT) {
    return err('LIMIT_REACHED', 'You have used all ' + WEEKLY_LIMIT + ' bookings for that week.');
  }
  const gr = checkGuests(r.guests, v, SETTINGS.max_players_per_court * res.courts);
  if (gr.error) return gr.error;
  const ids = [v.member_id].concat(createGuests(gr.list));
  const b = addBooking({ resource_id: res.resource_id, start: r.start, status: v.role === 'Family' ? 'Pending' : (priv ? 'Approved' : 'Pending'), booker: v.member_id, guests: ids.slice(1), pay_mode: priv ? 'BookerPays' : payMode });
  attachInvites([b], gr.list, v);
  return ok({ booking: detail(b, v) });
}

// ---- payments (Phase 2B): no real Stripe ----
const DEMO_CARD = { brand: 'visa', last4: '4242', exp: '12/30' };
function needsCard(v, sessions) {
  if (isPriv(v) || v.card) return false;
  return sessions.some(function (s) { const res = s && resById(s.resource_id); return !!res && res.rate_per_hour > 0; });
}
function cardRequired() {
  return err('CARD_REQUIRED', 'Add a payment card before requesting bookings. Your card is charged about 24 hours before each booking.');
}
function startCardSetup(r, v) {
  if (!termsStatus(v).accepted) return err('TERMS_REQUIRED', 'Please read and accept the Booking and Payment Terms before booking. You can do this from the Account screen.');
  v.card = Object.assign({}, DEMO_CARD);
  v.declineNext = false; // a replaced card works
  return ok({ url: null, mock_saved: true });
}
function confirmCardSetup(r, v) {
  if (!r.cs) return err('BAD_REQUEST', 'Missing card session.');
  if (!v.card) v.card = Object.assign({}, DEMO_CARD);
  return ok({ card: Object.assign({}, v.card) });
}
function removeCard(r, v) {
  const nowS = nowLocal();
  const upcoming = bookings.some(function (b) { return b.booker === v.member_id && active(b) && b.start > nowS && b.total_amount > 0; });
  if (upcoming) return err('BAD_REQUEST', 'You have upcoming bookings. Replace your card instead of removing it.');
  v.card = null;
  return ok({ card: null });
}
function shareOf(id, v) {
  for (let i = 0; i < bookings.length; i++) {
    const p = bookings[i].players.filter(function (x) { return x.share_id === id && x.member_id === v.member_id; })[0];
    if (p) return { b: bookings[i], p: p };
  }
  return null;
}
function payShare(r, v) {
  const f = shareOf(r.share_id, v);
  if (!f) return err('NOT_FOUND', 'We could not find that payment.');
  if (!(f.p.share_status === 'Pending' || f.p.share_status === 'Unpaid') || !(f.p.share_amount > 0) || !active(f.b)) return err('BAD_REQUEST', "That payment can't be made right now.");
  const applied = useCredit(v.member_id, f.p.share_amount);
  f.p.credit_applied = cents((f.p.credit_applied || 0) + applied);
  f.p.share_status = 'Paid';
  const out = { paid: true, credit_applied: applied, charged: cents(f.p.share_amount - applied), share: { share_id: f.p.share_id, share_status: 'Paid', credit_applied: f.p.credit_applied } };
  if (v.card || out.charged === 0) return ok(out);
  return ok(Object.assign(out, { url: null, mock_paid: true }));
}
function confirmPayment(r, v) {
  if (!r.cs) return err('BAD_REQUEST', 'Missing payment session.');
  return ok({ share: null });
}

// Validates the guests without creating anyone. Each guest is { member_id } (a Known player) or { email }.
// Returns { list: [{ member?, email }] } or { error }. Nothing here reveals whether an email belongs to a member.
function checkGuests(input, v, maxPlayers) {
  const guests = Array.isArray(input) ? input : [];
  if (1 + guests.length > maxPlayers) return { error: err('TOO_MANY_PLAYERS', 'This booking allows up to ' + maxPlayers + ' players.') };
  const known = knownPlayers(v).data.map(function (k) { return k.member_id; });
  const seen = [], list = [];
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i] || {};
    let m, email;
    if (g.member_id) {
      if (known.indexOf(g.member_id) === -1) return { error: err('NOT_FOUND', 'That player could not be found.') };
      m = memById(g.member_id);
      email = m.email;
    } else {
      email = String(g.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: err('BAD_REQUEST', 'That email address does not look right.') };
      m = memByEmail(email);
    }
    const key = (m ? m.email : email).toLowerCase();
    if (key === v.email.toLowerCase()) return { error: err('BAD_REQUEST', 'You are already on this booking.') };
    if (seen.indexOf(key) !== -1) return { error: err('BAD_REQUEST', 'The same person is listed twice.') };
    seen.push(key);
    list.push({ member: m, email: key });
  }
  return { list: list };
}

// Matches each email to a member, or makes a placeholder (status Invited). Returns every guest's member_id.
function createGuests(list) {
  return list.map(function (g) {
    if (g.member) return g.member.member_id;
    seqM++;
    const nm = member('M' + ('0000' + seqM).slice(-4), '', '', g.email, 'Guest', 'Invited',
      { approved_at: '', phone: '', emergency_contact_name: '', emergency_contact_phone: '', created_at: nowLocal() });
    members.push(nm);
    g.member = nm;
    return nm.member_id;
  });
}

// One invite per invitee, covering every booking made in the request. Logs the link the email would carry.
function attachInvites(made, list, v) {
  list.forEach(function (g) {
    const m = g.member;
    const mine = made.map(function (b) { return b.players.filter(function (p) { return p.member_id === m.member_id; })[0]; });
    seqI++;
    const inv = {
      invite_id: 'I' + ('00000' + seqI).slice(-5), email: g.email, member_id: m.member_id, booker: v.member_id,
      booking_ids: made.map(function (b) { return b.booking_id; }), share_ids: mine.map(function (p) { return p.share_id; }),
      status: m.status === 'Suspended' || m.status === 'Revoked' ? 'Withheld' : 'Invited', resent_count: 0, sent_at: Date.now(),
    };
    mine.forEach(function (p) { p.invite_id = inv.invite_id; });
    invites.push(inv);
    logInvite(inv);
  });
}

function inviteLink(inv) {
  return location.origin + location.pathname + location.search + '#/go?t=demo-invite-' + inv.invite_id;
}
function logInvite(inv) {
  if (inv.status === 'Withheld') return;
  try { console.info('[demo] Invitation email to ' + inv.email + ': ' + inviteLink(inv)); } catch (e) { /* no console */ }
}

function sessionLabel(res, s) {
  const d = s.start.slice(0, 10);
  return res.name + ', ' + dowName(d) + ' ' + monthName(d) + ' ' + dayNum(d) + ' ' + timeRange(s.start, s.end, true);
}
function hrsOf(s) {
  const a = parseLocal(s.start), b = parseLocal(s.end);
  return ((b.h * 60 + b.mi) - (a.h * 60 + a.mi)) / 60;
}

// Multi-session booking for everyone: terms, slot limit, window, grid, golf cap, weekly limit by slot,
// merge, all-or-nothing conflict check, then price and split per merged booking.
function createBookings(r, v) {
  if (!termsStatus(v).accepted) return err('TERMS_REQUIRED', 'Please read and accept the Booking and Payment Terms before booking. You can do this from the Account screen.');
  if (owedGate(v)) return owedGate(v);
  if (needsCard(v, Array.isArray(r.sessions) ? r.sessions : [])) return cardRequired();
  const input = Array.isArray(r.sessions) ? r.sessions : [];
  if (!input.length) return err('BAD_REQUEST', 'Pick at least one time.');
  const payMode = r.pay_mode || 'Split';
  if (payMode !== 'Split' && payMode !== 'BookerPays') return err('BAD_REQUEST', 'Invalid pay mode.');
  const priv = isPriv(v), nowS = nowLocal(), list = [];
  let slotTotal = 0;
  for (let i = 0; i < input.length; i++) {
    const s = input[i], res = s && resById(s.resource_id);
    if (!res) return err('BAD_REQUEST', 'Missing or invalid booking details.');
    if (!visibleTo(res, v)) return err('FORBIDDEN', "That resource isn't available to you.");
    const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!re.test(s.start) || !re.test(s.end)) return err('BAD_REQUEST', 'Invalid start or end time.');
    const a = parseLocal(s.start), b = parseLocal(s.end);
    const onGrid = function (p) { return p.mi === 0 && p.h >= SETTINGS.open_hour && p.h <= SETTINGS.close_hour && (p.h - SETTINGS.open_hour) % res.block_hours === 0; };
    if (s.start.slice(0, 10) !== s.end.slice(0, 10) || !onGrid(a) || !onGrid(b)) return err('BAD_REQUEST', 'That time is outside the booking blocks.');
    if (s.end <= s.start) return err('BAD_REQUEST', 'The end must be after the start.');
    slotTotal += hrsOf(s) / res.block_hours;
    list.push({ resource_id: res.resource_id, start: s.start, end: s.end });
  }
  const maxSlots = maxSlotsFor(v);
  if (maxSlots !== null && slotTotal > maxSlots) return err('BAD_REQUEST', 'You can book up to ' + maxSlots + ' time slot' + (maxSlots === 1 ? '' : 's') + ' at a time.');
  for (let i = 0; i < list.length; i++) {
    const s = list[i], res = resById(s.resource_id);
    if (capFor(res, v) && hrsOf(s) > capFor(res, v)) return err('BAD_REQUEST', res.name + ' bookings can be up to ' + res.max_hours + ' hours.');
    if (s.start <= nowS) return err('OUT_OF_WINDOW', 'That time has already passed.');
    if (!priv && s.start.slice(0, 10) > addDays(todayYmd(), BOOK_AHEAD)) return err('OUT_OF_WINDOW', 'You can book up to ' + BOOK_AHEAD + ' days ahead.');
  }
  list.sort(function (x, y) {
    if (x.resource_id !== y.resource_id) return x.resource_id < y.resource_id ? -1 : 1;
    return x.start < y.start ? -1 : x.start > y.start ? 1 : 0;
  });
  const merged = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i], last = merged[merged.length - 1];
    if (last && last.resource_id === s.resource_id) {
      if (s.start < last.end) return err('BAD_REQUEST', 'Some of those times overlap each other.');
      if (s.start === last.end) { last.end = s.end; continue; }
    }
    merged.push({ resource_id: s.resource_id, start: s.start, end: s.end });
  }
  for (let i = 0; i < merged.length; i++) {
    const res = resById(merged[i].resource_id);
    if (capFor(res, v) && hrsOf(merged[i]) > capFor(res, v)) return err('BAD_REQUEST', res.name + ' bookings can be up to ' + res.max_hours + ' hours.');
  }
  if (!priv) {
    const perWeek = {};
    merged.forEach(function (s) { const wk = mondayOf(s.start.slice(0, 10)); perWeek[wk] = (perWeek[wk] || 0) + slotsOf(s); });
    const over = Object.keys(perWeek).some(function (wk) { return weekCount(v.member_id, wk) + perWeek[wk] > WEEKLY_LIMIT; });
    if (over) return err('LIMIT_REACHED', 'That would be more than your ' + WEEKLY_LIMIT + ' bookings this week (each 2-hour time counts as one).');
  }
  const minCourts = Math.min.apply(null, merged.map(function (s) { return resById(s.resource_id).courts || 1; }));
  const gr = checkGuests(r.guests, v, SETTINGS.max_players_per_court * minCourts);
  if (gr.error) return gr.error;
  const label = function (s) { return sessionLabel(resById(s.resource_id), s); };
  const selfClash = merged.filter(function (s, i) {
    return merged.some(function (o, j) { return j !== i && conflicts(o.resource_id, s.resource_id) && overlaps(o, s); });
  });
  if (selfClash.length) {
    return err('SLOT_TAKEN', 'Some of your selected times overlap each other (Both Courts includes Court 1 and Court 2): ' + selfClash.map(label).join('; ') + '. Please unselect one of them.');
  }
  const taken = merged.filter(function (s) {
    return bookings.some(function (b) { return active(b) && conflicts(b.resource_id, s.resource_id) && overlaps(b, s); });
  });
  if (taken.length) {
    return err('SLOT_TAKEN', 'These times are already booked: ' + taken.map(function (s) { return sessionLabel(resById(s.resource_id), s); }).join('; ') + '.');
  }
  const guestIds = createGuests(gr.list);
  const status = v.role === 'Family' ? 'Pending' : (priv ? 'Approved' : 'Pending');
  const made = merged.map(function (s) {
    return addBooking({ resource_id: s.resource_id, start: s.start, end: s.end, status: status, booker: v.member_id, guests: guestIds, pay_mode: priv ? 'BookerPays' : payMode, notes: r.note || '' });
  });
  attachInvites(made, gr.list, v);
  return ok({ bookings: made.map(function (b) { return detail(b, v); }) });
}

function mine(b, v) { return b.booker === v.member_id || b.players.some(function (p) { return p.member_id === v.member_id && isAccepted(p); }); }

function myBookings(r, v) {
  const nowS = nowLocal();
  let list = bookings.filter(function (b) { return mine(b, v) && (r.include_past ? true : b.start >= nowS); });
  list.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  return ok({ bookings: list.map(function (b) { return detail(b, v); }) });
}

// Money back on a paid share: to the card (Refunded; any credit it used goes back as credit) or as credit (Credited).
function returnShare(b, p, how) {
  const payer = p.share_status === 'CoveredByBooker' ? b.booker : p.member_id;
  if (how === 'credit') {
    p.share_status = 'Credited';
    addCredit(payer, p.share_amount, 'owner cancellation');
  } else {
    p.share_status = 'Refunded';
    if (p.credit_applied > 0) addCredit(payer, p.credit_applied, 'owner cancellation');
  }
}
const paidShare = function (p) { return p.share_status === 'Paid' || p.share_status === 'CoveredByBooker'; };
const openShare = function (p) { return p.share_status === 'Pending' || p.share_status === 'Unpaid'; };

function cancelBooking(r, v) {
  const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
  if (!b) return err('NOT_FOUND', 'We could not find that booking.');
  if (b.booker !== v.member_id && v.role !== 'Owner') return err('FORBIDDEN', 'Only the person who booked can cancel.');
  if (b.start <= nowLocal() || !active(b)) return err('FORBIDDEN', 'This booking can no longer be cancelled.');
  const hrs = hoursUntil(b.start);
  const wasPending = b.status === 'Pending';
  b.status = 'Cancelled';
  b.cancelled_at = nowLocal();
  if (v.role === 'Owner') {
    // D: owner cancels. Unpaid and pending shares are cancelled; paid ones come back as the owner chose. No strikes.
    const how = r.paid_as === 'credit' ? 'credit' : 'refund';
    b.players.forEach(function (p) {
      if (paidShare(p)) returnShare(b, p, how);
      else if (openShare(p)) p.share_status = 'Cancelled';
    });
  } else if (wasPending || hrs > SETTINGS.free_cancel_hours) {
    // A / B: free. Anything paid early with Pay now is refunded.
    b.players.forEach(function (p) {
      if (p.share_status === 'Paid') returnShare(b, p, 'refund');
      else if (openShare(p) || p.share_status === 'CoveredByBooker') p.share_status = 'Cancelled';
    });
  } else {
    // C: late cancellation. Paid stays paid; everyone who had not paid is charged to the booker.
    b.players.forEach(function (p) { if (openShare(p) && p.share_amount > 0) p.share_status = 'CoveredByBooker'; });
    b.notes += ' LATE_CANCEL';
    b.late_decision = '';
    b.late_reason = String(r.reason || '').trim().slice(0, 300);
  }
  return ok({ booking: detail(b, v) });
}

// Waive fees (owner): open shares are waived, paid ones go back as credit (default) or to the card. No strikes.
function waiveShares(b, memberIds, how) {
  b.players.forEach(function (p) {
    if (memberIds && memberIds.indexOf(p.member_id) === -1) return;
    if (openShare(p)) p.share_status = 'Waived';
    else if (paidShare(p)) returnShare(b, p, how);
  });
}

function decideLate(b, decision) {
  if (decision !== 'credit' && decision !== 'keep') return err('BAD_REQUEST', 'Decision must be credit or keep.');
  if (b.status !== 'Cancelled' || !/LATE_CANCEL/.test(b.notes)) return err('BAD_REQUEST', 'That is not a late cancellation.');
  if (b.late_decision) return err('BAD_REQUEST', 'That late cancellation has already been decided.');
  if (decision === 'credit') b.players.forEach(function (p) { if (paidShare(p)) returnShare(b, p, 'credit'); });
  b.late_decision = decision;
  return null;
}
function lateWaiting() {
  const since = addDays(todayYmd(), -14);
  return bookings.filter(function (b) { return b.status === 'Cancelled' && /LATE_CANCEL/.test(b.notes) && !b.late_decision && b.cancelled_at.slice(0, 10) >= since; });
}

function knownPlayers(v) {
  const ids = {};
  bookings.forEach(function (b) {
    if (!mine(b, v)) return;
    b.players.forEach(function (p) { if (p.member_id !== v.member_id && isAccepted(p)) ids[p.member_id] = true; });
  });
  (played[v.member_id] || []).forEach(function (id) { ids[id] = true; });
  if (v.role === 'Owner') members.forEach(function (m) { if (m.member_id !== v.member_id) ids[m.member_id] = true; }); // demo: enough names to search
  return ok(Object.keys(ids).map(memById).filter(function (m) { return m && m.status === 'Active'; })
    .map(function (m) { return { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name }; }));
}

function ownerAction(a, r, v) {
  if (a === 'ownerDashboard') {
    const t = todayYmd(), ws = mondayOf(t), we = addDays(ws, 6), nowS = nowLocal(), lim = addDays(t, 7) + 'T23:59';
    return ok({
      pending_bookings: bookings.filter(function (b) { return b.status === 'Pending'; }).map(function (b) { return detail(b, v, true); }),
      pending_members: members.filter(function (m) { return m.status === 'Pending'; }).map(function (m) {
        const inv = memById(m.invited_by_member_id);
        return { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, email: m.email, phone: m.phone, role: m.role,
          invited_by_name: inv ? inv.first_name + ' ' + inv.last_name : '', created_at: m.created_at };
      }),
      upcoming: bookings.filter(function (b) { return b.status === 'Approved' && b.start >= nowS && b.start <= lim; })
        .sort(function (x, y) { return x.start < y.start ? -1 : 1; }).map(function (b) { return detail(b, v); }),
      counts: {
        active_members: members.filter(function (m) { return m.status === 'Active'; }).length,
        bookings_this_week: bookings.filter(function (b) { const d = b.start.slice(0, 10); return active(b) && d >= ws && d <= we; }).length,
      },
      late_cancellations: lateWaiting().map(function (b) { return detail(b, v, true); }),
      series: (fillSeries(), SERIES.filter(function (x) { return x.status === 'Active' && (!x.end_date || x.end_date >= t); }).map(seriesOut)),
      clashes: CLASHES.filter(function (c) { return c.status === 'Open'; }).map(clashOut),
      owed: members.map(function (m) {
        const o = owedBlock(m.member_id, true);
        return o.amount > 0 ? { member_id: m.member_id, name: m.first_name + ' ' + m.last_name, email: m.email, amount: o.amount, items: o.items } : null;
      }).filter(Boolean),
      waivers_awaiting_guardian: waivers.filter(function (w) { return w.status === 'AwaitingGuardian'; }).map(function (w) {
        return { waiver_id: w.waiver_id, member_id: w.member_id, minor_name: w.minor_name, guardian_name: w.guardian_name, guardian_email: w.guardian_email,
          requested_at: w.requested_at, link_expires_at: w.link_expires_at, reminder_sent: w.reminder_sent };
      }),
      email_quota_remaining: 87,
    });
  }
  if (a === 'ownerDecideBooking') {
    const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
    if (!b) return err('NOT_FOUND', 'We could not find that booking.');
    if (['approve', 'approve_waive', 'reject'].indexOf(r.decision) === -1) return err('BAD_REQUEST', 'Decision must be approve, approve_waive or reject.');
    if (b.status !== 'Pending') return err('BAD_REQUEST', 'That booking has already been decided.');
    b.status = r.decision === 'reject' ? 'Rejected' : 'Approved';
    if (r.decision === 'approve_waive') waiveShares(b, null, 'credit');
    return ok({ booking: detail(b, v, true) });
  }
  if (a === 'ownerWaiveFees') {
    const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
    if (!b) return err('NOT_FOUND', 'We could not find that booking.');
    if (!String(r.reason || '').trim()) return err('BAD_REQUEST', 'Please give a reason for waiving the fees.');
    if (r.paid_as && r.paid_as !== 'credit' && r.paid_as !== 'refund') return err('BAD_REQUEST', 'paid_as must be credit or refund.');
    if (!active(b)) return err('BAD_REQUEST', 'Fees can only be waived on a pending or approved booking.');
    waiveShares(b, Array.isArray(r.member_ids) && r.member_ids.length ? r.member_ids : null, r.paid_as === 'refund' ? 'refund' : 'credit');
    return ok({ booking: detail(b, v, true) });
  }
  if (a === 'ownerDecideLateCancel') {
    const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
    if (!b) return err('NOT_FOUND', 'We could not find that booking.');
    const e = decideLate(b, r.decision);
    if (e) return e;
    return ok({ booking: detail(b, v, true) });
  }
  if (a === 'ownerDecideMember') {
    const m = memById(r.member_id);
    if (!m) return err('NOT_FOUND', 'We could not find that member.');
    if (r.decision !== 'approve' && r.decision !== 'reject') return err('BAD_REQUEST', 'Decision must be approve or reject.');
    if (m.status !== 'Pending') return err('BAD_REQUEST', 'That member has already been decided.');
    m.status = r.decision === 'approve' ? 'Active' : 'Revoked';
    if (r.decision === 'approve') m.approved_at = nowLocal();
    else m.notes = r.note || '';
    return ok({ member: m });
  }
  if (a === 'ownerSetMemberStatus') {
    const m = memById(r.member_id);
    if (!m) return err('NOT_FOUND', 'We could not find that member.');
    if (['Active', 'Suspended', 'Revoked'].indexOf(r.status) === -1) return err('BAD_REQUEST', 'Invalid status.');
    if (m.role === 'Owner') return err('FORBIDDEN', 'The owner account cannot be changed.');
    m.status = r.status;
    if (r.status !== 'Active') {
      bookings.forEach(function (b) { if (b.booker === m.member_id && active(b) && b.start > nowLocal()) b.status = 'Cancelled'; });
    }
    return ok({ member: m });
  }
  if (a === 'ownerSetMemberRole') {
    const m = memById(r.member_id);
    if (!m) return err('NOT_FOUND', 'We could not find that member.');
    if (r.role !== 'Member' && r.role !== 'Family') return err('BAD_REQUEST', 'Role must be Member or Family.');
    if (m.role === 'Owner') return err('FORBIDDEN', 'The owner account cannot be changed.');
    if (m.status !== 'Active') return err('BAD_REQUEST', 'Approve this person before changing their role.');
    m.role = r.role;
    return ok({ member: m });
  }
  if (a === 'ownerSettleOwed') return settleOwed(r);
  if (a === 'ownerMembers') {
    return ok(members.filter(function (m) { return !r.status || m.status === r.status; })
      .map(function (m) { return Object.assign({}, m, { amount_owed: owedBlock(m.member_id).amount }); }));
  }
  if (a === 'ownerBlockTime' || a === 'ownerEditBlock') {
    const old = a === 'ownerEditBlock' ? bookingById(r.booking_id) : null;
    if (a === 'ownerEditBlock') {
      if (!old) return err('NOT_FOUND', 'We could not find that booking.');
      if (!isBlock(old)) return err('BAD_REQUEST', 'That is not a block.');
      if (!active(old)) return err('BAD_REQUEST', 'This block is already ' + old.status.toLowerCase() + '.');
      if (old.start <= nowLocal()) return err('FORBIDDEN', 'This block has started. Use Release remaining time or Remove block.');
    }
    const res = resById(r.resource_id);
    const day = String(r.start || r.date || '').slice(0, 10);
    if (!res || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return err('BAD_REQUEST', 'Pick a court, day and time.');
    const whole = r.whole_day === true;
    if (!whole && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(r.start || ''))) return err('BAD_REQUEST', 'Pick a court, day and time.');
    const start = whole ? day + 'T' + pad(SETTINGS.open_hour) + ':00' : r.start;
    const slots = Math.max(1, Math.floor(Number(r.slots) || 1));
    const end = whole ? day + 'T' + pad(SETTINGS.close_hour) + ':00' : rangeEnd(day, start.slice(11, 16), slots, res.block_hours);
    if (!whole && !fitsGrid(start, end)) return err('OUT_OF_WINDOW', 'That time is outside the booking schedule.');
    if (end <= nowLocal()) return err('OUT_OF_WINDOW', 'That time has already passed.');
    const hits = bookings.filter(function (b) { return b !== old && active(b) && conflicts(b.resource_id, res.resource_id) && overlaps(b, { start: start, end: end }); });
    const label = function (x) { return resById(x.resource_id).name + ', ' + dowName(x.start) + ' ' + monthName(x.start) + ' ' + dayNum(x.start) + ' ' + timeRange(x.start, x.end, true); };
    if (hits.length && r.bump !== true) {
      return err('BLOCK_CLASH', 'Already booked in that time: ' + hits.map(function (x) {
        const bk = memById(x.booker);
        return label(x) + ' (' + (isBlock(x) ? 'a block' : (bk ? bk.first_name + ' ' + bk.last_name : 'a member') + "'s booking") + ')';
      }).join('; ') + '.');
    }
    hits.forEach(function (x) { x.status = 'Cancelled'; x.cancelled_at = nowLocal(); }); // demo: bumped (owner cancellation)
    const reason = String(r.reason || r.note || '').trim().slice(0, 120);
    if (old) { old.status = 'Cancelled'; old.cancelled_at = nowLocal(); }
    const b = addBlock(res, start, end, 'BLOCK' + (reason ? ': ' + reason : '') + (old && seriesOf(old) ? ' SERIES:' + seriesOf(old) : ''));
    return ok({ booking: detail(b, v), bumped: hits.length });
  }
  if (a === 'ownerRemoveBlock') {
    const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
    if (!b) return err('NOT_FOUND', 'We could not find that booking.');
    if (!isBlock(b)) return err('BAD_REQUEST', 'That is not a block. Use Cancel booking instead.');
    if (!active(b)) return err('BAD_REQUEST', 'This block is already ' + b.status.toLowerCase() + '.');
    b.status = 'Cancelled';
    b.cancelled_at = nowLocal();
    return ok({ booking: detail(b, v) });
  }
  if (a === 'ownerCreateSeries') return createSeriesImpl(r);
  if (a === 'ownerEditSeries') return editSeriesImpl(r);
  if (a === 'ownerStopSeries') {
    const sr = SERIES.filter(function (x) { return x.series_id === r.series_id; })[0];
    if (!sr) return err('NOT_FOUND', 'That repeating entry could not be found.');
    if (sr.status === 'Stopped') return err('BAD_REQUEST', 'That repeating entry is already stopped.');
    sr.status = 'Stopped';
    let removed = 0;
    bookings.forEach(function (b) {
      if (seriesOf(b) === sr.series_id && active(b) && b.start > nowLocal()) { b.status = 'Cancelled'; b.cancelled_at = nowLocal(); removed++; }
    });
    CLASHES.forEach(function (c) { if (c.series_id === sr.series_id && c.status === 'Open') c.status = 'Expired'; });
    return ok({ series: seriesOut(sr), removed: removed });
  }
  if (a === 'ownerDecideClash') {
    const c = CLASHES.filter(function (x) { return x.clash_id === r.clash_id; })[0];
    if (!c) return err('NOT_FOUND', 'That clash could not be found.');
    if (c.status !== 'Open') return err('BAD_REQUEST', 'That clash was already decided.');
    const e = decideClashImpl(c, r.decision, v);
    if (e) return e;
    return ok({ clash: clashOut(c) });
  }
  return err('BAD_REQUEST', 'Unknown action: ' + a);
}

// ---- owner blocks and repeating entries ----
// SERIES rows: { series_id, kind, resource_id, weekdays: ['Mon'], start_time, slots, start_date, end_date, reason, status, skipped: [] }
const SERIES = [];
const CLASHES = [];
let seqR = 0, seqX = 0;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OWNER_ID = 'M0001';
function isBlock(b) { return /^BLOCK/.test(b.notes || ''); }
function blockReason(b) { return String(b.notes || '').replace(/^BLOCK/, '').replace(/SERIES:R\d+/g, ' ').replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim(); }
function seriesOf(b) { const m = /SERIES:(R\d+)/.exec(b.notes || ''); return m ? m[1] : ''; }
function bookingById(id) { return bookings.filter(function (b) { return b.booking_id === id; })[0]; }
function rangeEnd(day, hhmm, slots, blockHours) {
  const mins = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + slots * blockHours * 60;
  return day + 'T' + pad(Math.floor(mins / 60)) + ':' + pad(mins % 60);
}
function fitsGrid(start, end) {
  const a = parseLocal(start), b = parseLocal(end);
  const whole = a.h === SETTINGS.open_hour && a.mi === 0 && b.h === SETTINGS.close_hour && b.mi === 0;
  return end.slice(0, 10) === start.slice(0, 10) && b.h * 60 + b.mi <= SETTINGS.close_hour * 60 && (whole || isOnGrid(start));
}
function addBlock(res, start, end, notes) {
  const b = addBooking({ resource_id: res.resource_id, start: start, end: end, status: 'Approved', booker: OWNER_ID, guests: [], pay_mode: 'BookerPays', notes: notes });
  return b;
}
function occurrenceNotes(sr) {
  if (sr.kind === 'block') return 'BLOCK' + (sr.reason ? ': ' + sr.reason : '') + ' SERIES:' + sr.series_id;
  return (sr.reason ? sr.reason + ' ' : '') + 'SERIES:' + sr.series_id;
}
function seriesOut(sr) {
  const res = resById(sr.resource_id);
  const end = rangeEnd(sr.start_date, sr.start_time, sr.slots, res.block_hours);
  return {
    series_id: sr.series_id, kind: sr.kind, resource_id: sr.resource_id, resource_name: res.name, weekdays: sr.weekdays.slice(),
    start_time: sr.start_time, end_time: end.slice(11, 16), slots: sr.slots,
    whole_day: Number(sr.start_time.slice(0, 2)) === SETTINGS.open_hour && Number(end.slice(11, 13)) === SETTINGS.close_hour,
    start_date: sr.start_date, end_date: sr.end_date, reason: sr.reason, status: sr.status,
  };
}
function clashOut(c) {
  const sr = SERIES.filter(function (x) { return x.series_id === c.series_id; })[0];
  const res = resById(sr.resource_id);
  return {
    clash_id: c.clash_id, series_id: c.series_id, kind: sr.kind, reason: sr.reason, resource_id: sr.resource_id, resource_name: res.name,
    date: c.date, start: c.start, end: c.end, status: c.status,
    bookings: c.booking_ids.map(bookingById).filter(Boolean).map(function (b) {
      const bm = memById(b.booker);
      return { booking_id: b.booking_id, status: b.status, booker_name: bm.first_name + ' ' + bm.last_name, resource_name: resById(b.resource_id).name, start: b.start, end: b.end };
    }),
  };
}
// Makes the next 28 days of occurrences and records clashes, like the engine's Rec.fill.
function fillSeries() {
  const today = todayYmd(), nowS = nowLocal(), last = addDays(today, 28);
  let created = 0, clashes = 0;
  SERIES.filter(function (sr) { return sr.status === 'Active'; }).forEach(function (sr) {
    if (sr.end_date && sr.end_date < today) { sr.status = 'Stopped'; return; }
    CLASHES.filter(function (c) { return c.series_id === sr.series_id && c.status === 'Open'; }).forEach(function (c) {
      const live = c.booking_ids.map(bookingById).filter(function (b) { return b && active(b); });
      if (!live.length) c.status = 'Expired';
      else if (live.some(function (b) { return b.start <= nowS; })) { c.status = 'Expired'; sr.skipped.push(c.date); }
    });
    const res = resById(sr.resource_id);
    for (let d = sr.start_date > today ? sr.start_date : today; d <= last && (!sr.end_date || d <= sr.end_date); d = addDays(d, 1)) {
      if (sr.weekdays.indexOf(DAY_NAMES[dowOf(d)]) < 0 || sr.skipped.indexOf(d) >= 0) continue;
      if (bookings.some(function (b) { return seriesOf(b) === sr.series_id && b.start.slice(0, 10) === d; })) continue;
      const start = d + 'T' + sr.start_time, end = rangeEnd(d, sr.start_time, sr.slots, res.block_hours);
      if (sr.kind === 'block' ? end <= nowS : start <= nowS) continue;
      const hits = bookings.filter(function (b) { return active(b) && conflicts(b.resource_id, res.resource_id) && overlaps(b, { start: start, end: end }); });
      if (hits.some(function (b) { return b.booker === OWNER_ID || isBlock(b); })) continue; // the owner's own booking or block: skipped silently
      if (!hits.length) { addBlock(res, start, end, occurrenceNotes(sr)); created++; continue; }
      if (CLASHES.some(function (c) { return c.series_id === sr.series_id && c.date === d && c.status === 'Open'; })) continue;
      seqX++;
      CLASHES.push({ clash_id: 'X' + ('00000' + seqX).slice(-5), series_id: sr.series_id, date: d, start: start, end: end, booking_ids: hits.map(function (b) { return b.booking_id; }), status: 'Open' });
      clashes++;
    }
  });
  return { created: created, clashes: clashes };
}
function seedSeries() {
  const day = addDays(todayYmd(), 3);
  seqR++;
  SERIES.push({ series_id: 'R0001', kind: 'block', resource_id: 'COURT1', weekdays: [DAY_NAMES[dowOf(day)]], start_time: '10:00', slots: 1, start_date: todayYmd(), end_date: '', reason: 'Floor care', status: 'Active', skipped: [] });
  fillSeries();
}
function createSeriesImpl(r) {
  const res = resById(r.resource_id);
  if (r.kind !== 'block' && r.kind !== 'booking') return err('BAD_REQUEST', 'kind must be block or booking.');
  if (!res) return err('BAD_REQUEST', 'Unknown court.');
  const wd = (Array.isArray(r.weekdays) ? r.weekdays : String(r.weekdays || '').split(',')).map(function (x) { return String(x).trim().slice(0, 3); })
    .filter(function (x, i, arr) { return DAY_NAMES.indexOf(x) >= 0 && arr.indexOf(x) === i; });
  if (!wd.length) return err('BAD_REQUEST', 'Pick at least one weekday.');
  const startDay = String(r.start_date || ''), endDay = String(r.end_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return err('BAD_REQUEST', 'Please pick a start date.');
  if (startDay < todayYmd()) return err('BAD_REQUEST', 'The start date must be today or later.');
  if (endDay && !/^\d{4}-\d{2}-\d{2}$/.test(endDay)) return err('BAD_REQUEST', 'The end date does not look right.');
  if (endDay && endDay < startDay) return err('BAD_REQUEST', 'The end date must be on or after the start date.');
  let startTime, slots;
  if (r.whole_day === true) {
    startTime = pad(SETTINGS.open_hour) + ':00';
    slots = Math.max(1, Math.floor((SETTINGS.close_hour - SETTINGS.open_hour) / res.block_hours));
  } else {
    startTime = String(r.start_time || '');
    slots = Math.max(1, Math.floor(Number(r.slots) || 1));
    if (!/^\d{2}:\d{2}$/.test(startTime)) return err('BAD_REQUEST', 'start_time must look like 08:00.');
    if (!fitsGrid(startDay + 'T' + startTime, rangeEnd(startDay, startTime, slots, res.block_hours))) return err('OUT_OF_WINDOW', 'That time is outside the booking schedule.');
  }
  let any = false;
  for (let i = 0; i < 7; i++) { const d = addDays(startDay, i); if ((!endDay || d <= endDay) && wd.indexOf(DAY_NAMES[dowOf(d)]) >= 0) any = true; }
  if (!any) return err('BAD_REQUEST', 'None of those weekdays falls between the start and end dates.');
  const reason = String(r.reason || r.note || '').trim().slice(0, 120).replace(/^BLOCK/, 'Block').replace(/SERIES:/g, 'Series ');
  seqR++;
  const sr = { series_id: 'R' + ('0000' + seqR).slice(-4), kind: r.kind, resource_id: res.resource_id, weekdays: wd, start_time: startTime, slots: slots, start_date: startDay, end_date: endDay, reason: reason, status: 'Active', skipped: [] };
  SERIES.push(sr);
  const filled = fillSeries();
  return ok({ series: seriesOut(sr), created: filled.created, clashes: filled.clashes });
}
// Splits a series at from_date like the engine's Rec.edit: the old one ends the day before, the not-yet-started dates from
// then on are cancelled, and a new series with the new settings starts on from_date.
function editSeriesImpl(r) {
  const old = SERIES.filter(function (x) { return x.series_id === r.series_id; })[0];
  if (!old) return err('NOT_FOUND', 'That repeating entry could not be found.');
  const from = String(r.from_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return err('BAD_REQUEST', 'Please pick the date the changes start on.');
  if (from < todayYmd()) return err('BAD_REQUEST', 'The changes must start today or later.');
  if (old.status === 'Stopped') return err('BAD_REQUEST', 'That repeating entry is stopped. Create a new one instead.');
  if (old.end_date && old.end_date < from) return err('BAD_REQUEST', 'That repeating entry ends before that date.');
  const res = resById(r.resource_id || old.resource_id);
  if (!res) return err('BAD_REQUEST', 'Unknown court.');
  const wd = (r.weekdays === undefined ? old.weekdays : (Array.isArray(r.weekdays) ? r.weekdays : String(r.weekdays || '').split(',')))
    .map(function (x) { return String(x).trim().slice(0, 3); }).filter(function (x, i, arr) { return DAY_NAMES.indexOf(x) >= 0 && arr.indexOf(x) === i; });
  if (!wd.length) return err('BAD_REQUEST', 'Pick at least one weekday.');
  const endDay = r.end_date === undefined ? old.end_date : String(r.end_date || '');
  if (endDay && endDay < from) return err('BAD_REQUEST', 'The end date must be on or after the start date.');
  let startTime, slots;
  if (r.whole_day === true) {
    startTime = pad(SETTINGS.open_hour) + ':00';
    slots = Math.max(1, Math.floor((SETTINGS.close_hour - SETTINGS.open_hour) / res.block_hours));
  } else {
    startTime = String(r.start_time || old.start_time);
    slots = Math.max(1, Math.floor(Number(r.slots || old.slots) || 1));
    if (!/^\d{2}:\d{2}$/.test(startTime)) return err('BAD_REQUEST', 'start_time must look like 08:00.');
    if (!fitsGrid(from + 'T' + startTime, rangeEnd(from, startTime, slots, res.block_hours))) return err('OUT_OF_WINDOW', 'That time is outside the booking schedule.');
  }
  let any = false;
  for (let i = 0; i < 7; i++) { const d = addDays(from, i); if ((!endDay || d <= endDay) && wd.indexOf(DAY_NAMES[dowOf(d)]) >= 0) any = true; }
  if (!any) return err('BAD_REQUEST', 'None of those weekdays falls between the start and end dates.');
  const reason = (r.reason === undefined ? old.reason : String(r.reason || '').trim().slice(0, 120)).replace(/^BLOCK/, 'Block').replace(/SERIES:/g, 'Series ');
  const nowS = nowLocal(), keep = [];
  bookings.forEach(function (b) {
    if (seriesOf(b) !== old.series_id || !active(b) || b.start.slice(0, 10) < from) return;
    if (b.start <= nowS) { keep.push(b.start.slice(0, 10)); return; } // already started: stays
    b.status = 'Cancelled'; b.cancelled_at = nowS;
  });
  CLASHES.forEach(function (c) { if (c.series_id === old.series_id && c.status === 'Open' && c.date >= from) c.status = 'Expired'; });
  const before = addDays(from, -1);
  if (!old.end_date || old.end_date > before) old.end_date = before;
  if (old.end_date < todayYmd()) old.status = 'Stopped';
  seqR++;
  const sr = { series_id: 'R' + ('0000' + seqR).slice(-4), kind: old.kind, resource_id: res.resource_id, weekdays: wd, start_time: startTime, slots: slots, start_date: from, end_date: endDay, reason: reason, status: 'Active',
    skipped: old.skipped.filter(function (d) { return d >= from; }).concat(keep) };
  SERIES.push(sr);
  const filled = fillSeries();
  return ok({ series: seriesOut(sr), created: filled.created, clashes: filled.clashes });
}
// Returns an error response, or null when the decision was made.
function decideClashImpl(c, decision, v) {
  const sr = SERIES.filter(function (x) { return x.series_id === c.series_id; })[0];
  if (decision !== 'bump' && decision !== 'skip') return err('BAD_REQUEST', 'decision must be bump or skip.');
  if (decision === 'skip') { sr.skipped.push(c.date); c.status = 'Skipped'; return null; }
  const res = resById(sr.resource_id);
  const live = c.booking_ids.map(bookingById).filter(function (b) { return b && active(b); });
  for (let i = 0; i < live.length; i++) {
    const e = cancelBooking({ booking_id: live[i].booking_id, reason: 'The facility needs the court at this time.' }, v);
    if (!e.ok) return e;
  }
  if (!bookings.some(function (b) { return seriesOf(b) === sr.series_id && b.start.slice(0, 10) === c.date; })) addBlock(res, c.start, c.end, occurrenceNotes(sr));
  c.status = 'Bumped';
  return null;
}

// ---- guest invitations (Phase 2C-2) ----
function findShare(shareId) {
  for (let i = 0; i < bookings.length; i++) {
    const p = bookings[i].players.filter(function (x) { return x.share_id === shareId; })[0];
    if (p) return { b: bookings[i], p: p };
  }
  return null;
}

// A declined or removed invite: more than the free-cancel window ahead, the share is dropped and the total is
// split again between the others (paid shares keep their amount); closer than that, the booker just covers it.
function dropInvite(inv, status) {
  inv.status = status;
  inv.share_ids.forEach(function (sid) {
    const hit = findShare(sid);
    if (!hit || !active(hit.b)) return;
    if (hoursUntil(hit.b.start) <= SETTINGS.free_cancel_hours) return;
    hit.p.share_status = 'Declined';
    hit.p.share_amount = 0;
    if (hit.b.pay_mode === 'Split' && hit.b.total_amount > 0) {
      const open = hit.b.players.filter(function (x) { return x.share_status === 'Pending' || x.share_status === 'Unpaid'; });
      const kept = hit.b.players.filter(function (x) { return x.share_status === 'Paid'; }).reduce(function (a, x) { return a + x.share_amount; }, 0);
      const parts = splitShares(Math.max(0, hit.b.total_amount - kept), open.length || 1);
      open.forEach(function (x, i) { x.share_amount = parts[i]; });
    }
  });
}

function removeInvite(r, v) {
  const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
  if (!b) return err('NOT_FOUND', 'We could not find that booking.');
  if (b.booker !== v.member_id) return err('FORBIDDEN', 'Only the person who booked can do that.');
  const inv = inviteById(r.invite_id);
  if (!inv || inv.booker !== v.member_id || !b.players.some(function (x) { return inviteOfPlayer(x) === inv; })) return err('NOT_FOUND', 'That player could not be found.');
  if (inv.status === 'Accepted') return err('BAD_REQUEST', 'That player has already accepted.');
  if (inv.status === 'Invited' || inv.status === 'Withheld') dropInvite(inv, 'Removed');
  return ok({ booking: detail(b, v) });
}

function resendInvite(r, v) {
  const inv = inviteById(r.invite_id);
  if (!inv || inv.booker !== v.member_id) return err('NOT_FOUND', 'That invitation could not be found.');
  if (inv.status !== 'Invited' && inv.status !== 'Withheld') return err('BAD_REQUEST', 'This invitation can no longer be sent again.');
  if (inv.resent_count >= 2 || Date.now() - inv.sent_at < 12 * 3600 * 1000) {
    return err('RATE_LIMITED', 'You can resend this invitation once every 12 hours, up to 2 times.');
  }
  inv.resent_count++;
  inv.sent_at = Date.now();
  logInvite(inv);
  return ok({ sent: true });
}

function inviteItems(inv) {
  return inv.booking_ids.map(function (bid, i) {
    const b = bookings.filter(function (x) { return x.booking_id === bid; })[0];
    const p = b && findShare(inv.share_ids[i]);
    const d = b.start.slice(0, 10);
    const amt = p && p.p.share_status !== 'Waived' && p.p.share_status !== 'Declined' ? p.p.share_amount : 0;
    return {
      booking_id: b.booking_id, resource_name: resById(b.resource_id).name,
      when: dowName(d) + ' ' + monthName(d) + ' ' + dayNum(d) + ', ' + timeRange(b.start, b.end, true),
      share_amount: amt, share_label: amt > 0 ? 'Your share: $' + amt.toFixed(2) : 'No charge', booking_status: b.status,
    };
  });
}

function inviteInfo(t) {
  const m = /^demo-invite-(I\d{5})$/.exec(t);
  const inv = m && inviteById(m[1]);
  const bad = function (state, summary) { return ok({ kind: 'invite', state: state, summary: summary }); };
  if (!inv || inv.status === 'Withheld') return bad('invalid', 'This link is not valid. Please use the link from your most recent email.');
  if (inv.status === 'Accepted') return bad('already', 'You already accepted this invitation. Nothing more is needed.');
  if (inv.status === 'Declined') return bad('already', 'You already declined this invitation. Nothing more is needed.');
  if (inv.status !== 'Invited') return bad('expired', 'This invitation is no longer open.');
  const bk = memById(inv.booker);
  const name = bk.first_name + ' ' + bk.last_name;
  return ok({
    kind: 'invite', state: 'ready', summary: bk.first_name + ' invited you to play at ' + FACILITY,
    invite: { booker_name: name, items: inviteItems(inv), needs_signup: memById(inv.member_id).status === 'Invited', masked_email: maskEmail(inv.email) },
  });
}

function inviteConfirm(r, t) {
  const info = inviteInfo(t).data;
  if (info.state === 'invalid' || info.state === 'expired') return err('BAD_REQUEST', info.summary);
  if (info.state === 'already') return ok({ ok: true, message: info.summary, final: true });
  const inv = inviteById(/^demo-invite-(I\d{5})$/.exec(t)[1]);
  const bk = memById(inv.booker);
  if (r.choice === 'decline') {
    dropInvite(inv, 'Declined');
    return ok({ ok: true, message: "Thanks, we've let " + bk.first_name + ' know.', final: true });
  }
  if (r.choice !== 'accept') return err('BAD_REQUEST', 'Choose Accept or Decline.');
  const m = memById(inv.member_id);
  const owesM = m.status === 'Invited' ? (r.session ? viewer(r.session) : null) : m;
  const owes = owesM ? owedBlock(owesM.member_id).amount : 0;
  if (owes > 0) return err('AMOUNT_OWED', 'Please pay the $' + owes.toFixed(2) + ' you owe first, then accept the invitation.');
  if (m.status === 'Invited') {
    if (r.session) { // "I have an account under a different email": the signed-in member takes the place
      const me = viewer(r.session);
      if (!me) return err('UNAUTHORIZED', 'Please sign in again.');
      const clash = inv.booking_ids.some(function (bid) {
        return bookings.some(function (b) { return b.booking_id === bid && (b.booker === me.member_id || b.players.some(function (p) { return p.member_id === me.member_id; })); });
      });
      if (clash) return err('BAD_REQUEST', 'You are already on this booking.');
      inv.share_ids.forEach(function (sid) { const hit = findShare(sid); if (hit) hit.p.member_id = me.member_id; });
      m.status = 'Merged';
      m.notes = 'Merged into ' + me.member_id + ' (accepted an invitation sent to ' + inv.email + ').';
      inv.member_id = me.member_id;
      inv.status = 'Accepted';
      return ok({ ok: true, message: "You're in! " + bk.first_name + ' can see you on the booking.', final: true });
    }
    const sg = r.signup || {};
    const need = ['first_name', 'last_name', 'phone', 'emergency_contact_name', 'emergency_contact_phone'];
    for (let i = 0; i < need.length; i++) {
      if (!String(sg[need[i]] || '').trim()) return err('BAD_REQUEST', 'Please fill in every field.');
    }
    Object.assign(m, { first_name: sg.first_name.trim(), last_name: sg.last_name.trim(), phone: sg.phone.trim(),
      emergency_contact_name: sg.emergency_contact_name.trim(), emergency_contact_phone: sg.emergency_contact_phone.trim(),
      status: 'Pending', role: 'Guest', created_at: nowLocal() });
    inv.status = 'Accepted';
    return ok({ ok: true, message: "Thanks! The facility owner will review your membership. You'll get an email when it's approved.", final: true });
  }
  inv.status = 'Accepted';
  return ok({ ok: true, message: "You're in! " + bk.first_name + ' can see you on the booking.', final: true });
}

// Sample invitations on Alex's pending booking (Jamie is a member; taylor@example.com is not).
(function seedInvites() {
  const b = bookings.filter(function (x) { return x.booker === 'M0002' && x.status === 'Pending'; })[0];
  if (!b) return;
  [['M0008', 'taylor@example.com'], ['M0003', 'jamie@example.com']].forEach(function (e) {
    const p = b.players.filter(function (x) { return x.member_id === e[0]; })[0];
    seqI++;
    const inv = { invite_id: 'I' + ('00000' + seqI).slice(-5), email: e[1], member_id: e[0], booker: 'M0002', booking_ids: [b.booking_id], share_ids: [p.share_id], status: 'Invited', resent_count: 0, sent_at: Date.now() - 13 * 3600 * 1000 };
    p.invite_id = inv.invite_id;
    invites.push(inv);
    try { console.info('[demo] Sample invitation for ' + e[1] + ': ' + location.origin + location.pathname + location.search + '#/go?t=demo-invite-' + inv.invite_id); } catch (err2) { /* no console */ }
  });
})();

// Repeating owner entries: Court 1 blocked at 10 AM on the weekday of Alex's pending booking, so one clash is waiting for a decision.
seedSeries();
