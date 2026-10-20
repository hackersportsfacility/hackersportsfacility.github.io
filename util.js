// Small DOM + time helpers. Facility times are 'YYYY-MM-DDTHH:mm' local strings (contract section 9).
// They are parsed by splitting; never passed to new Date(string).

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

// Like el.append(...) but skips null/false (native append would print "null").
export function add(el, ...kids) {
  appendKids(el, kids);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---- icons (static strings only) ----
const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.7" cy="6.5" r="1.1"/><circle cx="4.7" cy="12" r="1.1"/><circle cx="4.7" cy="17.5" r="1.1"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8-7.5 9.5-4.4-1.5-7.5-5.1-7.5-9.5V6L12 3z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  person: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c.6-3.6 3.3-5.6 7.2-5.6s6.6 2 7.2 5.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};

export function icon(name, size) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  const s = size || 22;
  span.innerHTML = '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s +
    '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (ICONS[name] || '') + '</svg>';
  return span;
}

// ---- time ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad(n) { return (n < 10 ? '0' : '') + n; }

export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return { y: 0, mo: 1, d: 1, h: 0, mi: 0 };
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0) };
}

export function ymdOf(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
export function todayYmd() { return ymdOf(new Date()); }
export function nowLocal() {
  const d = new Date();
  return ymdOf(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
export function addDays(ymd, n) {
  const p = parseLocal(ymd);
  return ymdOf(new Date(p.y, p.mo - 1, p.d + n));
}
export function dowOf(ymd) {
  const p = parseLocal(ymd);
  return new Date(p.y, p.mo - 1, p.d).getDay();
}
export function dowName(ymd) { return DOW[dowOf(ymd)]; }
export function monthName(ymd) { return MON[parseLocal(ymd).mo - 1]; }
export function dayNum(ymd) { return parseLocal(ymd).d; }
export function mondayOf(ymd) { return addDays(ymd, -((dowOf(ymd) + 6) % 7)); }

function clock(hh, mi, full) {
  const t = (hh % 12 || 12);
  return full || mi ? t + ':' + pad(mi) : String(t);
}
function ap(hh) { return hh % 24 >= 12 ? 'PM' : 'AM'; }

// "8:00–10:00 AM" (full) or "8–10 AM" (short)
export function timeRange(start, end, full) {
  const a = parseLocal(start), b = parseLocal(end);
  const sa = clock(a.h, a.mi, full), sb = clock(b.h, b.mi, full);
  if (ap(a.h) === ap(b.h)) return sa + '–' + sb + ' ' + ap(b.h);
  return sa + ' ' + ap(a.h) + '–' + sb + ' ' + ap(b.h);
}
export function fmtDay(s) {
  const p = parseLocal(s);
  return DOW[dowOf(s)] + ', ' + MON[p.mo - 1] + ' ' + p.d;
}
// "Sat, Oct 24 · 8:00–10:00 AM"
export function fmtRange(start, end) {
  return fmtDay(start) + ' · ' + timeRange(start, end, true);
}
export function hoursUntil(start) {
  const p = parseLocal(start);
  return (new Date(p.y, p.mo - 1, p.d, p.h, p.mi).getTime() - Date.now()) / 3600000;
}

export function money(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2);
}

export function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }
export function fullName(p) { return ((p && p.first_name) || '') + ' ' + ((p && p.last_name) || ''); }
