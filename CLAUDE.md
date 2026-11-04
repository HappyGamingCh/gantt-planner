# CLAUDE.md — Gantt Planner

A lightweight, offline, single-file web app (a simplified MS Project) for planning and tracking a project on a Gantt chart. An Excel workbook on OneDrive is the data store: the app opens it, fills in calculable values, lets users edit tasks, writes back to the same file, and produces a printable progress report (S-curve, progress overall, progress by assignee).

**`docs/SPEC.md` is the source of truth.** Read the sections relevant to the current milestone before writing code. If this file and the spec disagree, the spec wins.

## Commands
```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest (engine + Excel round-trip)
npm run build      # -> dist/gantt-planner.html (single self-contained file)
npm run sample     # tsx scripts/make-sample.ts -> samples/sample-project.xlsx, tests/fixtures/*.xlsx
npm run typecheck  # tsc --noEmit
```

## Non-negotiables
1. **One file, fully offline.** The build output is a single HTML file that works when double-clicked (`file://`). No CDNs, no Google Fonts, no analytics, no runtime network requests of any kind.
2. **The engine is pure.** `src/engine/` has no DOM, no React, no store imports. Dates are ISO `YYYY-MM-DD` strings; date math goes only through `engine/dates.ts` and `engine/calendar.ts` (UTC internally). Every rule in SPEC §5 has a unit test.
3. **The Excel file is the user's data — never break it.**
   - Keep the loaded ExcelJS `Workbook` and mutate it on save; never rebuild it from scratch.
   - Find columns by header name (with aliases), never by position.
   - Preserve unknown columns, unknown sheets, styles, widths, freeze panes, validation.
   - Write values, never formulas. Write back user text you couldn't parse unchanged.
   - Write only when the user clicks Save (or Ctrl+S). Never auto-save.
4. **Full recompute on every change.** ≤ 200 tasks; no incremental caching or memoized partial schedules.
5. **Don't change the Excel schema, the calculation rules (SPEC §5), mode rules (§6) or terminology without updating SPEC.md first** and saying so in your summary.
6. **Use design tokens.** Colors, radii, spacing, fonts come from `src/styles/tokens.css` (SPEC §7.2). No hard-coded hex values in components (the Excel writer, the report chart palette and the resource palette in `config.ts` are the only exceptions).
7. **UI copy in English; data may be Thai.** The font stack must render Thai (IBM Plex Sans Thai inlined, Leelawadee UI fallback).
8. **The repository is public.** Sample data, test fixtures, docs and commit messages use made-up names only: never the owner's real plans, people, contractors, equipment tags or file contents.

## Stack
Vite · React 18 · TypeScript (strict, no `any`) · vite-plugin-singlefile · exceljs · chart.js · zustand · lucide-react · @fontsource/ibm-plex-sans · @fontsource/ibm-plex-sans-thai · Vitest (+ @vitest/coverage-v8) · tsx (for scripts). The Gantt is a custom SVG component — do not add a Gantt library.

## Architecture map
```
src/engine/   pure scheduling logic: calendar, links, schedule, actuals, forecast,
              status, progress, scurve, critical, issues, compute (entry point)
src/excel/    schema (headers + aliases), read, write, template, readme text
src/io/       File System Access API + fallback, recent file (IndexedDB), download
src/store/    zustand store, undo (snapshots), selectors
src/ui/       header, kpi, toolbar, grid, gantt, drawer, issues, report, empty, common
src/sample/   sampleData.ts (shared by "Try sample" and scripts/make-sample.ts)
src/config.ts thresholds and constants (schedule-state bands, palette, zoom scales)
```
Data flow: Open → read workbook → parse → `compute()` → render. Edit → store action (pushes undo snapshot) → `compute()` → render → dirty. Save → write into retained workbook → `writeBuffer()` → file.

## Conventions
- Functional components + hooks. Keep components under ~300 lines; split when larger.
- All state changes go through store actions; each user action = one undo snapshot.
- Parsing never throws to the UI: produce `Issue` / `Change` objects (SPEC §5.11).
- Wrap `localStorage`, `IndexedDB` and File System Access calls in try/catch with graceful fallback.
- Tests: `tests/engine/*.test.ts`, `tests/excel/*.test.ts`. Use the fixed status date from the sample so tests are deterministic.
- Name things as the spec does (Planned Start, Forecast Finish, Variance (d), Plan mode / Track mode, status date).

## Workflow
1. Work **one milestone at a time** in the order of SPEC §14 (M0 → M5).
2. At the start of a milestone, restate its acceptance criteria in `PROGRESS.md` as a checklist.
3. At the end: run `npm run typecheck`, `npm test`, `npm run build`; open `dist/gantt-planner.html` via `file://` and check the UI in both modes; tick the checklist; write a short summary of what changed and anything deferred.
4. When the spec is ambiguous, choose the simplest behaviour consistent with SPEC §1 goals, record it in SPEC §17 (Decisions log), and continue. **Stop and ask** only if the choice would change the Excel schema or could delete or overwrite user data.

## Gotchas
- **ExcelJS in the browser:** if Vite complains about Node built-ins, import the prebuilt bundle `exceljs/dist/exceljs.min.js` and add a `.d.ts` shim.
- **ExcelJS in two runtimes:** the Excel layer runs in the browser (app) and in Node (Vitest, `make-sample.ts`). Import ExcelJS in exactly one place, `src/excel/exceljs.ts`, and alias it per environment in the Vite/Vitest config, so `read.ts`/`write.ts` never care which build they get.
- **ExcelJS dates** arrive as UTC-midnight `Date` objects → read with `getUTCFullYear/getUTCMonth/getUTCDate`. Write with `new Date(Date.UTC(y, m - 1, d))`.
- **Single-file build:** set `build.assetsInlineLimit` very high and `build.cssCodeSplit = false` so fonts and CSS are inlined.
- **File System Access API:** pickers need a user gesture; request `readwrite` permission on first save; writing fails while Excel desktop has the file open → show the locked-file dialog (SPEC §3.5). Check `lastModified` before saving (conflict dialog).
- **Drag & drop:** use `DataTransferItem.getAsFileSystemHandle()` so the dropped file can be saved in place.
- **Printing charts:** Chart.js canvases can print blank or blurry — render with animation off, then swap to `<img src=toDataURL()>` before `window.print()`.
- **`file://` storage:** IndexedDB/localStorage may be unavailable; features that depend on them must hide themselves, not crash.
- **GitHub Pages:** every push to `main` runs `.github/workflows/pages.yml` (type check, tests, build) and publishes `dist/gantt-planner.html` as the site's `index.html`; a failing test stops the deployment.
- **Google Drive:** npm can't install `node_modules` on Google Drive's virtual drive (write errors, no symlinks). Develop in `C:\dev\gantt-planner`; `GANTT_COPY_TO` in the git-ignored `.env.local` makes `npm run build` copy `gantt-planner.html` and `docs/` to the Drive folder.
