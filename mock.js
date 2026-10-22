// In-memory fake of the booking engine (docs/phase1-api-contract.md). Demo mode only.
// Sign in with any email (alex@example.com = member (slot limit 1), priya@example.com = member (slot limit 3), jordan@example.com = family, anything else = owner). Code: 123456.
import { pad, todayYmd, addDays, nowLocal, mondayOf, parseLocal, dowName, monthName, dayNum, timeRange } from './util.js';

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
let seqM = 7, seqB = 0, seqS = 0;

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
];

const bookings = [];
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
      if (priv) return { share_id: sid, member_id: id, share_amount: 0, share_status: 'Waived' };
      return { share_id: sid, member_id: id, share_amount: shares[i] == null ? 0 : shares[i], share_status: shares[i] == null ? '' : 'Pending' };
    }),
    created_at: o.created_at || now0,
  };
  bookings.push(b);
  return b;
}

// ---- seed data, relative to today ----
addBooking({ resource_id: 'COURT2', start: dayAt(1, 18), status: 'Approved', booker: 'M0002', guests: ['M0001', 'M0003'] });
addBooking({ resource_id: 'COURT1', start: dayAt(3, 10), status: 'Pending', booker: 'M0002', guests: ['M0003', 'M0005'] });
addBooking({ resource_id: 'COURT1', start: dayAt(4, 12), status: 'Approved', booker: 'M0001', guests: ['M0002'] });
addBooking({ resource_id: 'COURT1', start: dayAt(0, 20), status: 'Approved', booker: 'M0004', guests: ['M0003'] });
addBooking({ resource_id: 'COURT1', start: dayAt(1, 8), status: 'Approved', booker: 'M0004', guests: [] });
addBooking({ resource_id: 'BOTH', start: dayAt(2, 14), status: 'Approved', booker: 'M0004', guests: ['M0003', 'M0001'] });
addBooking({ resource_id: 'COURT2', start: dayAt(5, 16), status: 'Approved', booker: 'M0003', guests: ['M0004'] });
addBooking({ resource_id: 'COURT1', start: dayAt(-2, 10), status: 'Completed', booker: 'M0002', guests: ['M0001', 'M0004'] });
addBooking({ resource_id: 'COURT2', start: dayAt(-5, 16), status: 'Completed', booker: 'M0002', guests: ['M0003'] });
addBooking({ resource_id: 'COURT2', start: dayAt(-3, 8), status: 'Cancelled', booker: 'M0002', guests: [], notes: '' });
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

function detail(b, v, withContact) {
  const bk = memById(b.booker);
  const owner = v && v.role === 'Owner';
  const out = {
    booking_id: b.booking_id, status: b.status, resource_id: b.resource_id,
    resource_name: resById(b.resource_id).name, start: b.start, end: b.end, pay_mode: b.pay_mode,
    total_amount: b.total_amount, is_booker: !!v && b.booker === v.member_id,
    booker: { first_name: bk.first_name, last_name: bk.last_name },
    players: b.players.map(function (p) {
      const m = memById(p.member_id);
      const o = { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, status: m.status, share_amount: p.share_amount, share_status: p.share_status };
      if (v && p.member_id === v.member_id) { // only the viewer's own share exposes its id
        o.share_id = p.share_id;
        o.can_pay = (p.share_status === 'Pending' || p.share_status === 'Unpaid') && p.share_amount > 0 && active(b);
      }
      return o;
    }),
    late_cancel: /LATE_CANCEL/.test(b.notes),
    can_cancel: active(b) && b.start > nowLocal() && !!v && (b.booker === v.member_id || !!owner),
  };
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
      case 'acceptTerms': return acceptTerms(req, v);
      case 'startCardSetup': return startCardSetup(req, v);
      case 'confirmCardSetup': return confirmCardSetup(req, v);
      case 'removeCard': return removeCard(req, v);
      case 'payShare': return payShare(req, v);
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
  ['demo-booking-reject', 'Booking request: reject'],
  ['demo-member-approve', 'New member: approve'],
  ['demo-member-reject', 'New member: reject'],
  ['demo-guardian-sign', 'Parent or guardian: sign'],
  ['demo-expired', 'Expired link'],
  ['demo-bogus', 'Invalid link'],
];
const linkDone = {};
function linkParts(t) {
  const m = /^demo-(booking|member|guardian)-(approve|reject|sign)$/.exec(String(t || ''));
  return m ? { kind: m[1], d: m[2] } : null;
}
function linkInfo(r) {
  const t = String(r.t || '');
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
      summary: (p.d === 'reject' ? 'Reject ' : 'Approve ') + resById(b.resource_id).name + ', ' + dowName(day) + ' ' + monthName(day) + ' ' + dayNum(day) + ', ' + timeRange(b.start, b.end, true) + ' for ' + bk.first_name + ' ' + bk.last_name + '?',
      details: [
        { label: 'Players', value: b.players.map(function (x) { const m = memById(x.member_id); return m.first_name + ' ' + m.last_name; }).join(', ') },
        { label: 'Price', value: '$' + b.total_amount.toFixed(2) },
      ],
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
  const info = linkInfo({ t: t }).data;
  if (info.state === 'invalid' || info.state === 'expired') return err('BAD_REQUEST', info.summary);
  if (info.state === 'already') return ok({ ok: true, message: info.summary, final: true });
  if (info.kind === 'guardian') {
    if (!String(r.name || '').trim()) return err('BAD_REQUEST', 'Please type your full legal name to sign.');
    linkDone[t] = true;
    return ok({ ok: true, message: "Thank you. The agreement is signed and Riley's waiver is on file.", final: true });
  }
  linkDone[t] = true;
  const approve = info.d === 'approve';
  if (info.kind === 'booking') {
    const b = bookings.filter(function (x) { return x.status === 'Pending'; })[0];
    b.status = approve ? 'Approved' : 'Rejected';
    return ok({ ok: true, message: approve ? 'Approved. The booker has been emailed.' : 'Rejected. The booker has been emailed.', final: true });
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
  if (!m) return ok({ sent: true });
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
      const start = date + 'T' + pad(h) + ':00', end = endOf(start), slots = {};
      visible.forEach(function (res) {
        let st = 'free';
        if (start <= nowS) st = 'past';
        else {
          bookings.forEach(function (b) {
            if (!active(b) || !conflicts(b.resource_id, res.resource_id) || !overlaps(b, { start: start, end: end })) return;
            const mineB = b.resource_id === res.resource_id && (b.booker === v.member_id || b.players.some(function (p) { return p.member_id === v.member_id; }));
            if (mineB) st = 'mine';
            else if (st !== 'mine') st = 'busy';
          });
        }
        slots[res.resource_id] = st;
      });
      blocks.push({ start: start, end: end, slots: slots });
    }
    days.push({ date: date, blocks: blocks });
  }
  return ok({ days: days });
}

function createBooking(r, v) {
  if (!termsStatus(v).accepted) return err('TERMS_REQUIRED', 'Please read and accept the Booking and Payment Terms before booking. You can do this from the Account screen.');
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
  const ids = [v.member_id].concat(createGuests(gr.list, v));
  const b = addBooking({ resource_id: res.resource_id, start: r.start, status: v.role === 'Family' ? 'Pending' : (priv ? 'Approved' : 'Pending'), booker: v.member_id, guests: ids.slice(1), pay_mode: priv ? 'BookerPays' : payMode });
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
  f.p.share_status = 'Paid';
  if (v.card) return ok({ paid: true, share: { share_id: f.p.share_id, share_status: 'Paid' } });
  return ok({ url: null, mock_paid: true, paid: true });
}
function confirmPayment(r, v) {
  if (!r.cs) return err('BAD_REQUEST', 'Missing payment session.');
  return ok({ share: null });
}

// Validates guests without creating anyone. Returns { list } or { error }.
function checkGuests(input, v, maxPlayers) {
  const guests = Array.isArray(input) ? input : [];
  if (1 + guests.length > maxPlayers) return { error: err('TOO_MANY_PLAYERS', 'This booking allows up to ' + maxPlayers + ' players.') };
  const emails = [v.email.toLowerCase()], list = [];
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    const m = g.member_id ? memById(g.member_id) : memByEmail(g.email);
    if (g.member_id && (!m || m.status !== 'Active')) return { error: err('BAD_REQUEST', 'One of the players could not be found.') };
    if (!m) {
      if (!g.first_name || !g.last_name || !g.email || !g.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) {
        return { error: err('BAD_REQUEST', 'Each new guest needs a first name, last name, email and mobile number.') };
      }
    } else if (m.status === 'Suspended' || m.status === 'Revoked') {
      return { error: err('FORBIDDEN', m.first_name + ' ' + m.last_name + ' cannot be added as a player right now.') };
    }
    const em = (m ? m.email : g.email).trim().toLowerCase();
    if (emails.indexOf(em) !== -1) return { error: err('BAD_REQUEST', 'The same person is listed twice.') };
    emails.push(em);
    list.push(m || g);
  }
  return { list: list };
}

// Creates Pending guest members for new people; returns every guest's member_id.
function createGuests(list, v) {
  return list.map(function (m) {
    if (m.member_id) return m.member_id;
    seqM++;
    const nm = member('M' + ('0000' + seqM).slice(-4), m.first_name.trim(), m.last_name.trim(), m.email.trim(), 'Guest', 'Pending',
      { phone: m.phone, invited_by_member_id: v.member_id, approved_at: '', created_at: nowLocal() });
    members.push(nm);
    return nm.member_id;
  });
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
  const guestIds = createGuests(gr.list, v);
  const status = v.role === 'Family' ? 'Pending' : (priv ? 'Approved' : 'Pending');
  const made = merged.map(function (s) {
    return addBooking({ resource_id: s.resource_id, start: s.start, end: s.end, status: status, booker: v.member_id, guests: guestIds, pay_mode: priv ? 'BookerPays' : payMode, notes: r.note || '' });
  });
  return ok({ bookings: made.map(function (b) { return detail(b, v); }) });
}

function mine(b, v) { return b.booker === v.member_id || b.players.some(function (p) { return p.member_id === v.member_id; }); }

function myBookings(r, v) {
  const nowS = nowLocal();
  let list = bookings.filter(function (b) { return mine(b, v) && (r.include_past ? true : b.start >= nowS); });
  list.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  return ok({ bookings: list.map(function (b) { return detail(b, v); }) });
}

function cancelBooking(r, v) {
  const b = bookings.filter(function (x) { return x.booking_id === r.booking_id; })[0];
  if (!b) return err('NOT_FOUND', 'We could not find that booking.');
  if (b.booker !== v.member_id && v.role !== 'Owner') return err('FORBIDDEN', 'Only the person who booked can cancel.');
  if (b.start <= nowLocal() || !active(b)) return err('FORBIDDEN', 'This booking can no longer be cancelled.');
  b.status = 'Cancelled';
  b.cancelled_at = nowLocal();
  const hrs = (function () { const p = parseLocal(b.start); return (new Date(p.y, p.mo - 1, p.d, p.h, p.mi).getTime() - Date.now()) / 3600000; })();
  if (hrs < SETTINGS.free_cancel_hours && v.role !== 'Owner') b.notes += ' LATE_CANCEL';
  return ok({ booking: detail(b, v) });
}

function knownPlayers(v) {
  const ids = {};
  bookings.forEach(function (b) {
    if (!mine(b, v)) return;
    b.players.forEach(function (p) { if (p.member_id !== v.member_id) ids[p.member_id] = true; });
  });
  (played[v.member_id] || []).forEach(function (id) { ids[id] = true; });
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
    if (r.decision !== 'approve' && r.decision !== 'reject') return err('BAD_REQUEST', 'Decision must be approve or reject.');
    if (b.status !== 'Pending') return err('BAD_REQUEST', 'That booking has already been decided.');
    b.status = r.decision === 'approve' ? 'Approved' : 'Rejected';
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
  if (a === 'ownerMembers') {
    return ok(members.filter(function (m) { return !r.status || m.status === r.status; }));
  }
  if (a === 'ownerBlockTime') {
    const res = resById(r.resource_id);
    if (!res || !r.start) return err('BAD_REQUEST', 'Pick a court, day and time.');
    if (!isOnGrid(r.start) || r.start <= nowLocal()) return err('OUT_OF_WINDOW', 'That time is outside the booking blocks.');
    const end = endOf(r.start);
    if (bookings.some(function (b) { return active(b) && conflicts(b.resource_id, res.resource_id) && overlaps(b, { start: r.start, end: end }); })) {
      return err('SLOT_TAKEN', 'Something is already booked at that time.');
    }
    const b = addBooking({ resource_id: res.resource_id, start: r.start, status: 'Approved', booker: v.member_id, guests: [], notes: r.note || 'BLOCK' });
    return ok({ booking: detail(b, v) });
  }
  return err('BAD_REQUEST', 'Unknown action: ' + a);
}
