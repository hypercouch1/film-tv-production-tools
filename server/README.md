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

## Local development

Set up the local database and start the server:
```bash
npm run db:init:local
```
```bash
npm run dev
```
The server runs at `http://127.0.0.1:8787`. In the app, set **Account → Server** to that address.

With the dev server running, these run the end-to-end checks (accounts, permissions, live sync, viewer limits, removing people, brute-force lockout):
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
- **Not included yet: password reset by email.** That needs an email-sending service. Until then, a forgotten password means making a new account, which the project owner then re-invites.
- If sign-in requests fail with an "exceeded CPU" error on the free plan, lower `PBKDF2_ITERATIONS` in `wrangler.toml`. Existing passwords keep working because each hash records its own round count.
