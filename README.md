# NABC 2027 Program Planner

Task planning and status tracking for NABC 2027 (July 1–5, 2027, Cow Palace, Daly City).
Days: Setup Thu Jul 1 · Event Jul 2–4 · Tear down Mon Jul 5.

## Run
```bash
brew install node   # if needed
npm install
npm start           # http://localhost:3000
```

## Email reminders
Copy `.env.example` to `.env` and fill in SMTP settings. Without SMTP the app runs in dry-run mode
(reminders are logged to `data/outbox.log`). The server checks every minute and emails the lead POC and
team members at the configured hours before each task's ETA (default 24h and 2h) plus one overdue notice.
Done tasks never send.

## Data
Stored in `data/db.json` (created on first run from `seed.js`; git-ignored). Seeded key start times are placeholders.

## Security & access
- **Login:** email one-time code (6 digits, 10 min, 5 tries). Only emails in `ADMIN_EMAILS` (full access) and lead POC emails on tasks (view all; update status/notes of tasks they lead; send reminders for them) can sign in. Unauthorised emails get the same response as authorised ones. Removing a lead from all tasks revokes access immediately.
- **Sessions:** random 256-bit token in an HttpOnly, SameSite=Strict cookie (Secure in production), stored hashed server-side, 12 h expiry.
- **Hardening:** rate limits on login and reminders, CSRF origin/JSON checks, CSP and other security headers, no data files served, server-side authorisation on every route.
- **Deployment:** GitHub Pages can't run this (needs Node + a server for login/email). Host on a Node platform (Render, Fly.io, Railway, a VPS) over **HTTPS only**, set `ADMIN_EMAILS`, `NODE_ENV=production`, `TRUST_PROXY`, and SMTP in the host's environment settings — never commit `.env`.
- **Never commit `data/`**: it holds names, emails and phone numbers (git-ignored). If the repo is public, keep real contacts only in the deployed app.
- Without SMTP in development, login codes print to the server console only.
