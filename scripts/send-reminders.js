// Scheduled reminder job (GitHub Actions). Emails lead POC + team as each task's ETA approaches.
// Env: FIREBASE_SERVICE_ACCOUNT (JSON), SMTP_HOST/PORT/USER/PASS, MAIL_FROM, APP_URL
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const TZ_OFFSET = '-07:00'; // Pacific Daylight Time in July
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
admin.initializeApp({ credential: sa ? admin.credential.cert(JSON.parse(sa)) : admin.credential.applicationDefault() });
const db = admin.firestore();
const smtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
const transporter = smtp ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;
const APP_URL = process.env.APP_URL || '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (local) => new Date(local + TZ_OFFSET).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';
let venues = {};

function recipients(t) {
  const out = [], seen = new Set();
  [{ name: t.leadName, email: t.leadEmail }, ...(t.team || [])].forEach((p) => {
    const e = (p.email || '').toLowerCase(); if (e && !seen.has(e)) { seen.add(e); out.push({ name: p.name, email: e }); }
  });
  return out;
}
async function log(msg) { await db.collection('reminderLog').add({ at: new Date().toISOString(), msg }); console.log(msg); }

async function send(t, kind) {
  const to = recipients(t);
  if (!to.length) { await log(`SKIP (no emails) | ${t.title}`); return; }
  const subject = `[NABC 2027] ${kind === 'overdue' ? 'OVERDUE' : 'Reminder'}: ${t.title} — due ${fmt(t.eta)}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #e5dcc8;border-radius:12px;overflow:hidden">
    <div style="background:#272974;color:#fff;padding:16px 20px"><b style="color:#F5A623">NABC 2027</b> · Program Planner</div>
    <div style="padding:20px;color:#1d1d3a"><h2 style="margin:0 0 8px">${esc(t.title)}</h2>
    <p style="color:${kind === 'overdue' ? '#A3241B' : '#555'}">${kind === 'overdue' ? 'This task is past its ETA and not marked done.' : 'This task is coming due.'}</p>
    <table cellpadding="4" style="font-size:14px"><tr><td><b>Starts</b></td><td>${esc(fmt(`${t.startDate}T${t.startTime}`))}</td></tr>
    <tr><td><b>Ends (ETA)</b></td><td>${esc(fmt(t.eta))}</td></tr><tr><td><b>Venue</b></td><td>${esc(venues[t.venue] || t.venue)}, Cow Palace</td></tr>
    <tr><td><b>Status</b></td><td>${esc(t.status)}</td></tr><tr><td><b>Lead POC</b></td><td>${esc(t.leadName)} ${esc(t.leadPhone)}</td></tr></table>
    ${APP_URL ? `<p><a href="${esc(APP_URL)}" style="background:#F5A623;color:#272974;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600">Open planner</a></p>` : ''}</div></div>`;
  if (!transporter) { await log(`DRY-RUN (SMTP not configured) to ${to.map((p) => p.email).join(', ')} | ${subject}`); return; }
  await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: to.map((p) => `${p.name || ''} <${p.email}>`).join(', '), subject, html });
  await log(`SENT to ${to.map((p) => p.email).join(', ')} | ${subject}`);
}

(async () => {
  const settings = (await db.doc('config/settings').get()).data() || { reminderHours: [24, 2], overdueReminder: true };
  (await db.collection('venues').get()).forEach((d) => { venues[d.id] = d.data().name; });
  const now = Date.now();
  const snap = await db.collection('tasks').get();
  for (const doc of snap.docs) {
    const t = doc.data(); const sent = t.sentReminders || [];
    try {
      if (t.remindNow) { await send(t, 'upcoming'); await doc.ref.update({ remindNow: false }); }
      if (t.status === 'done' || !t.eta || !recipients(t).length) continue;
      const eta = new Date(t.eta + TZ_OFFSET).getTime();
      const hours = (t.reminderHours && t.reminderHours.length ? t.reminderHours : settings.reminderHours).map(Number).sort((a, b) => b - a);
      const due = hours.filter((h) => now >= eta - h * 3600e3 && now < eta && !sent.includes(`h${h}`));
      if (due.length) { await send(t, 'upcoming'); await doc.ref.update({ sentReminders: [...sent, ...due.map((h) => `h${h}`)] }); }
      else if (settings.overdueReminder && now > eta && !sent.includes('overdue') && now - eta < 24 * 3600e3) {
        await send(t, 'overdue'); await doc.ref.update({ sentReminders: [...sent, 'overdue'] });
      }
    } catch (e) { console.error('Failed for', t.title, e.message); process.exitCode = 1; }
  }
})().catch((e) => { console.error(e); process.exit(1); });
