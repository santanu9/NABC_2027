// One-time setup. Run LOCALLY (never in CI):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json ADMIN_EMAILS="a@x.com,b@y.com" node scripts/seed.js
// Writes the access list (admins), settings, venues, key times and starter tasks to Firestore.
const admin = require('firebase-admin');
const seed = require('./seed-data');

const admins = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!admins.length) { console.error('Set ADMIN_EMAILS="a@x.com,b@y.com"'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

(async () => {
  const existing = await db.collection('tasks').limit(1).get();
  if (!existing.empty && !process.argv.includes('--force')) {
    console.log('Tasks already exist. Only updating the admin list. Use --force to re-seed everything.');
    await db.doc('config/access').set({ admins }, { merge: true });
    return;
  }
  const batch = db.batch();
  batch.set(db.doc('config/access'), { admins, leads: [] });
  batch.set(db.doc('config/settings'), { reminderHours: [24, 2], overdueReminder: true });
  seed.venues.forEach((v, i) => batch.set(db.doc(`venues/${v.id}`), { name: v.name, notes: v.notes, order: i }));
  seed.milestones.forEach((m) => batch.set(db.collection('milestones').doc(), m));
  const now = new Date().toISOString();
  seed.tasks.forEach((t) => batch.set(db.collection('tasks').doc(), { ...t, startDate: t.eta.slice(0, 10), sentReminders: [], createdAt: now, updatedAt: now }));
  await batch.commit();
  console.log(`Seeded ${seed.tasks.length} tasks, ${seed.milestones.length} key times, ${seed.venues.length} venues. Admins: ${admins.join(', ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
