// In-memory fake of the booking engine (docs/phase1-api-contract.md). Demo mode only.
// Sign in with any email (alex@example.com = regular member, anything else = owner). Code: 123456.
import { pad, todayYmd, addDays, nowLocal, mondayOf, parseLocal } from './util.js';

const FACILITY = 'Hacker Sports Facility';
const SETTINGS = { open_hour: 6, close_hour: 22, block_hours: 2, max_players_per_court: 4, free_cancel_hours: 24 };
const WEEKLY_LIMIT = 3;
const BOOK_AHEAD = 7;

const RESOURCES = [
  { resource_id: 'COURT1', name: 'Court 1', block_hours: 2, rate_per_hour: 20, courts: 1 },
  { resource_id: 'COURT2', name: 'Court 2', block_hours: 2, rate_per_hour: 20, courts: 1 },
  { resource_id: 'BOTH', name: 'Both Courts', block_hours: 2, rate_per_hour: 40, courts: 2 },
];

const now0 = nowLocal();
let seqM = 6, seqB = 0, seqS = 0;

function member(id, first, last, email, role, status, extra) {
  return Object.assign({
    member_id: id, status: status, role: role, first_name: first, last_name: last, email: email,
    phone: '555-010' + id.slice(-1), emergency_contact_name: 'Pat ' + last, emergency_contact_phone: '555-0199',
    is_minor: false, date_of_birth: '', guardian_name: '', guardian_email: '', invited_by_member_id: '',
    weekly_limit_override: '', book_ahead_override: '', auto_approve: false, credit_balance: 0, strike_count: 0,
    waiver_version_signed: role === 'Owner' ? 1 : (id === 'M0003' ? 0 : 1),
    // Alex (M0002) starts without accepting the Booking Terms, to demo the scroll-and-accept flow.
    booking_terms_version: id === 'M0002' ? 0 : 1, booking_terms_accepted_at: id === 'M0002' ? '' : addDays(todayYmd(), -29) + 'T09:05',
    created_at: addDays(todayYmd(), -30) + 'T09:00',
    approved_at: addDays(todayYmd(), -29) + 'T09:00', notes: '',
  }, extra || {});
}

const members = [
  member('M0001', 'Ryan', 'Hacker', 'ryan@example.com', 'Owner', 'Active'),
  member('M0002', 'Alex', 'Smith', 'alex@example.com', 'Member', 'Active'),
  member('M0003', 'Jamie', 'Lee', 'jamie@example.com', 'Member', 'Active'),
  member('M0004', 'Priya', 'Patel', 'priya@example.com', 'Member', 'Active'),
  member('M0005', 'Sam', 'Rivera', 'sam@example.com', 'Guest', 'Pending', { invited_by_member_id: 'M0002', approved_at: '' }),
  member('M0006', 'Chris', 'Wong', 'chris@example.com', 'Member', 'Suspended'),
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

function addBooking(o) {
  const res = resById(o.resource_id);
  const owner = memById(o.booker) .role === 'Owner';
  const total = owner ? 0 : res.rate_per_hour * res.block_hours;
  const ids = [o.booker].concat(o.guests || []);
  const shares = o.pay_mode === 'BookerPays' ? [total] : splitShares(total, ids.length);
  seqB++;
  const b = {
    booking_id: 'B' + ('00000' + seqB).slice(-5), status: o.status, resource_id: o.resource_id,
    start: o.start, end: endOf(o.start), pay_mode: o.pay_mode || 'Split', total_amount: total,
    booker: o.booker, notes: o.notes || '', cancelled_at: '',
    players: ids.map(function (id, i) {
      seqS++;
      return { member_id: id, share_amount: shares[i] == null ? 0 : shares[i], share_status: shares[i] == null ? '' : 'Pending' };
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

// ---- helpers ----
function err(code, message) { return { ok: false, error: { code: code, message: message } }; }
function ok(data) { return { ok: true, data: data }; }
const active = function (b) { return b.status === 'Pending' || b.status === 'Approved'; };
const conflicts = function (a, b) { return a === b || a === 'BOTH' || b === 'BOTH'; };
const overlaps = function (a, b) { return a.start < b.end && a.end > b.start; };
const summary = function (m) {
  return { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, email: m.email, role: m.role, status: m.status, is_owner: m.role === 'Owner' };
};

function viewer(token) {
  const m = /^mock-(M\d{4})$/.exec(token || '');
  const mem = m && memById(m[1]);
  return mem && mem.status === 'Active' ? mem : null;
}

export function switchUser(token) {
  return token === 'mock-M0002' ? 'mock-M0001' : 'mock-M0002';
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
      return { member_id: m.member_id, first_name: m.first_name, last_name: m.last_name, status: m.status, share_amount: p.share_amount, share_status: p.share_status };
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
  }).length;
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

    const v = viewer(req.token);
    if (!v) return err('UNAUTHORIZED', 'Please sign in again.');
    switch (a) {
      case 'me': return me(v);
      case 'resources': return ok(RESOURCES.slice());
      case 'availability': return availability(req, v);
      case 'createBooking': return createBooking(req, v);
      case 'myBookings': return myBookings(req, v);
      case 'cancelBooking': return cancelBooking(req, v);
      case 'knownPlayers': return knownPlayers(v);
      case 'acceptTerms': return acceptTerms(req, v);
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
  const m = memByEmail(r.email);
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
    accepted: v.role === 'Owner' || v.booking_terms_version >= TERMS_VERSION,
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

function me(v) {
  const t = todayYmd(), ws = mondayOf(t);
  return ok({
    member: summary(v),
    week: { used: weekCount(v.member_id, t), limit: WEEKLY_LIMIT, week_start: ws, week_end: addDays(ws, 6) },
    book_ahead_days: BOOK_AHEAD,
    waiver_on_file: v.waiver_version_signed >= 1,
    waiver_form_url: 'https://example.com/waiver-demo',
    terms: termsStatus(v),
    settings: Object.assign({}, SETTINGS),
  });
}

function availability(r, v) {
  const from = r.from || todayYmd();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return err('BAD_REQUEST', 'Invalid date.');
  const n = r.days == null ? BOOK_AHEAD + 1 : Number(r.days);
  if (!(n >= 1 && n <= 14)) return err('BAD_REQUEST', 'days must be between 1 and 14.');
  const nowS = nowLocal(), days = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i), blocks = [];
    for (let h = SETTINGS.open_hour; h + SETTINGS.block_hours <= SETTINGS.close_hour; h += SETTINGS.block_hours) {
      const start = date + 'T' + pad(h) + ':00', end = endOf(start), slots = {};
      RESOURCES.forEach(function (res) {
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
  const res = resById(r.resource_id);
  if (!res || !r.start) return err('BAD_REQUEST', 'Missing or invalid booking details.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.start)) return err('BAD_REQUEST', 'Invalid start time.');
  const payMode = r.pay_mode || 'Split';
  if (payMode !== 'Split' && payMode !== 'BookerPays') return err('BAD_REQUEST', 'Invalid pay mode.');
  const owner = v.role === 'Owner';
  if (!isOnGrid(r.start)) return err('OUT_OF_WINDOW', 'That time is outside the booking blocks.');
  if (r.start <= nowLocal()) return err('OUT_OF_WINDOW', 'That time has already passed.');
  if (!owner && r.start.slice(0, 10) > addDays(todayYmd(), BOOK_AHEAD)) return err('OUT_OF_WINDOW', 'You can book up to ' + BOOK_AHEAD + ' days ahead.');
  const end = endOf(r.start);
  const clash = bookings.some(function (b) { return active(b) && conflicts(b.resource_id, res.resource_id) && overlaps(b, { start: r.start, end: end }); });
  if (clash) return err('SLOT_TAKEN', 'Sorry, that time was just booked by someone else.');
  if (!owner && weekCount(v.member_id, r.start.slice(0, 10)) >= WEEKLY_LIMIT) {
    return err('LIMIT_REACHED', 'You have used all ' + WEEKLY_LIMIT + ' bookings for that week.');
  }
  const guests = Array.isArray(r.guests) ? r.guests : [];
  if (1 + guests.length > SETTINGS.max_players_per_court * res.courts) {
    return err('TOO_MANY_PLAYERS', 'This booking allows up to ' + (SETTINGS.max_players_per_court * res.courts) + ' players.');
  }
  const ids = [v.member_id], emails = [v.email.toLowerCase()], created = [];
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    let m = g.member_id ? memById(g.member_id) : memByEmail(g.email);
    if (g.member_id && (!m || m.status !== 'Active')) return err('BAD_REQUEST', 'One of the players could not be found.');
    if (!m) {
      if (!g.first_name || !g.last_name || !g.email || !g.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) {
        return err('BAD_REQUEST', 'Each new guest needs a first name, last name, email and mobile number.');
      }
    } else if (m.status === 'Suspended' || m.status === 'Revoked') {
      return err('FORBIDDEN', m.first_name + ' ' + m.last_name + ' cannot be added as a player right now.');
    }
    const em = (m ? m.email : g.email).trim().toLowerCase();
    if (emails.indexOf(em) !== -1) return err('BAD_REQUEST', 'The same person is listed twice.');
    emails.push(em);
    created.push(m || g);
  }
  created.forEach(function (m, i) {
    if (!m.member_id) {
      seqM++;
      const nm = member('M' + ('0000' + seqM).slice(-4), m.first_name.trim(), m.last_name.trim(), m.email.trim(), 'Guest', 'Pending',
        { phone: m.phone, invited_by_member_id: v.member_id, approved_at: '', created_at: nowLocal() });
      members.push(nm);
      m = nm;
    }
    ids.push(m.member_id);
  });
  const b = addBooking({ resource_id: res.resource_id, start: r.start, status: owner ? 'Approved' : 'Pending', booker: v.member_id, guests: ids.slice(1), pay_mode: payMode });
  return ok({ booking: detail(b, v) });
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
