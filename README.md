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
- **Local and shared:** each sidebar has two lists.
  - **On this computer:** works offline, exactly as before.
  - **Shared:** stored on the server and edited live by everyone in the project.
- **Sharing:** open a call sheet or project and click **Share**. This moves it online. Then add people by the email they signed up with:
  - **Can edit:** full editing, including checking items off.
  - **View only:** they can watch live but can't change anything.
- **Live:** checkmarks, edits, new shots, and schedule changes appear for everyone within a fraction of a second. Avatars show who else is in the project.
  - The status pill shows **Live**, **Connecting…** or **Offline · will sync**.
  - Edits made offline are sent when the connection returns.
- **Owners** manage people under **People**. The ⋯ menu offers **Delete for everyone** to the owner and **Leave** to everyone else.
- **Private copy:** **Duplicate** on a shared project makes a copy on this computer only.

## Home screen

Click a tile (or press **1**, **2**) to open a system. **Ctrl/⌘+H** or the ⌂ button returns home. Upcoming shoot days from every Shot Sheet project are listed under the tiles.

To add a new system, add an entry to `SYSTEMS` in `src/home.js` (and a logo in `LOGOS`). Then add its page under `src/`. If it needs saved data, add its store name to `STORES` in `main.js`.

## Script Writer

- **Automatic formatting:** each line is a screenplay element: Scene Heading, Action, Character, Parenthetical, Dialogue, Transition or Shot. The page lays it out with standard margins and indents in Courier.
  - **Enter** starts the element that usually comes next: a heading leads to action, a character to dialogue, dialogue to action.
  - **Tab** / **Shift+Tab** switch the current line's element, for example action to character, or dialogue to parenthetical. **Ctrl/⌘+1–7** pick one directly, as does the toolbar.
  - **Auto-detection:** typing `INT.` or `EXT.` makes a scene heading, and `CUT TO:` makes a transition. Parentheticals are wrapped in brackets for you.
  - **Suggestions:** as you type, it suggests character names, locations and times of day (`DAY`, `NIGHT`, `CONTINUOUS`…), plus transitions. Press Enter or Tab to accept one.
  - **Layout:** page breaks are shown as you write. Scene numbers appear in both margins (switch them off in ⋯). The scene list on the left jumps to any scene.
- **Title page:** title, credit, author, draft and contact.
- **Import scripts you already have:** PDF, Final Draft (`.fdx`) or Fountain. Use **Import script**, drag the file in, or open a `.fountain`/`.fdx` file with the app.
- **Export:** a print-ready PDF (with title page and page numbers), Fountain, or Final Draft.
- **Send to:**
  - **Shot Sheet:** opens the scene breakdown and starter-shot preview.
  - **Call Sheet:** one section per scene, with cues for places, each character's first line, transitions and shots.
  - Both systems also have **Import script…**, which lists your Script Writer scripts or takes a file.
- **Sharing:** scripts can be shared and edited live like other projects. This needs the server deployed with the `script` project type (server 1.2.0 or later).

## Updates

The app checks GitHub Releases shortly after it starts, then every 6 hours. When a newer version exists, a notice shows the new version, with **What's new** and **Download** buttons. Dismissing it hides it until the next version comes out. **Help → Check for Updates…** checks straight away.

The sync server can also require a minimum app version (`MIN_CLIENT_VERSION` in `server/wrangler.toml`). Older apps then show an **Update required** notice, because they can't sync shared projects.

### Releasing a new version

1. Update `version` in `package.json` and write `RELEASE_NOTES.md`.
2. Commit, then tag and push the tag (e.g. `v1.2.0`) from GitHub Desktop or the command line.

The **Build apps** workflow runs the tests, builds the Mac and Windows apps, and publishes a GitHub Release with the installers and the release notes. Installed copies then see the update notice.

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
