const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const seed = require('./seed');

// ---- tiny .env loader (no extra dependency)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch (_) {}

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const OUTBOX = path.join(DATA_DIR, 'outbox.log');
const TZ_OFFSET = '-07:00'; // Pacific Daylight Time in July

// ---- storage
fs.mkdirSync(DATA_DIR, { recursive: true });
let db;
function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    let changed = false;
    db.tasks.forEach((t) => { if (!t.startDate) { const d = db.days.find((x) => x.key === t.day); t.startDate = d ? d.date : (t.eta || '').slice(0, 10); changed = true; } });
    if (changed) save();
    return;
  }
  db = {
    days: seed.days, venues: seed.venues,
    milestones: seed.milestones.map((m) => ({ id: uid(), ...m })),
    tasks: seed.tasks.map((t) => ({ id: uid(), sentReminders: [], createdAt: new Date().toISOString(), startDate: t.eta.slice(0, 10), ...t })),
    settings: { reminderHours: [24, 2], overdueReminder: true },
  };
  save();
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function uid() { return crypto.randomBytes(6).toString('hex'); }
load();

// ---- email
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const venueName = (id) => (db.venues.find((v) => v.id === id) || {}).name || id;
const dayLabel = (k) => { const d = db.days.find((x) => x.key === k); return d ? `${d.label} (${d.short})` : k; };
const fmtEta = (eta) => new Date(eta + TZ_OFFSET).toLocaleString('en-US', {
  timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) + ' PT';

function recipients(t) {
  const list = [];
  if (t.leadEmail) list.push({ name: t.leadName, email: t.leadEmail });
  (t.team || []).forEach((p) => p.email && list.push(p));
  const seen = new Set();
  return list.filter((p) => !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase()));
}

async function sendReminder(t, kind) {
  const to = recipients(t);
  if (!to.length) return { sent: 0, reason: 'No email addresses on this task' };
  const subject = `[NABC 2027] ${kind === 'overdue' ? 'OVERDUE' : 'Reminder'}: ${t.title} — ETA ${fmtEta(t.eta)}`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;border:1px solid #e5dcc8;border-radius:12px;overflow:hidden">
    <div style="background:#272974;color:#fff;padding:16px 20px"><b style="color:#F5A623">NABC 2027</b> · Program Planner</div>
    <div style="padding:20px;color:#1d1d3a">
      <h2 style="margin:0 0 8px;font-family:Georgia,serif">${esc(t.title)}</h2>
      <p style="margin:0 0 12px;color:${kind === 'overdue' ? '#A3241B' : '#555'}">${kind === 'overdue' ? 'This task is past its ETA and not marked done.' : 'This task is coming due.'}</p>
      <table cellpadding="4" style="font-size:14px">
        <tr><td><b>Starts</b></td><td>${esc(fmtEta(`${t.startDate}T${t.startTime}`))}</td></tr>
        <tr><td><b>Ends (ETA)</b></td><td>${esc(fmtEta(t.eta))}</td></tr>
        <tr><td><b>Day</b></td><td>${esc(dayLabel(t.day))}</td></tr>
        <tr><td><b>Venue</b></td><td>${esc(venueName(t.venue))}, Cow Palace</td></tr>
        <tr><td><b>Status</b></td><td>${esc(t.status)}</td></tr>
        <tr><td><b>Lead POC</b></td><td>${esc(t.leadName)} ${esc(t.leadPhone)}</td></tr>
      </table>
      <p style="margin-top:16px"><a href="${esc(APP_URL)}" style="background:#F5A623;color:#272974;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600">Open planner</a></p>
    </div></div>`;
  const text = `${t.title}\nETA: ${fmtEta(t.eta)}\nVenue: ${venueName(t.venue)}\nStatus: ${t.status}\nLead: ${t.leadName} ${t.leadPhone}\n${APP_URL}`;
  const entry = `[${new Date().toISOString()}] ${smtpConfigured ? 'SENT' : 'DRY-RUN (SMTP not configured)'} to ${to.map((p) => p.email).join(', ')} | ${subject}\n`;
  fs.appendFileSync(OUTBOX, entry);
  if (!transporter) return { sent: 0, dryRun: true, to: to.map((p) => p.email) };
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: to.map((p) => `${p.name || ''} <${p.email}>`).join(', '),
    subject, html, text,
  });
  return { sent: to.length, to: to.map((p) => p.email) };
}

// ---- reminder scheduler: runs every minute
async function checkReminders() {
  const now = Date.now();
  for (const t of db.tasks) {
    if (t.status === 'done' || !t.eta || !recipients(t).length) continue;
    t.sentReminders = t.sentReminders || [];
    const eta = new Date(t.eta + TZ_OFFSET).getTime();
    const hours = (t.reminderHours && t.reminderHours.length ? t.reminderHours : db.settings.reminderHours)
      .map(Number).sort((a, b) => b - a);
    // The smallest window already passed is the only one worth sending (skip stale backlog).
    const due = hours.filter((h) => now >= eta - h * 3600e3 && now < eta && !t.sentReminders.includes(`h${h}`));
    if (due.length) {
      const key = `h${due[due.length - 1]}`;
      try { await sendReminder(t, 'upcoming'); due.forEach((h) => t.sentReminders.push(`h${h}`)); void key; save(); }
      catch (e) { console.error('Reminder failed', t.title, e.message); }
    } else if (db.settings.overdueReminder && now > eta && !t.sentReminders.includes('overdue') && now - eta < 24 * 3600e3) {
      try { await sendReminder(t, 'overdue'); t.sentReminders.push('overdue'); save(); }
      catch (e) { console.error('Overdue reminder failed', t.title, e.message); }
    }
  }
}
setInterval(() => checkReminders().catch(console.error), 60 * 1000);
setTimeout(() => checkReminders().catch(console.error), 5000);

// ---- API
const app = express();
const PROD = process.env.NODE_ENV === 'production';
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));

// ---- Authentication: email one-time code, restricted to admins + lead POC emails
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!ADMINS.length) console.warn('WARNING: ADMIN_EMAILS is empty — nobody can log in. Set ADMIN_EMAILS in .env');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL = 12 * 3600e3, CODE_TTL = 10 * 60e3;
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (_) {}
const saveSessions = () => fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions), { mode: 0o600 });
const codes = new Map(); // email -> {hash, exp, tries}
const hits = new Map();  // rate limit buckets
function limited(key, max, windowMs) {
  const now = Date.now(); const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  h.push(now); hits.set(key, h); return h.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
  for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  let ch = false; for (const k in sessions) if (sessions[k].exp < now) { delete sessions[k]; ch = true; } if (ch) saveSessions(); }, 5 * 60e3).unref();

const isAdmin = (e) => ADMINS.includes(e);
const isLead = (e) => db.tasks.some((t) => (t.leadEmail || '').toLowerCase() === e);
const roleOf = (e) => (isAdmin(e) ? 'admin' : isLead(e) ? 'lead' : null);
const normEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 200);

function parseCookies(req) {
  const o = {}; (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function setCookie(res, val, maxAge) {
  res.append('Set-Cookie', `nabc_sid=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${PROD || process.env.COOKIE_SECURE ? '; Secure' : ''}`);
}
function sessionOf(req) {
  const tok = parseCookies(req).nabc_sid; if (!tok) return null;
  const s = sessions[sha(tok)]; if (!s || s.exp < Date.now()) return null;
  const role = roleOf(s.email); if (!role) return null; // access revoked when email is no longer admin/lead
  return { email: s.email, role, id: sha(tok) };
}
// CSRF: state-changing requests must be JSON from same origin
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  }
  next();
});

app.post('/api/auth/request', async (req, res) => {
  const email = normEmail(req.body.email);
  const generic = { ok: true, message: 'If this email is authorised, a login code has been sent.' };
  if (limited('ip:' + req.ip, 20, 15 * 60e3) || limited('em:' + email, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleOf(email)) return res.json(generic); // do not reveal who is authorised
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  codes.set(email, { hash: sha(email + ':' + code), exp: Date.now() + CODE_TTL, tries: 0 });
  try {
    if (transporter) {
      await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: email, subject: 'Your NABC 2027 planner login code',
        text: `Your login code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
        html: `<p>Your NABC 2027 planner login code:</p><p style="font:700 28px monospace;letter-spacing:4px">${code}</p><p>Expires in 10 minutes. If you did not request it, ignore this email.</p>` });
    } else if (!PROD) console.log(`[DEV ONLY] login code for ${email}: ${code}`);
    else console.error('SMTP not configured in production — cannot send login codes');
  } catch (e) { console.error('Login email failed:', e.message); }
  res.json(generic);
});

app.post('/api/auth/verify', (req, res) => {
  const email = normEmail(req.body.email), code = String(req.body.code || '').trim();
  if (limited('v:' + req.ip, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const c = codes.get(email);
  const fail = () => res.status(401).json({ error: 'Invalid or expired code' });
  if (!c || c.exp < Date.now() || !roleOf(email)) return fail();
  if (++c.tries > 5) { codes.delete(email); return fail(); }
  const a = Buffer.from(c.hash), b = Buffer.from(sha(email + ':' + code));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail();
  codes.delete(email);
  const tok = crypto.randomBytes(32).toString('hex');
  sessions[sha(tok)] = { email, exp: Date.now() + SESSION_TTL }; saveSessions();
  setCookie(res, tok, SESSION_TTL / 1000);
  console.log(`Login: ${email} (${roleOf(email)})`);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const tok = parseCookies(req).nabc_sid; if (tok) { delete sessions[sha(tok)]; saveSessions(); }
  setCookie(res, '', 0); res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => { const s = sessionOf(req); res.json(s ? { email: s.email, role: s.role } : { email: null }); });

// everything below requires a valid session
app.use('/api', (req, res, next) => {
  const s = sessionOf(req); if (!s) return res.status(401).json({ error: 'Login required' });
  req.user = s; next();
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const ownsTask = (u, t) => u.role === 'admin' || (t.leadEmail || '').toLowerCase() === u.email;

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
function cleanTask(b, existing = {}) {
  const t = { ...existing };
  const str = (k, max = 500) => { if (b[k] !== undefined) t[k] = String(b[k]).trim().slice(0, max); };
  ['title', 'description', 'day', 'startDate', 'startTime', 'eta', 'venue', 'category', 'priority', 'leadName', 'leadEmail', 'leadPhone', 'notes']
    .forEach((k) => str(k, k === 'description' || k === 'notes' ? 4000 : 300));
  if (b.status !== undefined && STATUSES.includes(b.status)) t.status = b.status;
  if (Array.isArray(b.team)) {
    t.team = b.team.filter((p) => p && (p.name || p.email)).slice(0, 50)
      .map((p) => ({ name: String(p.name || '').trim().slice(0, 120), email: String(p.email || '').trim().slice(0, 200), phone: String(p.phone || '').trim().slice(0, 40) }));
  }
  if (Array.isArray(b.reminderHours)) t.reminderHours = b.reminderHours.map(Number).filter((n) => n > 0 && n < 24 * 30);
  return t;
}
function checkDates(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '') || !/^\d{2}:\d{2}$/.test(t.startTime || '')) return 'Start date and time are required';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.eta || '')) return 'End date and time are required';
  if (t.eta < `${t.startDate}T${t.startTime}`) return 'End must be after start';
  const d = db.days.find((x) => x.date === t.startDate);
  if (!d) return 'Start date must be one of the event days (Jul 1–5, 2027)';
  t.day = d.key; return null;
}
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

app.get('/api/state', (req, res) => res.json({ ...db, smtpConfigured: req.user.role === 'admin' ? smtpConfigured : undefined, appUrl: APP_URL, me: { email: req.user.email, role: req.user.role } }));

app.post('/api/tasks', adminOnly, (req, res) => {
  const t = cleanTask(req.body, { status: 'todo', team: [], sentReminders: [], priority: 'medium', reminderHours: [] });
  if (!t.title) return res.status(400).json({ error: 'Title is required' });
  const de = checkDates(t); if (de) return res.status(400).json({ error: de });
  if (!emailOk(t.leadEmail) || (t.team || []).some((p) => !emailOk(p.email))) return res.status(400).json({ error: 'Invalid email address' });
  t.id = uid(); t.createdAt = new Date().toISOString();
  db.tasks.push(t); save(); res.json(t);
});

app.put('/api/tasks/:id', (req, res) => {
  const i = db.tasks.findIndex((t) => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  const old = db.tasks[i];
  if (!ownsTask(req.user, old)) return res.status(403).json({ error: 'You can only update tasks you lead' });
  // leads may only change status and notes of their own tasks
  const body = req.user.role === 'admin' ? req.body : { status: req.body.status, notes: req.body.notes };
  if (req.user.role !== 'admin') Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  const t = cleanTask(body, old);
  if (!t.title) return res.status(400).json({ error: 'Title is required' });
  const de = checkDates(t); if (de) return res.status(400).json({ error: de });
  if (!emailOk(t.leadEmail) || (t.team || []).some((p) => !emailOk(p.email))) return res.status(400).json({ error: 'Invalid email address' });
  if (t.eta !== old.eta || JSON.stringify(t.reminderHours) !== JSON.stringify(old.reminderHours)) t.sentReminders = []; // re-arm
  db.tasks[i] = t; save(); res.json(t);
});

app.delete('/api/tasks/:id', adminOnly, (req, res) => {
  db.tasks = db.tasks.filter((t) => t.id !== req.params.id); save(); res.json({ ok: true });
});

app.post('/api/tasks/:id/remind', async (req, res) => {
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!ownsTask(req.user, t)) return res.status(403).json({ error: 'Not allowed' });
  if (limited('rem:' + t.id, 5, 3600e3)) return res.status(429).json({ error: 'Too many reminders for this task' });
  try { res.json(await sendReminder(t, 'upcoming')); } catch (e) { res.status(500).json({ error: 'Failed to send email' }); }
});

app.post('/api/milestones', adminOnly, (req, res) => {
  const b = req.body;
  if (!b.label || !db.days.some((d) => d.key === b.day) || !/^\d{2}:\d{2}$/.test(b.time || '')) return res.status(400).json({ error: 'label, day and HH:MM time required' });
  const m = { id: uid(), day: b.day, time: b.time, label: String(b.label).slice(0, 200), venue: b.venue || 'all', category: String(b.category || 'Other').slice(0, 40) };
  db.milestones.push(m); save(); res.json(m);
});
app.put('/api/milestones/:id', adminOnly, (req, res) => {
  const m = db.milestones.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  ['day', 'time', 'label', 'venue', 'category'].forEach((k) => { if (req.body[k] !== undefined) m[k] = String(req.body[k]).slice(0, 200); });
  save(); res.json(m);
});
app.delete('/api/milestones/:id', adminOnly, (req, res) => {
  db.milestones = db.milestones.filter((m) => m.id !== req.params.id); save(); res.json({ ok: true });
});

app.put('/api/venues/:id', adminOnly, (req, res) => {
  const v = db.venues.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (req.body.notes !== undefined) v.notes = String(req.body.notes).slice(0, 2000);
  save(); res.json(v);
});

app.put('/api/settings', adminOnly, (req, res) => {
  const h = (req.body.reminderHours || []).map(Number).filter((n) => n > 0 && n < 24 * 30);
  if (h.length) db.settings.reminderHours = h;
  if (typeof req.body.overdueReminder === 'boolean') db.settings.overdueReminder = req.body.overdueReminder;
  save(); res.json(db.settings);
});

app.get('/api/outbox', adminOnly, (req, res) => {
  const lines = fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8').trim().split('\n').slice(-30).reverse() : [];
  res.json(lines);
});

app.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`NABC 2027 planner on ${APP_URL}  (email: ${smtpConfigured ? 'SMTP enabled' : 'DRY-RUN — set SMTP_* in .env'})`));
