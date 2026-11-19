/* Data layer: Firebase Auth (email link) + Firestore. Authorisation is enforced by firestore.rules, not by this file. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const DAYS = [
  { key: 'setup', date: '2027-07-01', label: 'Setup Day', short: 'Thu Jul 1', kind: 'setup' },
  { key: 'd1', date: '2027-07-02', label: 'Event Day 1', short: 'Fri Jul 2', kind: 'event' },
  { key: 'd2', date: '2027-07-03', label: 'Event Day 2', short: 'Sat Jul 3', kind: 'event' },
  { key: 'd3', date: '2027-07-04', label: 'Event Day 3', short: 'Sun Jul 4', kind: 'event' },
  { key: 'teardown', date: '2027-07-05', label: 'Tear Down Day', short: 'Mon Jul 5', kind: 'teardown' },
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
export const configured = !String(firebaseConfig.apiKey || '').startsWith('REPLACE');

/* ---------------- auth ---------------- */
export async function requestLink(email) {
  email = String(email).trim().toLowerCase();
  await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
  try { localStorage.setItem('nabc_email', email); } catch (_) {}
}
export async function completeLinkIfPresent() {
  if (!isSignInWithEmailLink(auth, location.href)) return false;
  let email = ''; try { email = localStorage.getItem('nabc_email') || ''; } catch (_) {}
  if (!email) email = (prompt('Confirm your email to finish signing in') || '').trim().toLowerCase();
  await signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem('nabc_email'); } catch (_) {}
  history.replaceState(null, '', location.pathname); // strip the one-time link from the URL
  return true;
}
export async function signInGoogle() {
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  // iOS Safari / mobile browsers handle pop-ups badly: use a full-page redirect there (same-origin auth domain on Hosting).
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform));
  if (mobile) return signInWithRedirect(auth, p);
  await signInWithPopup(auth, p);
}
export async function redirectError() {
  try { await getRedirectResult(auth); return ''; } catch (e) { return e.code || 'error'; }
}
export const logout = () => signOut(auth);
export function onUser(cb) { return onAuthStateChanged(auth, cb); }

/* ---------------- state + realtime ---------------- */
export const D = { tasks: [], milestones: [], venues: [], settings: { reminderHours: [24, 2], overdueReminder: true }, access: null };
let unsubs = [];
const byId = (a) => a.docs.map((d) => ({ id: d.id, ...d.data() }));

// Resolves with {email, role} or throws {code:'unauthorised'}
export async function loadAccess(user) {
  const email = (user.email || '').toLowerCase();
  let snap;
  try { snap = await getDoc(doc(fs, 'config', 'access')); } catch (e) { throw Object.assign(new Error('not authorised'), { code: 'unauthorised' }); }
  if (!snap.exists()) throw Object.assign(new Error('Access list not initialised — run the seed script'), { code: 'uninit' });
  D.access = snap.data();
  const role = (D.access.admins || []).includes(email) ? 'admin' : (D.access.leads || []).includes(email) ? 'lead' : null;
  if (!role) throw Object.assign(new Error('not authorised'), { code: 'unauthorised' });
  return { email, role };
}

export function subscribe(onChange, onError) {
  unsubs.forEach((u) => u()); unsubs = [];
  const fire = () => onChange(D);
  const err = (e) => onError && onError(e);
  unsubs.push(onSnapshot(collection(fs, 'tasks'), (s) => { D.tasks = byId(s); fire(); }, err));
  unsubs.push(onSnapshot(collection(fs, 'milestones'), (s) => { D.milestones = byId(s); fire(); }, err));
  unsubs.push(onSnapshot(collection(fs, 'venues'), (s) => { D.venues = byId(s).sort((a, b) => (a.order || 0) - (b.order || 0)); fire(); }, err));
  unsubs.push(onSnapshot(doc(fs, 'config', 'settings'), (s) => { if (s.exists()) D.settings = s.data(); fire(); }, err));
  unsubs.push(onSnapshot(doc(fs, 'config', 'access'), (s) => { if (s.exists()) D.access = s.data(); }, err));
}
export function unsubscribeAll() { unsubs.forEach((u) => u()); unsubs = []; }

/* ---------------- validation (mirrors firestore.rules; rules are the real gate) ---------------- */
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const TEXT = ['title', 'description', 'startDate', 'startTime', 'eta', 'venue', 'category', 'priority', 'leadName', 'leadEmail', 'leadPhone', 'notes'];
function cleanTask(b, base = {}) {
  const t = { ...base };
  TEXT.forEach((k) => { if (b[k] !== undefined) t[k] = String(b[k]).trim().slice(0, k === 'description' || k === 'notes' ? 4000 : 300); });
  if (t.leadEmail) t.leadEmail = t.leadEmail.toLowerCase();
  if (['todo', 'in_progress', 'blocked', 'done'].includes(b.status)) t.status = b.status;
  if (Array.isArray(b.team)) t.team = b.team.filter((p) => p && (p.name || p.email)).slice(0, 50)
    .map((p) => ({ name: String(p.name || '').trim().slice(0, 120), email: String(p.email || '').trim().toLowerCase().slice(0, 200), phone: String(p.phone || '').trim().slice(0, 40) }));
  if (Array.isArray(b.reminderHours)) t.reminderHours = b.reminderHours.map(Number).filter((n) => n > 0 && n < 720);
  return t;
}
function checkTask(t) {
  if (!t.title) return 'Title is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate || '') || !/^\d{2}:\d{2}$/.test(t.startTime || '')) return 'Start date and time are required';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.eta || '')) return 'End date and time are required';
  if (t.eta < `${t.startDate}T${t.startTime}`) return 'End must be after start';
  const d = DAYS.find((x) => x.date === t.startDate);
  if (!d) return 'Start date must be one of the event days (Jul 1–5, 2027)';
  t.day = d.key;
  if (!emailOk(t.leadEmail) || (t.team || []).some((p) => !emailOk(p.email))) return 'Invalid email address';
  return null;
}
const now = () => new Date().toISOString();
async function syncLeads(tasks) {
  const leads = [...new Set(tasks.map((t) => (t.leadEmail || '').toLowerCase()).filter(Boolean))].sort();
  await updateDoc(doc(fs, 'config', 'access'), { leads });
}

/* ---------------- REST-like shim used by app.js ---------------- */
export async function api(method, url, body = {}) {
  const parts = url.split('/').filter(Boolean); // ['api','tasks',id,'remind']
  const [, res, id, sub] = parts;
  const fail = (m) => { throw new Error(m); };
  const me = (auth.currentUser?.email || '').toLowerCase();
  const isAdmin = (D.access?.admins || []).includes(me);
  try {
    if (res === 'tasks') {
      if (method === 'POST' && !id) {
        const t = cleanTask(body, { status: 'todo', team: [], reminderHours: [], sentReminders: [], priority: 'medium' });
        const e = checkTask(t); if (e) fail(e);
        t.createdAt = t.updatedAt = now();
        const ref = await addDoc(collection(fs, 'tasks'), t);
        await syncLeads([...D.tasks, { id: ref.id, ...t }]); return { id: ref.id };
      }
      const old = D.tasks.find((x) => x.id === id) || fail('Task not found');
      if (method === 'DELETE') { await deleteDoc(doc(fs, 'tasks', id)); await syncLeads(D.tasks.filter((x) => x.id !== id)); return { ok: true }; }
      if (sub === 'remind') { await updateDoc(doc(fs, 'tasks', id), { remindNow: true, updatedAt: now() }); return { queued: true }; }
      if (method === 'PUT') {
        if (!isAdmin) { // leads: status + notes only (rules enforce this too)
          const patch = { updatedAt: now() };
          if (body.status !== undefined) patch.status = body.status;
          if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 4000);
          await updateDoc(doc(fs, 'tasks', id), patch); return { ok: true };
        }
        const t = cleanTask(body, old); delete t.id;
        const e = checkTask(t); if (e) fail(e);
        if (t.eta !== old.eta || JSON.stringify(t.reminderHours || []) !== JSON.stringify(old.reminderHours || [])) t.sentReminders = [];
        t.updatedAt = now();
        await setDoc(doc(fs, 'tasks', id), t);
        await syncLeads(D.tasks.map((x) => (x.id === id ? t : x))); return { ok: true };
      }
    }
    if (res === 'milestones') {
      const clean = (b, base = {}) => { const m = { ...base }; ['day', 'time', 'label', 'venue', 'category'].forEach((k) => { if (b[k] !== undefined) m[k] = String(b[k]).slice(0, 200); }); return m; };
      if (method === 'POST') { const m = clean(body, { venue: 'all', category: 'Other' }); if (!m.label || !DAYS.some((d) => d.key === m.day) || !/^\d{2}:\d{2}$/.test(m.time || '')) fail('Label, day and HH:MM time required'); await addDoc(collection(fs, 'milestones'), m); return { ok: true }; }
      if (method === 'PUT') { await updateDoc(doc(fs, 'milestones', id), clean(body)); return { ok: true }; }
      if (method === 'DELETE') { await deleteDoc(doc(fs, 'milestones', id)); return { ok: true }; }
    }
    if (res === 'venues' && method === 'PUT') { await updateDoc(doc(fs, 'venues', id), { notes: String(body.notes || '').slice(0, 2000) }); return { ok: true }; }
    if (res === 'settings' && method === 'PUT') {
      const h = (body.reminderHours || []).map(Number).filter((n) => n > 0 && n < 720);
      await setDoc(doc(fs, 'config', 'settings'), { reminderHours: h.length ? h : D.settings.reminderHours, overdueReminder: !!body.overdueReminder }, { merge: true }); return { ok: true };
    }
    if (res === 'outbox') {
      const s = await getDocs(query(collection(fs, 'reminderLog'), orderBy('at', 'desc'), limit(30)));
      return s.docs.map((d) => { const x = d.data(); return `[${x.at}] ${x.msg}`; });
    }
  } catch (e) {
    if (e.code === 'permission-denied') throw new Error('Not permitted');
    throw e;
  }
  fail('Unsupported request');
}
