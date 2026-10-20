# Production Tools 1.2.4

## Shared projects reconnect reliably
- **After idle:** after the computer sleeps, the network changes, or the app sits idle, shared projects now reconnect by themselves. Before, the connection could die without the app noticing. It kept showing **Live** while your changes waited unsent.
- **How it notices:** the app now checks that the server is still answering. It replaces a dead connection within about half a minute, and straight away when you switch back to the app or your internet comes back.
- **Sign-ins:** you stay signed in as long as you use the app at least once every 30 days. Before, you were signed out 30 days after signing in, however often you used it.

> If you have 1.2.3, this update installs itself. It's the first one to.

---

# Production Tools 1.2.3

## The app now updates itself

After this version, you won't need to download updates by hand any more.
- **Windows (installed version):** new versions download in the background. A banner says when one is ready. Click **Restart to update**, or it installs the next time you quit.
- **Mac:** the same, as long as Production Tools is in your **Applications** folder. If you run it from somewhere else (for example straight from the disk image), the app tells you and keeps offering a **Download** button.
- **Portable Windows version:** this can't replace itself, so it still shows a **Download** button. Use the installer to get automatic updates.
- **Checking downloads:** every update comes from this project's GitHub Releases and is checked against its published checksum before it's installed.

> **This one time:** download and install 1.2.3 by hand. After that, updates install themselves.

## Shot sheets follow their script
- **New scenes:** add a scene in the Script Writer and it appears in the linked shot sheet automatically, in the right place, with starter shots and the script's scene numbers.
- **Edited scenes:** edits to existing scenes (heading, synopsis, cast, length) are applied too. Your shots are never changed.
- **Removed scenes:** scenes removed from the script are only flagged, never deleted.
- **Left-out scenes:** scenes you left out or deleted from the shot sheet aren't added back. **Review changes** lists them if you want them later.
- **Undo and off switch:** **Ctrl/⌘+Z** undoes an automatic update. Untick **Update automatically** in the shot sheet's script banner to review changes by hand instead.

---

# Production Tools 1.2.2

This release adds a screenplay editor, and the app now tells you when a new version is available.

> **If you installed 1.2.0 or 1.2.1:** those builds both reported themselves as version 1.2.0, so the app kept saying an update was needed even after updating. Install 1.2.2 once and the notice will stop. From now on, the release build checks that the version tag matches the app's version.

## New

### Undo and redo everywhere
- **Shortcuts and buttons:** **Ctrl/⌘+Z** undoes and **Ctrl+Y** (Windows) or **⌘+Shift+Z** (Mac) redoes, with ↶ ↷ buttons in every system's toolbar.
- **Shared projects:** undo only reverses your own changes, never what a collaborator did.

### Comments
- **Where:** comment on script lines, shots, scenes, and call sheet cues and sections. Hover over an item and click 💬, or use the 💬 toolbar button (**Ctrl/⌘+Alt+M**).
- **Badges:** a badge shows how many open comments an item has.
- **Panel:** the side panel lists comments by item. You can resolve, reopen and delete them, or click an item to jump to it.
- **Live:** in shared projects, comments sync live like everything else.

### Script revisions (Script Writer)
- **Saving drafts:** **Revisions** saves named drafts, in the industry colour order (White, Blue, Pink, Yellow, Green…).
- **Show changes:** this marks every line changed since a draft with an asterisk in the margin. The PDF prints the asterisks plus a revision header ("Blue Rev. 10/18/26") on each page.
- **Restore:** you can go back to any saved draft, and undo that too.

### Smarter page breaks (Script Writer)
- **Split speeches:** a long speech no longer jumps to the next page whole. It splits at a sentence, with **(MORE)** at the bottom of the page and **NAME (CONT'D)** at the top of the next, as in Final Draft. The editor and the PDF break in the same places.
- **Headings and names:** scene headings and character names always stay with the lines that follow them.

### Industry call sheets (Shot Sheet)
- **Call sheet:** each shoot day's **Day summary** is now a proper **Call sheet**. It has:
  - general crew call, shooting call and estimated wrap
  - weather, sunrise and sunset, filled in by **Get forecast**
  - location, parking and nearest hospital
  - scenes with day/night and cast numbers
  - cast and crew with individual call times
  - equipment, props and notes
- **Editing:** edit any field right on the sheet, then **Export PDF**.
- **Weather:** the forecast uses the free Open-Meteo service. Only the place name and date are sent, and forecasts reach about 16 days ahead.

### Script ↔ Shot Sheet link
- **What's linked:** a shot sheet made from a Script Writer script stays linked to it.
- **What it shows:** the shot sheet shows which scenes changed, which are new and which were removed. **Review changes** updates scenes (shots are kept), adds new scenes with starter shots, or handles removed ones.
- **No duplicates:** sending the same script again offers to update the existing shot sheet instead of making a duplicate.

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

## Security
- **Navigation locked:** the app window can no longer be sent to a web page (for example, by dropping a link onto it). Before this fix, such a page could read or overwrite the projects saved on your computer. Links meant to open in a new window still open in your browser, and only for web addresses.
- **Shared data is checked:** shared projects with malformed data are cleaned up when they arrive, so a collaborator can't break the page for others.
- **Sign-out and password changes:** signing out, or changing your password on another device, now also disconnects that device's live editing straight away.
- **Sign-in token:** the token is no longer sent in the live connection's web address, where it could end up in server logs.
- **Sign-in timing:** checking an email that doesn't have an account now takes as long as a wrong password, so timing doesn't reveal who has an account.
- **Release builds:** they run with read-only access except for the publishing step, and the third-party release action is pinned to an exact version.

## Changes
- **Empty lists are allowed:** deleting your last call sheet, shot sheet or script no longer creates a blank one, and a fresh install no longer adds a sample automatically. The empty screen offers **New**, **Import**, and **Load example**.

## Fixes
- **Share:** after **Share**, the People dialog now opens once the project has loaded, so you can invite people straight away. Before, it sometimes didn't appear.
- **Fountain imports:** these now keep the title page author, contact and draft date.
- **Final Draft imports:** these keep "Shot" lines as shots.

## For maintainers
- **Server:** redeploy it **before** publishing this release (`npm run deploy` in `server/`). The 1.2.2 app sends its sign-in token as a WebSocket subprotocol, which older servers don't accept. The new server still accepts the old way, so older apps keep working. It adds the `script` project type and reports `minClientVersion` from `MIN_CLIENT_VERSION` in `wrangler.toml`.
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
