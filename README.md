# NABC 2027 Program Planner

Plan and track tasks for NABC 2027 (Setup Thu Jul 1 · Event Jul 2–4 · Tear down Mon Jul 5, Cow Palace, Daly City).

**Architecture (all free tiers):**
- `docs/` — static site served by **GitHub Pages**
- **Firebase** (Spark plan) — email-link sign-in + Firestore database; `firestore.rules` enforces who can read/write
- **GitHub Actions** (`.github/workflows/reminders.yml`) — runs every ~10 min and emails leads/team as ETAs approach

**Access:** only emails in the database's access list. Admins = full control. Leads (emails entered as a task's Lead POC) = view all, update status/notes of tasks they lead. Nobody's email is stored in this repo.

## One-time setup

### 1. Firebase project
1. https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → enable "Email link (passwordless sign-in)"**.
3. Authentication → **Settings → Authorized domains** → add `<your-github-username>.github.io`.
4. **Build → Firestore Database → Create database** (production mode, region `nam5` or nearest).
5. Firestore → **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
6. **Project settings → General → Your apps → Web (`</>`)** → register app → copy the `firebaseConfig` into `docs/firebase-config.js`. (These values are not secrets.)
7. In Google Cloud console → APIs & Services → Credentials → open the Browser API key → **restrict to HTTP referrers** `https://<your-github-username>.github.io/*`.

### 2. Seed the database (run on your own machine)
1. Firebase → Project settings → **Service accounts → Generate new private key** (downloads a JSON — **never commit it**).
2. ```bash
   npm install
   GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json" ADMIN_EMAILS="a@x.com,b@y.com,c@z.com" npm run seed
   ```
   This creates the admin list, 5-day schedule, venues, key times and starter tasks. Re-run with a new `ADMIN_EMAILS` any time to change admins.

### 3. Reminder emails
Repo → Settings → Secrets and variables → Actions:
- **Secrets:** `FIREBASE_SERVICE_ACCOUNT` (paste the whole JSON), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (use an app password / sending-only key), `MAIL_FROM`
- **Variable:** `APP_URL` = your Pages URL

Then Actions tab → **Task reminders → Run workflow** to test. Results appear on the app's *Reminders* tab.

### 4. Publish
Repo → Settings → **Pages → Deploy from a branch → `main` / `/docs`**. Your URL: `https://<username>.github.io/NABC_2027/`.

## Security notes
- Firestore rules (not the UI) are the gate: signed-in users without a spot on the access list get nothing. Anyone can *request* a sign-in link, but gets no data.
- Leads cannot change anything except status/notes on their own tasks; only admins can add/delete tasks or change settings.
- Keep real contact data in Firestore only. The repo is public: never commit service-account JSON, `.env`, or exports. `.gitignore` covers these; enable **Secret scanning + Push protection** in repo settings.
- GitHub disables scheduled workflows after 60 days of repo inactivity — re-enable in the Actions tab if that happens.
