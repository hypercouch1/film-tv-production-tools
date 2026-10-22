# Production Tools

A desktop app (Windows and macOS) with several production systems behind one home screen. Projects you don't share stay on your computer. Each system keeps its own save file in your user data folder (`%APPDATA%\Production Tools\` on Windows, `~/Library/Application Support/Production Tools/` on macOS).

The app was previously called **Call Sheet**. On first launch under the new name, it copies everything over from the old `Call Sheet` folder (projects and sign-in).

| System | What it does |
|---|---|
| **Script Writer** | Write screenplays with the formatting done for you |
| **Call Sheet** | Cue checklists for running a live show |
| **Shot Sheet** | Shot lists for film, with a shoot-day calendar |

## Run and build

```bash
npm install
```
```bash
npm start
```
```bash
npm run dist:win
```
```bash
npm run dist:mac
```

### Building the Mac app

Apple's tools only run on macOS, so the Mac app can't be built on Windows. There are two ways to build it, and both produce one **universal** `.dmg` that runs on Intel and Apple Silicon Macs:

1. **On any Mac:** install Node.js 22 from nodejs.org, clone this repository, open Terminal in its folder, and run `npm install`, then `npm run dist:mac`. The `.dmg` ends up in `dist/`.
2. **Without a Mac (GitHub Actions):** put this folder in a GitHub repository. Then go to the repository's **Actions** tab, open **Build apps** and click **Run workflow**. The workflow is in `.github/workflows/build.yml`. After about 10 minutes, download `mac-app` (and `windows-app`) from the run's **Artifacts**.

### First launch on a Mac

The app isn't signed with an Apple Developer ID, so macOS blocks it the first time it opens.

- **Usual fix:** drag **Production Tools** into Applications, then right-click it, choose **Open**, and choose **Open** again. If there's no Open button, go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **If macOS says the app "is damaged"** (this happens with downloaded copies), run this once in Terminal:

  ```bash
  xattr -cr "/Applications/Production Tools.app"
  ```

To get rid of these warnings, sign and notarize the app with an Apple Developer account ($99/yr).

## Working together online

The `online` branch adds accounts and live collaboration. It needs the small Cloudflare server in [`server/`](server/README.md); that page has the one-time setup.

- **Accounts:** click **Sign in** in the top-right corner of any screen to create an account or sign in.
- **Sharing a production:** click **Share** on the production's home page (or any of its tools).
  - **What happens:** the production moves online with everything in it: scripts, shot list, schedule, breakdown, locations and call sheets. They keep their ids, so the links between them keep working.
  - **Inviting:** add people by the email they signed up with. **Can edit** gives full editing; **View only** lets them watch live without changing anything.
  - **What they get:** everyone you add gets the whole production.
- **Live:** checkmarks, edits, new shots and schedule changes appear for everyone within a fraction of a second. Avatars show who else is there.
  - The status pill shows **Live**, **Connecting…** or **Offline · will sync**.
  - Edits made offline are sent when the connection returns.
- **Owners** manage people under **People**. Deleting a shared production deletes everything in it for everyone; anyone else can **Leave**.
- **Shared before productions:** scripts and call sheets shared on their own by an older version are listed on the start screen. Their owner can move each into a shared production.

## Productions

Everything for a film or TV show lives in one **production**.

- **Start screen:** lists your productions (on this computer and shared with you), with upcoming shoot days. **New production** asks for a title and **Film** or **TV show**.
- **Film:** one script and one shot list.
- **TV show:** episodes, each with its own script, shot list and breakdown. Cast, crew, locations and the schedule are shared by every episode. Add, number and name episodes on the production's home page; scene codes in shared views read "2-5" (episode 2, scene 5).
- **Production home:** tiles for Script, Shot Sheet, Schedule, Cast & Crew, Call Sheets, Breakdown, On Set, Post, Budget, Equipment and Locations (or press **1**–**9** for the first nine), the episodes, upcoming shoot days, rename and delete. **Ctrl/⌘+H** or ⌂ in any tool returns here.
- **Older data:** the first time 1.3.0 runs, each existing shot sheet becomes a film, scripts join the production they're linked to (or get their own), and call sheets go into a "Call Sheets" production.

Code: `src/production.js` (current production, links, migration, sharing), `src/home.js` (start screen), `src/dashboard.js` (production home). The production document is the shot sheet project (`shotsheets` store / shared kind `shotsheet`); scripts and call sheets carry `productionId` (and `episodeId` for TV). `shotsheet.js` runs the Shot Sheet, Schedule, Breakdown and Locations pages (`body[data-mode]`).

## Schedule

**Schedule** on the production home (or the Shot Sheet's Schedule tab):

- **Calendar:** shoot days, each day's details, **Call sheet** and **Run day**.
- **Stripboard:** every scene as a strip coloured by INT/EXT and day/night (white INT day, yellow EXT day, blue INT night, green EXT night) with set, pages, cast numbers and shots. Drag strips between shoot days and the unscheduled bin, or use **Move…**. A scene split over days shows a strip on each. Days show page counts and availability clashes.
- **Day Out of Days:** cast and crew against shoot days: SW (start), W (work), H (hold), WF (finish), SWF (one day), with totals.
- **Availability:** a grid of people and dates. Click a date to mark a day someone can't work. Shoot days are highlighted, and a marked day they're scheduled on shows as a clash (here, on the stripboard and in the Day Out of Days).
  - **Ask by link…** (shared productions): pick people and dates; each gets a personal link (`film.prismdashboard.cc/a/<code>`). They tap the days they can't work on their phone — no app or account. Answers appear live in the grid, marked "from their link". **Links** lists them with copy buttons, who has answered, and revoke.
  - People in the production mark their own days in the app instead: editors on the grid, and anyone (view-only too) by choosing **That's me** once, after which they can change their own row. The server checks the claim (`POST /api/projects/:id/me/claim` and `/me/availability`); editors can unlink a wrong claim.

## Post

**Post** on the production home (`post.html`, `post.js`; data in its own post document, `post-formats.js`):

- **Take log:** pick a shoot day (or all shots); **+ Take** on a shot adds the next take number with the day's roll. Record roll/card, clip name, timecode, ◯ circled / ✓ good / ✕ no good and notes. Export as CSV.
- **Media:** **+ Add files** or **+ Add folder** (up to 5,000 files per folder, hidden and system folders skipped) records each file's name, path, drive, size and date — nothing is opened or uploaded. Clips whose name matches a logged clip link to that take (**Match to takes** again later). Link files to scenes or shots, add notes, search and filter by kind, 📂 shows the file in its folder.
- **Post tracker:** tasks for visual effects, sound, music, colour, edit and other, with status, who, due date (late ones in red) and notes. **Add from breakdown** makes tasks from the breakdown's visual effects and sound items (once each).
- **Cuts & notes:** cuts by stage (assembly, rough, fine, picture lock, online), with a review link or file path and timecoded notes to resolve.
- In a shared production the post document is online inside it (made the first time someone who can edit opens Post).

## Call sheets on phones

Shared productions only (`crewlinks.js`; the page is `server/src/crew-page.js`, built by `server/src/crew.js`):

- **Send…** on a shoot day (Schedule calendar) or **Send to cast & crew…** on its call sheet lists everyone on that day with their call time. **Send call sheet** makes a personal page for anyone without one (`film.prismdashboard.cc/c/<code>`), then marks the call sheet as sent. **Copy messages for everyone** copies a text per person with their call time and link, ready to paste into texts or email.
- **Their page** shows their shoot days and call times (from the schedule, always current), their scenes, and each day's full call sheet once it's sent: crew call, shooting call, wrap, weather, parking, hospital, notes, cast and crew calls. Contact details aren't shown. **Got it** confirms it. Sending again after changes asks everyone to confirm the new version.
- **Calendar:** each page has a calendar feed (`/c/<code>/calendar.ics`) for Apple, Google or Outlook Calendar. Each event runs from their call time to wrap, so schedule changes reach their calendar.
- **Crew pages…** (Schedule → Availability) lists everyone's page: copy links, see who has opened theirs, make pages, or stop one working. Codes are kept in the production (`p.crewLinks`).

## On Set

**On Set** on the production home (`onset.html`, `onset.js`; data in its own document, `onset-formats.js`):

- **Production report** (one per shoot day; pick the day at the top):
  - times: crew call, first shot, lunch, first shot after lunch, camera wrap, last out
  - each scheduled scene marked completed or part shot, plus scenes shot that weren't planned
  - setups and takes, counted from the Post take log unless typed
  - cards and media; cast arrived and wrapped; delays, incidents, equipment problems and notes
  - progress: scenes and pages today and to date, and how far ahead of or behind schedule
- **Continuity:** notes by scene (and shot and take), with a category and photos. Photos are shrunk to 1600 px JPEGs:
  - on this computer: kept in the app's data folder (`photos/`)
  - in a shared production: kept on the server (`/api/projects/:id/photos`), where everyone in the production can see them and editors can add them
  - sharing a production uploads its photos

## Equipment

**Equipment** on the production home (`gear.html`, `gear.js`; data in its own document, `gear-formats.js`):

- **List:** items by department with quantity, source (owned, rental, borrowed), vendor, rate (per day, per week or flat), pickup and return dates, status, who has it, which shoot days it's needed, serial numbers and notes. **Check out** / **Check in** records who and when (**Check-out log**). Items still out after their return date are flagged as overdue.
- **By day:** what's needed each shoot day, and what to pick up or return on each date.
- **Budget:** rentals with a rate become budget lines (by department) through **Build from production**.

## Budget

**Budget** on the production home (`budget.html`, `budget.js`; data in its own budget document, `budget-formats.js`):

- **Build from production:** adds lines for cast (work and hold days from the Day Out of Days), crew (by role: Director, Camera, Grip & electric, Sound…), locations (their fee as the rate), breakdown elements (props, wardrobe, vehicles, extras and animals per day…) and catering per shoot day. Lines made this way follow the schedule (↻); building again updates their quantities and descriptions but keeps rates, actuals and notes. Typing a quantity stops a line following. Lines whose source has gone are marked.
- **Top sheet:** accounts grouped above the line, production, post and other, with fringes (a percentage of labour lines), contingency (a percentage of subtotal and fringes), total, actual and remaining. **Detail:** every line by account with quantity, unit, rate, estimate, fringe, actual and notes; **+ Add a line to…** for anything else.
- **Costs:** receipts and invoices (date, account, optional budget line, vendor, receipt number, who paid, amount). They add to the actuals on the top sheet and in Detail. A line's actual is what's typed on it plus its costs.
- **Cost report:**
  - budget (with fringes), spent and remaining for each account, with what share is used
  - for each shoot day: its planned cost (the day rates of the cast, crew and locations working that day, with fringes, plus catering) against expenses dated that day
- **Export** as CSV (budget or expenses) or PDF.
- In a shared production the budget is online inside it, but only the owner and editors can see or open it; the server hides it from view-only members.

## Forgot password

**Sign in → Forgot password?** takes an email, a one-time code and a new password. The administrator makes the code on the admin page (below); it works once, for 24 hours, and signs the person out everywhere else.

## Admin page

`https://<server>/admin` (e.g. `https://production-hub.sosdorfm.workers.dev/admin`), for the emails in `ADMIN_EMAILS` (`server/wrangler.toml`).

- **Signing in:** sign in with your app account, then enter a code from an authenticator app.
  - The first time, the page shows a setup key to add to the app.
  - The code is asked for again every 12 hours.
- **Usage:**
  - accounts, and people active in the last day, week and month
  - documents by kind, sharing, crew pages and "Got it"s, availability links
  - app versions in use, signups by week
- **Accounts:**
  - one-time password codes
  - sign out everywhere
  - edit name and email
  - switch off and on
  - delete (only accounts that don't own shared projects)
- **Backups:** every shared document is copied before its first change each day, and the last 14 copies are kept. A deleted document's final copy is kept for 30 days.
  - Download any copy, or restore it. Restoring keeps a copy of the current version first, and everyone with the document open gets the restored version.
  - A deleted production comes back with its people.
  - **Back up everything now** takes a copy of every document. **Download everything** saves one JSON file with every account (without passwords) and every document.
- **Admin log:** what admins did: codes made, accounts edited, switched off or deleted, restores, downloads and sign-ins.

## Breakdown

- **Tagging in the script:** in the Script Writer, select words and press 🏷 (**Ctrl/⌘+Shift+T**): Props, Wardrobe, Makeup & hair, Extras, Stunts, Vehicles, Animals, Special effects, Visual effects, Sound & music, Set dressing or Special equipment. Tags show as coloured pills in the left margin (click one to remove it).
- **Breakdown page:** a sheet per scene with every category: script tags (marked 📄, found through the scene's link to the script) plus anything added by hand. **Elements** lists everything with its scenes, shoot days and notes.
- **Call sheets** list the day's breakdown: props and special equipment join those lists, the rest get their own section.

## Locations

- Each location has an address (with a map link), contact, fee, parking, nearest hospital, power & facilities, permit status and notes.
- **Sets shot here:** scenes match a location by their set — the heading without INT./EXT. and the time ("INT. ROSIE'S DINER - BOOTH - NIGHT" matches "Rosie's Diner"). **Sets without a location** lists the sets from your headings to turn into locations.
- A call sheet's empty location, parking, nearest hospital and weather place are filled from the locations of the day's scenes.

## Script Writer

- **Automatic formatting:** each line is a screenplay element: Scene Heading, Action, Character, Parenthetical, Dialogue, Transition or Shot. The page lays it out with standard margins and indents in Courier.
  - **Enter** starts the element that usually comes next: a heading leads to action, a character to dialogue, dialogue to action.
  - **Tab** / **Shift+Tab** switch the current line's element, for example action to character, or dialogue to parenthetical. **Ctrl/⌘+1–7** pick one directly, as does the toolbar.
  - **Auto-detection:** typing `INT.` or `EXT.` makes a scene heading, and `CUT TO:` makes a transition. Parentheticals are wrapped in brackets for you.
  - **Suggestions:** as you type, it suggests character names, locations and times of day (`DAY`, `NIGHT`, `CONTINUOUS`…), plus transitions. Press Enter or Tab to accept one.
  - **Layout:** the script appears as separate Letter-size pages, each with its page number. Pages break exactly where they will in the exported PDF. Scene numbers appear in both margins (switch them off in ⋯). The scene list on the left jumps to any scene.
- **Title page:** title, credit, author, draft and contact.
- **Import scripts you already have:** PDF, Final Draft (`.fdx`) or Fountain. Use **Import script**, drag the file in, or open a `.fountain`/`.fdx` file with the app.
- **Export:** a print-ready PDF (with title page and page numbers), Fountain, or Final Draft.
- **Send to:**
  - **Shot Sheet:** opens the scene breakdown and starter-shot preview.
  - **Call Sheet:** one section per scene, with cues for places, each character's first line, transitions and shots.
  - Both systems also have **Import script…**, which lists your Script Writer scripts or takes a file.
- **Sharing:** scripts can be shared and edited live like other projects. This needs the server deployed with the `script` project type (server 1.2.0 or later).

## Updates

The app checks GitHub Releases shortly after it starts, then every 6 hours. **Help → Check for Updates…** checks straight away.

- **Windows, installed version:** [electron-updater](https://www.electron.build/auto-update) downloads the new installer in the background, using `latest.yml` from the release. A banner then offers **Restart to update**; otherwise it installs when the app quits. Code signing isn't needed.
- **Mac:** Apple's updater only works for signed apps, so `updates.js` does it directly:
  1. downloads the release's `-mac.zip`
  2. checks its SHA-512 against `latest-mac.yml` from the same release
  3. unpacks it next to the installed app and checks its bundle id and version
  4. swaps the two once the app quits, putting the old one back if the swap fails

  This needs the app in a folder it can write to (normally /Applications). Run from the disk image or a read-only folder, it shows a **Download** button instead.
- **Portable Windows version, or any failed automatic update:** a notice with **What's new** and **Download**. Dismissing it hides it until the next version.

Release file names have no spaces (`Production-Tools-Setup-1.2.3.exe` and so on). GitHub would otherwise rename them, and they'd no longer match the names in `latest.yml`.

The sync server can also require a minimum app version (`MIN_CLIENT_VERSION` in `server/wrangler.toml`). Older apps then show an **Update required** notice, because they can't sync shared projects.

### Releasing a new version

1. Update `version` in `package.json` and add a `# Production Tools <version>` section at the top of `RELEASE_NOTES.md` (end it with a `---` line). The GitHub release shows only that section: what's new and changed in this update.
2. Commit, then tag **that commit** with the same version (`version` `1.2.2` → tag `v1.2.2`) and push the tag. You can do this from GitHub Desktop or the command line.

   The tag and `package.json` must match: the app reports `package.json`'s version, and compares it with the newest release tag. The workflow refuses to publish a release when they differ.

The **Build apps** workflow runs the tests, builds the Mac and Windows apps, and publishes a GitHub Release with the installers, the update files (`latest.yml`, `latest-mac.yml`, `*.blockmap`) and the release notes. Installed copies then update themselves.

## Working on projects

- **Undo / redo:** **Ctrl/⌘+Z** undoes and **Ctrl+Y** or **⌘+Shift+Z** redoes, or use ↶ ↷ in the toolbar. Each project has its own history. In shared projects, undo only reverses your own edits.
  - In Call Sheet and Shot Sheet, Ctrl/⌘+Z while typing in a field undoes that field's typing.
- **Comments:** comment on script lines, shots, scenes, and call sheet cues and sections. Hover over an item and click 💬, or use the 💬 toolbar button (**Ctrl/⌘+Alt+M**). Comments are saved inside the project, so they sync in shared projects. You can resolve, reopen and delete them.

## Script revisions and page breaks

- **Revisions** (Script Writer toolbar): save the script as a named draft, using the standard colours White, Blue, Pink, Yellow, Green, Goldenrod, Buff, Salmon, Cherry.
  - **Show changes** marks lines changed since that draft with `*` in the right margin. The PDF prints the marks and a revision header on each page.
  - **Restore** goes back to a draft, and can be undone.
- **Page breaks:** a speech that runs past the bottom of a page splits after a sentence, with (MORE) and NAME (CONT'D), keeping at least two lines on the first page. If there's no sentence break, it moves to the next page whole. While you're typing in a split speech it's shown in one piece, and it re-splits when you leave it.

## Call sheets (Shot Sheet)

In Schedule, choose a shoot day, then **Call sheet**. It's an industry-style sheet:
- general crew call, shooting call and estimated wrap
- weather with sunrise and sunset
- location, parking and nearest hospital
- notes
- scenes with day/night and cast numbers
- cast and crew with call times
- equipment and props

Every field is edited on the sheet itself. **Get forecast** looks up the weather for the place typed in the Weather box using Open-Meteo (free, no account, up to about 16 days ahead). **Export PDF** prints it.

## Script ↔ Shot Sheet link

- **Linked:** shot sheets made from a Script Writer script (**Send to → Shot Sheet**, or **Import script** → choose the script) remember which script scene each scene came from.
- **Update automatically** (on by default, a tick box in the banner): opening the shot sheet, or coming back to the app, picks up script changes straight away.
  - New script scenes are added in script order, with starter shots.
  - Changed scenes get the new heading, synopsis, cast and length.
  - Scene numbers follow the script.
  - Your shots are never touched.
  - Scenes deleted from the script are only flagged, never deleted.
  - Scenes you unticked at import or deleted from the shot sheet aren't added back. **Review changes** lists them under "Left out" if you want them later.
  - **Ctrl/⌘+Z** undoes an automatic update. It stays undone until the script changes again.
- **Changes flagged:** with automatic updates off, a banner and "Script changed" badges show what's different. **Review changes** can then:
  - update a scene's heading, synopsis, cast and length, keeping its shots
  - mark a change as reviewed
  - add new scenes, with or without starter shots
  - delete or keep scenes removed from the script
- **On this computer only:** this works for scripts saved on this computer.

## Empty lists

Each system can have no projects at all. Deleting the last call sheet, shot sheet or script leaves the list empty instead of creating a new one. The empty screen offers **New**, **Import**, and **Load example** (a sample to explore).

## Call Sheet

- **Running a show:** click a cue to check it off. **Space** checks the next cue, **Backspace** undoes, and **1–9** jumps to a section.
- **Edit mode (Ctrl/⌘+E):** add, rename and reorder sections and cues. `*words*` show in yellow.
- **Import:** `.callsheet`, `.json`, `.csv` (`section,item,done`), `.md`, `.txt`.
- **Export:** `.callsheet`, CSV, Markdown, PDF, and a backup of all sheets.

## Shot Sheet

- **Shot List view:** scenes, each with its shots. Shots are numbered automatically (1A, 1B, 2A…).
  - Every shot has a shot type (EWS, WS, LS, FS, MLS, MS, MCU, CU, ECU, OTS, POV, 2S, INS, EST), angle, movement, lens, camera, FPS, audio (Sync/MOS/VO), shoot day, and notes.
  - The chips at the top filter the list to one shoot day, so the sheet becomes that day's checklist. The keyboard shortcuts are the same as Call Sheet.
- **Schedule view:** a month calendar.
  - Double-click a date, or select it and click **Schedule shoot day**, to add a day.
  - For each day you can set the call and wrap times, location and notes.
  - Assign shots to the day from the unscheduled list. **Run day ▶** opens that day as a checklist.
- **Edit mode (Ctrl/⌘+E):** pressing Enter in a shot description adds the next shot with the same settings. ⧉ duplicates a shot, and ⠿ drags to reorder.
- **Cast & Crew view:**
  - **Cast:** list the film's characters with the actor playing each one and their contact details.
  - **Crew:** list each person's role, name and contact. Tick **Every day** for people needed on every shoot day (director, DP, sound).
  - **Where they're needed:** each person shows which scenes and shoot days need them, worked out from the schedule.
- **Per scene (Edit mode):** tap the **Cast** and **Crew** chips to choose who a scene needs, or type a new name to add someone. List the scene's **Props** and **Equipment**.
- **Day summary:** in the Schedule view, open a shoot day and click **Day summary**. It builds a printable sheet for that day:
  - call and wrap times, location, and notes
  - the scenes being shot
  - the cast (with actors and contacts) and crew needed
  - equipment and props
  - shot notes

  Equipment comes from three places: what the scenes list, the day's extra equipment, and gear implied by the shots. For example, dolly or crane moves, B camera, high frame rates, lenses, and sync sound. **Export PDF** saves the summary.
- **Import a script:** **Import script** in the sidebar (or **Ctrl/⌘+Shift+O**, or drag the file onto the window) reads a screenplay and breaks it down by scene.
  - Formats: **PDF**, **Final Draft (.fdx)** or **Fountain**.
  - For each scene it finds the scene number, heading, synopsis, cast, and page length in eighths.
  - It can also add starter shots: an establishing shot when the location changes, a master wide shot, and coverage of the speaking characters (a single for one speaker, a two-shot and both overs for two, a group shot plus singles for three or more).
  - A preview lets you name the project, pick the scenes, and choose which starter shots to add.
  - Scanned PDFs (images with no selectable text) can't be read. Export the PDF again from your screenwriting app instead.
  - The Schedule view shows how many script pages each shoot day covers.
- **Import:** `.shotsheet`, `.json`, `.csv`.
- **Export:**
  - `.shotsheet` or CSV.
  - PDF of the current list (filter to a day first to print that day's sheet, including its call time and location).
  - `.ics` calendar of all shoot days, for Google Calendar, Outlook or Apple Calendar.
  - A backup of all projects.
- **Changing the options:** the shot type, angle and movement lists are `OPTIONS` at the top of `src/shotsheet-formats.js`.
