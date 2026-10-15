# Production Hub

A desktop app (Windows and macOS) with several production systems behind one home screen. Everything stays on your computer. Each system keeps its own save file in your user data folder (`%APPDATA%\Call Sheet\` on Windows, `~/Library/Application Support/Call Sheet/` on macOS).

| System | What it does |
|---|---|
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

1. **On any Mac:** install Node.js 22 from nodejs.org, unzip `Call-Sheet-source.zip`, open Terminal in the `tv-callsheet-app` folder, and run `npm install`, then `npm run dist:mac`. The `.dmg` ends up in `dist/`.
2. **Without a Mac (GitHub Actions):** put this folder in a GitHub repository. Then go to the repository's **Actions** tab, open **Build apps** and click **Run workflow**. The workflow is in `.github/workflows/build.yml`. After about 10 minutes, download `mac-app` (and `windows-app`) from the run's **Artifacts**.

### First launch on a Mac

The app isn't signed with an Apple Developer ID, so macOS blocks it the first time it opens.

- **Usual fix:** drag **Call Sheet** into Applications, then right-click it, choose **Open**, and choose **Open** again. If there's no Open button, go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **If macOS says the app "is damaged"** (this happens with downloaded copies), run this once in Terminal:

  ```bash
  xattr -cr "/Applications/Call Sheet.app"
  ```

To get rid of these warnings, sign and notarize the app with an Apple Developer account ($99/yr).

## Home screen

Click a tile (or press **1**, **2**) to open a system. **Ctrl/⌘+H** or the ⌂ button returns home. Upcoming shoot days from every Shot Sheet project are listed under the tiles.

To add a new system, add an entry to `SYSTEMS` in `src/home.js` (and a logo in `LOGOS`). Then add its page under `src/`. If it needs saved data, add its store name to `STORES` in `main.js`.

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
- **Import:** `.shotsheet`, `.json`, `.csv`.
- **Export:**
  - `.shotsheet` or CSV.
  - PDF of the current list (filter to a day first to print that day's sheet, including its call time and location).
  - `.ics` calendar of all shoot days, for Google Calendar, Outlook or Apple Calendar.
  - A backup of all projects.
- **Changing the options:** the shot type, angle and movement lists are `OPTIONS` at the top of `src/shotsheet-formats.js`.
