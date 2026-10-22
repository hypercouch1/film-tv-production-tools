# Production Tools server (Cloudflare)

This is the online part of the app: accounts, shared projects, and live editing. It runs on Cloudflare using three services:

| Piece | Cloudflare service | Job |
|---|---|---|
| API | Workers | Sign-up and sign-in, project lists, members |
| Database | D1 | Users, sessions, projects, members |
| Live rooms | Durable Objects | One room per shared project. It holds the document and sends each edit to everyone connected. |

It fits in Cloudflare's **free plan** for a small team.

## One-time setup (about 10 minutes)

You need a free Cloudflare account and Node.js. Run these in a terminal inside this `server` folder:

1. Install the tools:
   ```bash
   npm install
   ```
2. Log in. This opens your browser so you can sign in to Cloudflare:
   ```bash
   npx wrangler login
   ```
3. Create the database:
   ```bash
   npx wrangler d1 create production-hub
   ```
   It prints a `database_id`. Paste it into `wrangler.toml` in place of `00000000-0000-0000-0000-000000000000`.
4. Create the tables:
   ```bash
   npm run db:init
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```
   It prints your server address, e.g. `https://production-hub.<your-subdomain>.workers.dev`.
6. Put that address in `../src/config.js` (`serverUrl: 'https://…'`) and rebuild the app, so everyone connects automatically. People can also paste it under **Account → Server** in the app.

To deploy an update after changing the server code, run `npm run deploy` again.

**Updating a server set up before 1.3.0** (productions and availability links): apply the two database changes once, then deploy:

```bash
npm run db:migrate
npm run db:migrate:availability
npm run deploy
```

**Updating a server set up before 1.4.0** (admin page and one-time password codes): apply this database change once, then deploy:

```bash
npm run db:migrate:admin
npm run deploy
```

**Updating a server set up before 1.4.1** (crew pages, continuity photos, two-step admin sign-in, admin log, backups): apply this database change once, then deploy:

```bash
npm run db:migrate:crew
npm run deploy
```

(A new server set up with `npm run db:init` already has these changes.) The admin page is at `/admin`, for the emails listed in `ADMIN_EMAILS` in `wrangler.toml` (comma-separated). Those people sign in with their normal app account. Deploying also attaches the availability page's address, `film.prismdashboard.cc` (see `routes` in `wrangler.toml`); the domain must be in the same Cloudflare account. Change `AVAILABILITY_HOST` and `routes` to use another address.

## Local development

Set up the local database and start the server:
```bash
npm run db:init:local
```
```bash
npm run dev
```
The server runs at `http://127.0.0.1:8787`. In the app, set **Account → Server** to that address.

With the dev server running (started with `npx wrangler dev --var ADMIN_EMAILS:admin@example.test` for the admin checks), these run the end-to-end checks (accounts, permissions, live sync, viewer limits, removing people, crew pages, photos, the admin page, backups, brute-force lockout):
```bash
npm test
```

## How live editing works

- The app turns each change into small operations, such as "set this cue's text" or "insert this item after that one". Items are addressed by id, so two people editing different cues never clash. If two people type into the same field at the same moment, the last edit wins.
- The project's room applies operations in the order they arrive, saves the document, and broadcasts each one. Every app replays the server's order, so everyone ends up with the same document. `../tests/sync-core.test.js` checks this with randomized concurrent edits.
- If someone goes offline, their edits wait in the app and are sent when the connection comes back.

## Security notes

- Passwords are hashed with PBKDF2-SHA256 at 100,000 rounds, the most Workers allows.
- Session tokens are random. Only their SHA-256 hash is stored, and they expire after 30 days.
- Sign-in is locked for 15 minutes after 10 failed attempts on the same email.
- Membership and roles are checked on the server for every request and live connection. View-only members' edits are refused, and removed members are disconnected immediately.
- **The admin page** needs the admin's password and a code from an authenticator app (set up the first time it's opened; asked for again every 12 hours). Each code works once, and wrong codes lock for 15 minutes after 10 tries.
  - **Lost the phone?** Clear the key, then open the admin page to set it up again:
    ```bash
    npx wrangler d1 execute production-hub --remote --command "UPDATE users SET totp_secret = NULL WHERE email = 'you@example.com'"
    ```
- **Crew pages and availability links** work without an account: the 10-character code in the link is the key. Crew pages never show anyone's contact details.
- **Backups:**
  - Shared documents are copied into the `backups` table before their first change each day, keeping the last 14 per document.
  - A deleted document's copies are kept for 30 days.
  - Restore them from the admin page.
  - The database itself can also be put back to any minute in the last 30 days with Cloudflare's Time Travel (`npx wrangler d1 time-travel restore production-hub --timestamp=<when>`). That rewinds every account and setting too, so use the admin page's restore for single documents.
- **Forgotten passwords:** there's no reset by email (that needs an email-sending service). An admin makes a one-time code on the admin page instead. Only a hash of the code is stored; it works once, for 24 hours, and attempts are rate-limited like sign-in. Switched-off accounts can't sign in, and their sessions are ended.
- If sign-in requests fail with an "exceeded CPU" error on the free plan, lower `PBKDF2_ITERATIONS` in `wrangler.toml`. Existing passwords keep working because each hash records its own round count.
