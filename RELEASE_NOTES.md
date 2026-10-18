# Production Tools 1.2.0

This release adds a screenplay editor, and the app now tells you when a new version is available.

## New

### Script Writer
- **New system:** a fourth tile on the home screen, for writing screenplays with the formatting done for you.
- **Formatting as you type:** scene headings, action, character names, parentheticals, dialogue, transitions and shots are laid out with standard margins and indents in Courier.
  - **Enter** moves to the element that usually comes next.
  - **Tab** switches the current line's element (action → character, dialogue → parenthetical, and so on).
  - **Auto-detection:** typing `INT.` or `EXT.` starts a scene heading, and parentheticals are wrapped in brackets for you.
- **Suggestions:** as you type, it suggests character names, locations and times of day.
- **Layout:** the script appears as real pages, separate Letter-size sheets with page numbers, breaking exactly where the PDF will. There are also scene numbers, a scene list for jumping around, and a title page.
- **Import scripts you already have:** PDF, Final Draft (.fdx) and Fountain.
- **Export:** a print-ready PDF, Fountain, or Final Draft.
- **Send to Shot Sheet or Call Sheet** in one click. Shot Sheet opens its scene breakdown, and Call Sheet builds a section of cues for each scene.
- **Sharing:** share a script and write together live, just like call sheets and shot sheets.

### Call Sheet and Shot Sheet
- **Import script…** in both lists your Script Writer scripts, or takes a PDF, Final Draft or Fountain file.
- **Call Sheet files:** Call Sheet can now also import `.fountain` and `.fdx` files directly.

### Update notices
- **New-version notice:** when a newer version is published, a notice shows the version with **What's new** and **Download** buttons. **Help → Check for Updates…** checks straight away.
- **Too-old versions:** if the sync server stops supporting an old version, the app says so, so shared projects don't silently stop syncing.

## Changes
- **Empty lists are allowed:** deleting your last call sheet, shot sheet or script no longer creates a blank one, and a fresh install no longer adds a sample automatically. The empty screen offers **New**, **Import**, and **Load example**.

## Fixes
- **Share:** after **Share**, the People dialog now opens once the project has loaded, so you can invite people straight away. Before, it sometimes didn't appear.
- **Fountain imports:** these now keep the title page author, contact and draft date.
- **Final Draft imports:** these keep "Shot" lines as shots.

## For maintainers
- **Server:** redeploy it for this release (`npm run deploy` in `server/`). It adds the `script` project type and reports `minClientVersion` from `MIN_CLIENT_VERSION` in `wrangler.toml`.
- **Release workflow:** pushing a `v*` tag now runs the tests, builds both apps, and publishes a GitHub Release with the installers and this file as the notes. This is what installed apps check for updates.
- **Tests:** new suites for the screenplay module (formatting rules, Fountain and Final Draft round trips, pagination, sending to other systems) and the update checker.

---

# Production Tools 1.1.0

Changes on the `online` branch since **v1.0.0**.

This release lets a team work on the same call sheet or shot sheet at the same time. Shot Sheet can also build a project from a screenplay, and it now tracks the cast, crew, props and equipment each shoot day needs.

**The app has a new name: Production Tools** (it was "Call Sheet"). Your projects and sign-in carry over automatically. Call Sheet is still the name of the live-show checklist system inside the app.

---

## New

### Accounts and live collaboration
- **Accounts:** sign in or create an account from the **Sign in** button on any screen. Your name, password and server can be changed under **Account**.
- **Shared projects:** each sidebar now has two lists.
  - **On this computer:** private and works offline, exactly as before.
  - **Shared:** stored online and edited live by everyone in the project.
- **Share:** open a call sheet or shot sheet and click **Share** to move it online, then add people by the email they signed up with.
  - **Can edit:** full editing, including checking items off.
  - **View only:** can follow along live but can't change anything.
- **Live updates:** checkmarks, edits, new shots and schedule changes appear for everyone almost instantly.
  - **Presence:** avatars show who else is in the project.
  - **Status:** a label shows **Live**, **Connecting…** or **Offline · will sync**.
  - **Cursor:** your cursor stays where it is while other people's edits arrive.
- **Offline-safe:** edits made without a connection are kept and sent as soon as it returns.
- **Managing people:** the owner adds, removes and changes people under **People**. The ⋯ menu offers **Delete for everyone** to the owner and **Leave** to everyone else. **Duplicate** makes a private copy on your computer.

### Import a screenplay into Shot Sheet
- **How to start:** click **Import script** in the Shot Sheet sidebar, press **Ctrl/⌘+Shift+O**, or drag a file onto the window.
- **Formats:** **PDF**, **Final Draft (.fdx)** and **Fountain**.
- **Scene breakdown:** each scene gets its number, heading (INT/EXT, location, time of day), a short synopsis, the cast, and its length in eighths of a page.
- **Optional starter shots** for each scene:
  - an establishing shot when the location changes
  - a master wide shot
  - coverage of the speaking characters: singles, two-shots and over-the-shoulders
- **Preview first:** name the project, pick the scenes, and choose which starter shots to add before anything is created.
- **Schedule:** shows how many script pages each shoot day covers.

### Cast & Crew
- **Cast & Crew tab:** a new tab in Shot Sheet.
  - **Cast:** each character, the actor playing them, and their contact details.
  - **Crew:** each person's role, name and contact. Mark core crew as **Every day**.
  - **Scheduling:** each person shows the scenes and shoot days they're needed for, worked out from the schedule.
- **Per scene (Edit mode):** tap **Cast** and **Crew** chips to choose who the scene needs, or type a name to add someone new. List the scene's **Props** and **Equipment**.
- **Calendar:** calendar (.ics) exports now list the cast for each shoot day.

### Day summary
- **Where:** in **Schedule**, open a shoot day and click **Day summary** for a printable page for that day.
- **Contents:**
  - call and wrap times, location and notes
  - the scenes being shot
  - the cast (with actors and contacts) and the crew needed
  - props and equipment
  - shot notes
- **Equipment** comes from three places:
  - what each scene lists
  - the day's new **Extra equipment** field
  - gear implied by the shots: dolly or crane moves, gimbal, B camera, high frame rates, lenses, and sound gear for scenes with dialogue
- **Export:** **Export PDF** saves a white, print-ready version.

---

## Improvements and fixes
- **PDF borders:** PDF exports no longer have a dark border around each page.
- **Mac build:** the Mac build works again. An unneeded component from the PDF library was breaking the combined Intel + Apple Silicon app.
- **Smaller download:** the app is about 30 MB smaller.
- **Separate builds:** a Mac build failure no longer cancels the Windows build, and the build no longer shows "deprecated Node.js" warnings.

---

## Upgrading
- **Existing projects:** your call sheets and shot sheets on this computer carry over automatically. Projects with cast listed by name (for example from a script import) are converted into the new Cast & Crew list the first time they're opened.
- **Sign-in is optional:** without an account, everything works offline as before.
- **Installing:** download the Mac (`.dmg`) or Windows (`.exe`) installer from the **Build apps** run on the `online` branch. The app isn't signed with a paid Apple or Microsoft developer certificate, so on a Mac, right-click the app and choose **Open** the first time. If macOS says the app "is damaged", run `xattr -cr "/Applications/Production Tools.app"` in Terminal.
- **Renamed app:** on Windows, the installer replaces the old **Call Sheet** install. On a Mac, the new **Production Tools** app sits next to the old one in Applications. Once you've opened the new app and checked your projects are there, drag **Call Sheet** to the Trash.

## Known limitations
- **Password reset:** there's no reset by email yet. Someone who forgets their password needs a new account and a fresh invite from the project owner.
- **Same field at once:** if two people edit the same field at the same moment, the last edit wins. Edits to different cues, shots or fields never clash.
- **Scanned PDFs:** these have no selectable text and can't be imported. Export the script again as a PDF from your screenwriting app, or use Final Draft or Fountain.
- **Starter shots:** these are a first pass based on who speaks in each scene. Review and adjust them.

---

## For maintainers
- **Server:** a Cloudflare Worker in `server/`, live at `https://production-hub.sosdorfm.workers.dev`.
  - **D1:** stores accounts, sessions, projects and members.
  - **Durable Objects:** one live room per shared project, over WebSockets.
  - **Setup and redeploying:** see `server/README.md`. App updates don't require a server redeploy.
- **Security:**
  - **Passwords:** hashed with PBKDF2-SHA256 at 100k rounds.
  - **Sessions:** only a hash of each session token is stored, and tokens expire after 30 days.
  - **Lockout:** sign-in locks for 15 minutes after 10 failed attempts.
  - **Roles:** checked on the server for every request and live connection.
- **Server address in the app:** `src/config.js`.
- **Tests:**
  - **App:** `npm test` covers sync convergence under concurrent edits, screenplay parsing (PDF, FDX and Fountain), and the cast & crew data model.
  - **Server:** `npm test` in `server/` runs the end-to-end API and live-sync checks against a running server.
- **Version:** `package.json` is `1.1.0`. Tag `v1.1.0` to cut this as a release (the tag also triggers the Mac and Windows builds).
- **Rename:** the app ID (`com.callsheet.app`) and the server address (`production-hub…workers.dev`) are unchanged on purpose. Changing the app ID would install the renamed app alongside the old one instead of updating it, and changing the server address would disconnect existing installs.
