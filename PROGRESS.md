# Progress

## M0 — Scaffold & engine · done 2026-10-30

Acceptance criteria (SPEC §14):

- [x] Vite + React 18 + TypeScript (strict) + vite-plugin-singlefile; scripts `dev`, `test`, `build`, `sample`, `typecheck`
- [x] `tokens.css` and `base.css` (SPEC §7.2); IBM Plex Sans + IBM Plex Sans Thai (400/500/600) inlined as woff2
- [x] All `src/engine/` modules from SPEC §5 except critical path (§5.10), with `compute()` as the entry point
- [x] `src/sample/sampleData.ts` (SPEC §13) with a fixed status date (2026-09-30), used by the tests
- [x] `npm test` passes every SPEC §12 engine case except critical path — 137 tests; engine coverage: lines 100 %, statements 99.8 %, branches 95.7 %, functions 100 % (threshold 90 %)
- [x] `npm run typecheck` is clean
- [x] `npm run build` produces one file, `dist/gantt-planner.html` (307 KB), that opens via `file://` with a placeholder screen
- [x] No network requests at runtime: via `file://` (headless Chrome + DevTools Protocol) and over `http://localhost` (Chrome), the only requests are the document and inline `data:` fonts; no console errors
- [x] UI check in both modes: not applicable in M0 (placeholder only)

### What was built

- Project scaffold in `C:\dev\gantt-planner` (git initialised, nothing committed yet). `npm run build` also copies the HTML and `docs/` to `GANTT_COPY_TO` from `.env.local`.
- Engine: `dates`, `calendar`, `links` (notation, graph, cycles, topological order, successors), `schedule`, `actuals`, `forecast`, `status`, `progress`, `scurve`, `issues`, `compute`, `types`.
- Sample: "PM (3Y) F-101", built from the owner's furnace turnaround schedule (25 tasks, 9 resources).
- Placeholder screen that runs the engine on the sample (proves engine, tokens and Thai font in the single-file build).
- SPEC updated: §3.3, §5.2, §5.3, §5.4 example, §5.5, §5.8, §5.11, §11.1, §13, §17.

### Deferred

- `scripts/make-sample.ts` is a stub (M1, with the Excel layer).
- Sheet-level rules (`E_DUP_ID`, `W_BAD_DATE`, `W_FORMULA`, `W_UNTITLED`, "today" defaults, Changes for calc-only columns) → M1 parser.
- Critical path (§5.10) → M5.

### Open questions for the product owner — answered 2026-10-30 (see the follow-up below)

1. **Milestone gap.** `gap = 0` when either end of an FS link is a milestone, so `A → milestone → B` makes B start on the day A finishes, while `A → B` starts B the next day. In the sample, task 21 starts 9 Oct, the same day tasks 13 and 19 finish. Proposed: a milestone that follows a task sits at the end of that day, so its FS successors start the next working day (gap 0 only into a milestone, or out of a milestone that has no predecessors, e.g. a start milestone).
2. **Working week.** The owner's real turnaround schedules run 7 days a week (tasks start on Sat/Sun). SPEC is Mon–Fri only. Add a Project setting "Working days" (Mon–Fri / Mon–Sat / every day)? That changes the Excel schema, so it needs a decision before M1.
3. **Size and import.** Real schedules have ~120–150 tasks (SPEC assumes ≤ 100; the engine handles 100 tasks in well under 10 ms) and use the Vertex42-style layout (headers on row 5, "RP / START / DAYS / END", `ACME / NDT` for two assignees). Should M1 add aliases or an importer for that layout, and `/` as an assignee separator?

## M0 follow-up — owner decisions · done 2026-10-30

SPEC updated first (§1, §2, §3.3, §4.5, §5.1, §5.4, §5.8, §7.8, §9.3, §10, §12, §13, §16, §17) and CLAUDE.md (≤ 200 tasks).

- [x] **Milestone gap** (answer to 1: as proposed): no FS gap into a milestone or out of a *start milestone* (no predecessors, or only start-milestone predecessors); otherwise one day. `A → milestone → B` now starts B on the same day as `A → B`; a "Shutdown" milestone still lets work start the same day. Planned schedule and forecast use the same rule.
- [x] **7-day working week** (answer to 2): every day is a working day except the dates in `Holidays`. "This week" = the 7 days ending at the status date; the report look-ahead counts calendar days. No Project field was added, so the Excel schema is unchanged.
- [x] **Size and assignees** (answer to 3): plans up to 200 tasks; `Assigned` keeps `,` (or `;`) between names; no importer for the old Book1 layout (it was example data only).
- [x] Sample re-run on the 7-day calendar: planned finish 15 Oct, forecast 17 Oct (+2d); task 21 now starts 8 Oct, the day after milestone 20; KPIs unchanged (37 % vs plan 40 %, −3.5 pts, 7/22 done, 3 late).
- [x] Tests updated (138); engine coverage: lines 100 %, statements 99.8 %, branches 95.3 %, functions 100 %. Recompute of a 200-task plan in 10 parallel sections: ~2.3 ms (Node, no coverage); a single 200-task chain spanning 1.6 years: ~5 ms.
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; `dist/gantt-planner.html` (307 KB) via `file://`: only the document and inline `data:` fonts, no console errors.

## M1 — Excel I/O & file access · done 2026-10-30, except the owner's click-through in Edge/Chrome

Acceptance criteria (SPEC §14):

- [x] Schema mapping by header name with aliases; reading rules (§4.7); normalization with Change log, incl. the sheet-level rules deferred from M0 (IDs, untitled rows, bad dates/numbers, formulas, "today" defaults, Changes for calculated columns)
- [x] Write-back per §4.8 into the retained workbook: values only; unknown columns and sheets preserved; missing columns and sheets created
- [x] Template generator: all 5 sheets, header styles, widths, freeze panes, autofilter, validation, Read Me
- [x] `npm run sample` writes `samples/sample-project.xlsx` and `tests/fixtures/messy.xlsx`
- [x] File access: open, drop-to-open, save, save as, fallback, recent file, conflict detection, locked-file dialog (plus a confirm before saving over a file whose charts/pivots ExcelJS would drop)
- [x] Round-trip tests pass: sample read → write → read gives equal data; header fills, column widths, freeze panes, data validation, an extra user column and an extra sheet unchanged; messy fixture: all issues reported, unparseable text preserved
- [x] A saved file opens in Excel with formatting intact — Excel 365 (hidden instance): app-saved sample, messy file, template and an Excel-edited file open with no repair; header fills/notes, status fills, date formats, widths, freeze panes, autofilter, validation, a user's row highlight, hyperlink, note and conditional format all intact
- [ ] File System Access on `file://` verified in Edge and Chrome — automated part done (below); **waiting for the owner's click-through** (picker, permission prompt, save in place, locked file, conflict)
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; `dist/gantt-planner.html` still makes no network requests

### What was built

- `src/excel/`: `exceljs.ts` (only import site), `schema.ts` (columns, aliases, header styles), `cells.ts` (date/number/text parsing), `read.ts`, `write.ts`, `template.ts`, `readme.ts`, `unsupported.ts` (content ExcelJS drops).
- `src/io/`: `fileAccess.ts` (pickers, drop, permission, save in place with conflict check, save as), `recent.ts` (IndexedDB handle), `download.ts` (fallback), `fs-access.d.ts` (API typings missing from TS).
- `src/store/store.ts` (zustand): open, open sample, download template, save, save as, reload, close, dialogs, unsaved guard.
- M1 screens: start screen (§7.10 minus New plan), a temporary plan view (file bar, plan summary, load report), file dialogs; Ctrl+S / Ctrl+Shift+S / Ctrl+O; drop anywhere to open.
- `computePlan(plan)` in the engine; new issues `W_BAD_NUMBER`, `W_BAD_HOLIDAY`, `W_UNSUPPORTED_CONTENT`; token `--backdrop`.
- `scripts/fixtures.ts` + `make-sample.ts`; Excel-saved fixtures `excel-saved.xlsx` (user edits) and `excel-chart.xlsx` (chart sheet), made with Excel 365.
- Tests: 224 (86 new for the Excel layer and save flow); coverage of `src/engine` + `src/excel`: lines 99.4 %, statements 99.5 %, branches 95.4 %, functions 100 %.
- SPEC updated first: §3.5, §4.3, §4.6, §4.7, §4.8, §5.11, §7.2, §11.1, §17.

### Verified in browsers (headless, DevTools Protocol, `file://`)

| | Chrome 156 | Edge 156 |
|---|---|---|
| Secure context, `showOpenFilePicker`, `showSaveFilePicker`, permissions API, `getAsFileSystemHandle`, IndexedDB | yes | yes |
| Try with sample data (37 % vs 40 %, −3.5 pts, 17 Oct +2d, 7/22 done, 3 late) | yes | yes |
| Drop a real file → opens with a file handle (load report shows every messy-file issue) | yes | yes |
| Unsaved changes → the browser asks before leaving | yes | yes |
| Reload → "Reopen plan.xlsx" (handle kept in IndexedDB) | yes | yes |
| Download blank template | yes | yes |
| Open button reaches the file picker | yes | yes |
| Network requests | document + inline fonts only | same |

Headless browsers can't answer the permission prompt or the native file picker, so Save in place, Save as, Reopen's permission, the locked-file and the conflict dialogs need a person (checklist below).

### Owner check (Edge, then Chrome), with `gantt-planner.html` opened by double-click

1. Try with sample data → **Save as…** → save `test.xlsx` in your OneDrive folder.
2. **Close** → **Open Excel plan** → pick `test.xlsx` → press **Ctrl+S** → allow editing when the browser asks → "Saved hh:mm".
3. Open `test.xlsx` in Excel and leave it open → Ctrl+S in the app → "Can't save — the file is probably open in Excel…" → close Excel → **Retry** → saved.
4. In Excel, change a cell in `test.xlsx`, save, close Excel → Ctrl+S in the app → "File changed" dialog → **Reload file**.
5. Close the tab, double-click `gantt-planner.html` again → **Reopen test.xlsx**.
6. Drag `test.xlsx` from File Explorer onto the page → Ctrl+S → it saves into the same file (no Save-as dialog).

### Deferred / notes for later milestones

- New plan dialog (§7.10), Load-report toast and Issues panel → M2 (M1 shows the report inline).
- Renumber IDs (M3) must re-key the writer's per-task rows (`TasksLayout.rows` is keyed by task ID).
- ExcelJS limits: charts, pivot tables, slicers, timelines, threaded comments and form controls are dropped on save (detected; the app asks first). A whole-column data validation makes open + save about 2 s slower (ExcelJS expands it cell by cell).

## M2 — Main view (read-only) · done 2026-10-30

Acceptance criteria (SPEC §14):

- [x] Header: project name, file chip with save state, Plan/Track switch, status date, issues badge, Open, Save, More menu (New plan, Save as…, Download blank template)
- [x] KPI strip in both modes (Track: Progress, Schedule, Finish, Tasks, Time · Plan: Start, Finish, Duration, Tasks, Milestones, Assignees)
- [x] Toolbar shell with zoom (Day, Week, Month, Fit)
- [x] Grid with each mode's default columns and the cell styles of §7.7; selection shared with the Gantt
- [x] Gantt (custom SVG): both modes, zoom, holidays, status-date and today lines, dependency arrows, tooltips, scroll to status date / project start on load
- [x] Mode switch: confirm when tasks have actuals; "Plan recalculated" toast; mode saved to Project › Mode
- [x] Empty state with the New plan dialog
- [x] Load report toast and Issues panel (Problems, Changes)
- [x] The sample renders correctly; KPI numbers match the engine test expectations; the mode switch changes columns, bars and KPIs
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; `file://` check in both modes; no network requests

### What was built

- `src/ui/main/MainView.tsx`: header, KPI strip, toolbar, grid and Gantt side by side (shared vertical scroll, draggable splitter 320–900 px), Issues panel over the Gantt.
- `src/ui/header/`, `kpi/`, `toolbar/`, `grid/` (columns per mode, sticky ID + Task, assignee chips, status chips, progress bars), `gantt/` (scale, timeline, Plan/Track marks, arrows, tooltip), `issues/` (Problems, Changes), `common/` (segmented control, menu, toast, dialogs), New plan dialog.
- Store split: `store.ts` (state, view actions, mode switch) and `files.ts` (open, new plan, save…); `selectors.ts` (rows, assignee colours, problems).
- lucide-react icons; tokens `--done-text`, `--progress-text`, `--late-text`, `--risk-text` for status-coloured text (WCAG AA).
- Tests: 249 (25 new: scale, arrows, formats, selectors, mode switch, new plan, load report).

### Verified in browsers (headless Chrome 156 and Edge 156, `file://`, sample plan)

- Track KPIs: 37 % · plan 40 % · −3.5 pts Slightly behind · SPI 0.91 · 17 Oct 26 +2d (planned 15 Oct 26) · 7/22 done, 3 late · Day 3 of 17 — the engine test values.
- Plan KPIs after the switch (confirm dialog first): 28 Sep 26 · 15 Oct 26 · 17d · 22 tasks · 3 milestones · 9 assignees.
- Columns change with the mode; Track draws 22 baselines, 11 progress fills and the status-date line, no arrows; Plan draws 22 bars, 3 milestones and 29 arrows (the selected task's 2 highlighted).
- Tooltip (#7: planned 29 Sep → 12 Oct · 14d, forecast 30 Sep → 15 Oct, 5 % Late, +2d); clicking a bar selects the grid row.
- Zoom Day/Week/Month/Fit; messy file: load report toast → Review → Issues panel; clicking a problem selects and shows the task; Changes grouped by field; New plan.
- Requests: the document and inline `data:` fonts/icons only; no console errors or warnings.

### Deferred

- Editing, Add/Delete/Link, search/filter/columns/density, preferences, status-date change, quick fixes → M3.
- Report button → M4. Critical path, Color by assignee, drag → M5.

## M3 — Editing · done 2026-10-30

Acceptance criteria (SPEC §14):

- [x] Inline editing in the grid (text, numbers, dates, assigned chips, predecessors with live validation, progress popover); read-only cells per mode with the lock cursor and toast
- [x] Task drawer (§7.9) with mode-specific sections; predecessor picker with cycle prevention; successors jump
- [x] Add / insert / delete / move tasks; Link / Unlink; Renumber IDs; Project settings; status date change
- [x] Track auto-fills and every other rule of §8; quick fixes in the Issues panel
- [x] Undo / redo (Ctrl+Z, Ctrl+Y) for every action; keyboard shortcuts of §7.12 (the `?` overlay is M5)
- [x] Dirty state and save flow; search, filter, columns, density; preferences in localStorage
- [x] Every rule in §8 works; undo restores every action; save → reopen shows identical data
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; `file://` check of the editing flows; no network requests

### What was built

- Store: `edit.ts` (every edit with the §8 rules, add, delete, move, link, unlink, renumber, project settings, status date, quick fixes, mode switch), `undo.ts` (one step per action, 100 steps, settles derived planned dates), `predecessors.ts` (link text edits, cycle check), `prefs.ts`; selection with Ctrl/Shift, drawer, filters.
- Grid: active cell and arrow keys, editors (`grid/CellEditor.tsx`), optional columns (`grid/columns.tsx`), lock cursor and toasts on read-only cells.
- Drawer (`drawer/`): name, status, assignee chips, predecessors with type/lag and a cycle-aware picker, planned, progress, actuals, forecast, successors, remarks; Delete task / Done.
- Toolbar: Add task, Link, Unlink, Delete, zoom, search, Filter (status, late only, assignee), Columns, density; filter chips.
- Header: rename by clicking the name, status date input + Today, More › Project settings… / Renumber IDs…; dialogs for delete, renumber and moving tasks with Project Start.
- Excel layer: each task carries its source row (`Task.source`).
- Tests: 279 (30 new: §8 rules, undo/redo, save → reopen, predecessor edits).

### Verified in browsers (headless Chrome 156 and Edge 156, `file://`)

Progress popover → 50 % sets Actual Start to the status date with the toast; Ctrl+Z / Ctrl+Y; typing over a task name; drawer by double-click (Track order: Progress, Actual, Forecast… with Planned and Predecessors locked); Add task opens the drawer on the name; Esc drops a draft, a second Esc closes the drawer; Link in row order; live predecessor check ("Task 99 does not exist"); delete + Undo from the toast; Alt+↑; search, Late only, Columns, Compact rows; status date change recomputes the KPIs; Renumber; Ctrl+Enter; Project Start → "Move tasks to the new start?"; a quick fix; preferences after a reload. No console errors; requests: the document and inline `data:` resources only.

### Deferred

- Report (§9) → M4. Critical path, Color by assignee, drag on the Gantt, shortcuts overlay (`?`), About → M5.

## M4 — Report · done 2026-10-30

Acceptance criteria (SPEC §14):

- [x] Report view (`#report`) with Back, Print / Save as PDF and Options (sections, look-ahead 1/2/4 weeks, Gantt appendix, Prepared by)
- [x] Page 1 Summary: KPI row, S-curve with status-date marker, status donut, key messages
- [x] Page 2 Progress by assignee: table, planned-vs-actual bars, 8-week workload heatmap
- [x] Page 3 Needs attention: late tasks, look-ahead, milestones; Gantt appendix
- [x] Print CSS (A4 landscape, header band and footer on every page, repeated table headers, rows not split); charts as images
- [x] "Save as PDF" gives 4 clean A4 landscape pages for the sample (no clipped charts or split rows); report numbers equal the KPI strip
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; no network requests

### What was built

- `src/ui/report/`: `Report.tsx` (toolbar, options, @page header/footer), `SummaryPage`, `AssigneesPage`, `AttentionPage`, `GanttAppendix`, `charts.ts` (Chart.js: S-curve with a status-date plugin, donut with the late count, grouped bars), `reportData.ts` (key messages, donut, look-ahead, late tasks, milestones, workload), `Report.css`.
- Header button Report; the report is a route (`#report`, the browser's Back works; Esc returns too); report options kept with the preferences.
- chart.js 4.6.1 (tree-shaken); the build is 1.56 MB.
- Tests: 286 (7 new for the report data).

### Verified (headless Chrome 156 and Edge 156, `file://`)

- Report of the sample: KPI row identical to the main view; key messages "Overall progress is 37% against a plan of 40% (−3.5 pts, Slightly behind).", "Forecast finish is 17 Oct 2026, 2 working days after the planned finish.", "3 tasks are late; the largest delay is #7 … (+2d).", "Last 7 days: +37% actual vs +40% planned.", "Next 2 weeks: 10 tasks start and 13 tasks finish.".
- Save as PDF (DevTools `Page.printToPDF`, the page's CSS page size): 4 pages, A4 landscape; each with the header band and the footer "Gantt Planner · sample-project.xlsx · Page n"; charts whole, table rows unbroken, the 25-row Gantt on one page.
- Options: 4-week look-ahead updates the message and the table; without the appendix 3 pages. A new plan shows "No progress reported yet". No console errors; no network requests.

### Deferred

- Critical flag in the Late tasks table, critical path, Color by assignee, drag, shortcuts overlay, About, final QA (§15) → M5.

## M5 — Polish · done 2026-10-30

Acceptance criteria (SPEC §14: "§15 fully passes"):

- [x] Critical path (§5.10) in the engine, with tests (simple chain, parallel branches with float)
- [x] Critical path toggle in the Gantt header corner: critical bars get a 2 px red outline, arrows between critical tasks turn red; Critical column in the grid and in Excel; critical flag in the report's Late tasks
- [x] Color by Status / Assignee
- [x] Drag in Plan mode: move a root task's bar (Planned Start), drag the right edge of a bar (Planned Duration); snaps to working days; ghost bar and date tooltip
- [x] Keyboard shortcuts overlay (`?`, More › Keyboard shortcuts) and About (More › About)
- [x] Error boundary "Something went wrong" with Download my data as .xlsx (§10)
- [x] Final QA, SPEC §15 (below; three items also need the owner's real-file check)
- [x] `npm run typecheck`, `npm test`, `npm run build` pass; no network requests

### SPEC §15 manual QA

Run in headless Chrome 156 and Edge 156 on the built file (`file://`), the native pickers replaced by an in-memory file handle so Open, Save, the locked file and the conflict go through the app's own code (scripts in the session scratchpad: `qa-check.mjs`, `m5-check.mjs`, `plan-flow.mjs`).

- [x] Open the sample .xlsx via `file://` in Edge and Chrome — *owner: once more from a OneDrive folder with the real picker*
- [x] Load report lists filled/corrected values; Issues quick fixes work — messy.xlsx: "Filled 12 values · corrected 11 · 6 warnings · 7 errors", Review → Problems 14 / Changes 23; a quick fix → 13
- [x] Plan mode: add 3 tasks, chain them with Link, change a duration → successors move — a new plan with Excavate, Pour concrete, Cure; Link → FS chain (2 arrows); Excavate 1 → 5 days moves the others 4 days (`plan-flow.mjs`); dragging task 7's end +1 working day moves task 24 too
- [x] Track mode: progress 50 % → Actual Start = status date (toast); Progress KPI 37 % → 39 %, Schedule −3.5 → −1.2 pts; the S-curve is redrawn and the report KPIs equal the strip
- [x] Change status date → late flags and forecast update (30 Sep → 6 Oct: 3 → 15 late, finish 17 → 24 Oct)
- [x] Save with the file locked → "Can't save … Retry"; Retry succeeds once it is free — *owner: with Excel holding the file*
- [x] File changed outside the app, then Save → "File changed" (Reload file / Overwrite / Cancel); Reload shows the file — *owner: with Excel saving the file*
- [x] Reopen the saved file in Excel 365: no repair; extra column (values follow their tasks after a move), widths, freeze panes, the extra sheet and its formatting intact
- [x] Thai task names in grid, Gantt tooltip, drawer and report (IBM Plex Sans Thai loaded)
- [x] Undo/redo across 10 mixed actions (progress, rename, add, name, delete, Alt+↓, 100 %, status date, Plan mode, duration): 10 × Ctrl+Z gives exactly the starting grid and KPIs, 10 × Ctrl+Y the end state
- [x] Report prints to PDF cleanly: the sample 4 A4 landscape pages; a plan with 13 late tasks 5 pages, rows unbroken, headings kept with their tables
- [x] Network: the document only (fonts and images are inline `data:`)
- [x] Keyboard-only: Ctrl+O opens, Ctrl+Enter adds a task with the cursor in the name, Esc Esc closes the drawer, Tab reaches the grid (focus ring), ↓ then F2 edits the name, Enter, Ctrl+S saves

### What was built

- Engine: `critical.ts` (total float by a backward pass on the forecast network; `TaskResult.totalFloat` and `critical`); the Excel Critical column is now filled; the sample was regenerated.
- Gantt: header corner (Color by menu, Critical toggle; sticks to the right edge), assignee colours, critical rings and red arrows, drag to move or resize in Plan mode (`drag.tsx`: ghost bar, date tooltip, Esc, one undo step).
- Grid: optional Critical column; F2 / Enter keep the text with the caret at the end; focus ring on the grid before a cell is active.
- Report: critical flag and legend in Late tasks; headings stay with their tables in print.
- Help: shortcuts overlay (`?`, More › Keyboard shortcuts), About; error boundary with Download my data as .xlsx (`recoveryBytes` in `files.ts`).
- Preferences: Color by and the critical path toggle.
- Tests: 304 (18 new: critical path, drag dates, recovery file, preferences); coverage 99.5 % (engine + Excel).

### Owner checks still open (real files and Excel; headless browsers can't drive native pickers)

- [ ] In Edge and in Chrome, open a plan from a OneDrive folder with Open, edit, Ctrl+S (allow the permission prompt); then Save as.
- [ ] Save while the file is open in Excel → "Can't save"; close it in Excel → Retry saves.
- [ ] Change and save the file in Excel while the app has it open, then Save in the app → "File changed".
- [ ] Reopen recent; drag a file from Explorer, Ctrl+S saves in place (from M1).

### Deferred

- Nothing from §14. Future ideas stay in SPEC §16.

## Audit & UX/UI round · done 2026-10-31

Full code audit after M5: 14 area finders (engine, Excel read/write, store, file I/O, grid, Gantt, panels, report, visual, usability, accessibility, flows, edge cases), duplicates merged, every bug checked by 2–3 independent verifiers and every UX idea by a judge. Result: **62 confirmed bugs** (1 critical, 11 high) and **98 UX/UI improvements**; 6 bug reports were rejected as not real.

### Acceptance
- [x] Every confirmed bug fixed or, where it needs the owner, listed below (145 items done, 15 split across areas or partly done)
- [x] Each fix area reviewed by an independent reviewer; the review's defects fixed
- [x] SPEC updated first-class: §2, §3.5, §4.1–4.8 (reading/writing rules; **no sheet, header or alias changes**), §5.1–5.11, §6, §7.1–7.13, §8, §9, §11.1, §15, §16, plus §17 decisions dated 2026-10-30/31
- [x] Visual redesign: three design directions judged ("Refined calm" chosen, with ideas from the other two), implemented area by area, two rounds of screenshot QA (score 8 → 8.5)
- [x] `npm run typecheck` clean; `npm test` 62 files, 736 tests, coverage 99.55 % statements / 95.26 % branches
- [x] `npm run build`: one file, 1.65 MB; `file://` in Chrome 156 and Edge 156: M5 check, §15 QA check (both modes, Thai, locked file, conflict, 10 × undo/redo, keyboard-only, report PDF 4 pages) all pass; network: the document only
- [x] Excel 365 round trip of an Excel-made file with a table, merged cells, notes, row groups, a filter, a cross-sheet drop-down, defined names, conditional formatting, Thai text and Alt+Enter predecessors: opens with no repair; notes, groups and the extra column follow their tasks

### Main fixes (data safety first)
- Excel tables no longer make the saved file unopenable (converted to normal ranges, asked before the first Save); merged cells in Tasks no longer write into other tasks' cells; notes and row groups move with their task; filters, drop-downs from another sheet and defined names are detected and asked about; unparsed Planned Start/Duration text survives unrelated edits; a 9+ digit number in a date cell no longer crashes Open.
- Predecessors: `3 4` is no longer read as 34 (invalid notation, text kept); a line break separates IDs. Renumber no longer turns dangling links into links to other tasks.
- Dates outside 1950–2199 (e.g. a 2-digit year) and durations/lags over 3650 days are refused instead of freezing or corrupting the plan; the header status date commits on Enter/blur, not on every keystroke.
- Dialogs focus the safe button (Enter no longer discards or deletes); `/` and `?` no longer overwrite a cell; shortcuts work on the Thai keyboard layout; typed progress values are saved; Delete clears the active cell like Excel (Ctrl+Delete or the ID cell deletes tasks).
- Problems list expires fixed issues and matches the header badge; issues show task names; edits during a save stay unsaved; "Save a copy" no longer suggests overwriting the original.
- Report: actual line drawn over planned, S-curve from 0 %, look-ahead 3/7/14 days (was 1/2/4 weeks — the M4 lines above are superseded), daily workload heatmap for short projects, page 3 order Late → Milestones → Look-ahead, legend on the Gantt appendix.

### New for the user
- Undo/Redo buttons; collapsible KPI strip; "N late" in the KPI filters the late tasks; Plan mode shows a violet "Editing the baseline" cue, Track shows "Baseline locked"; Track shows the selected task's dependency arrows; drawer follows the selection and has previous/next; Enter opens the drawer from the keyboard; Shift+↑/↓ multi-select; splitter usable by keyboard; drag auto-scrolls; new start screen.

### Owner decisions still open (not done because they change the Excel schema or how data is read)
- [ ] Header aliases such as `No.`, `Start Date`, `Activity`, `Progress %` (now: a warning names the missing columns).
- [ ] Should a line break in Assigned separate names, like `,`? (now: read as a space, with a Change.)
- [ ] ISO-date cells from other tools (`t="d"`) need a zip library to keep; now flagged and asked about before the first Save.
- [ ] `=TODAY()` in Status Date is now read as today and saved as a fixed date — keep?

### Owner checks still open
- Same as M5 (OneDrive pickers, Excel-locked file, conflict, reopen recent, drag from Explorer).

## Major tasks, moving rows by dragging, weekends · done 2026-11-02 (owner request)

### Acceptance
- [x] **Major tasks** (MS Project summary rows, the owner's choice): a `Level` column (1–8; after ID in the template, appended to older files only once a row is below Level 1); a row with deeper rows under it is a major task whose dates, duration, progress, status and critical flag are rolled up from its tasks (SPEC §5.12); links to or from major tasks are refused (`E_SUMMARY_LINK`, `W_SUMMARY_PREDS`); KPIs, S-curve, counts and the report's tables leave them out
- [x] Grid: indented by Level, ▸ / ▾ collapses (Alt+Shift+− / =), semibold name with its task count, calculated cells grey; search and filters bring a task's major tasks along; the drawer shows a major task read-only (name and Remarks editable)
- [x] Toolbar: Outdent / Indent (Alt+Shift+← / →) and an Outline menu (Group selected tasks, Ungroup, Collapse all, Expand all); Delete takes a major task's tasks along and always asks; Add task joins the group; Alt+↑/↓ move within the group
- [x] **Move rows by dragging**: hold a row 0.4 s or drag the grip left of the ID; a line shows where it goes and left/right picks the Level; a major task moves with its tasks; auto-scroll at the edges; Esc cancels; one undo step
- [x] **Weekends**: Saturday/Sunday day numbers in indigo on a tinted cell in the timeline, light weekend columns at Day/Week zoom (and in the report's Gantt appendix); holidays keep their grey
- [x] Excel: Save shows the outline (bold major tasks, names indented by Level, Excel row groups with the summary row above, so +/− collapses each group) — checked in Excel 365: no repair, collapsing to level 1 leaves the major tasks
- [x] SPEC first: §1.2, §2, §4.3, §4.6, §4.7, §4.8, §5.3, new §5.12, §5.11, §6, §7.2 (tokens), §7.6, §7.7, §7.8, §7.12, §8, §9.3, §11.1, §15, §16, §17 (12 decisions)
- [x] `npm run typecheck` clean; `npm test` 65 files, 773 tests, coverage 99.41 %; build; `file://` in Chrome 156 and Edge 156: M5, §15 QA and the new outline check (Group, collapse, Indent/Outdent, hold-drag and grip-drag, undo, weekends, report, Save) pass, no network, no console errors
- [x] The owner's real furnace plan (no actuals yet) converted: 23 major tasks from its Area column, "Refractory and Insulation" grouping Arch Panel … Access Door; every task's dates and links unchanged

## Print Gantt (export the plan as PDF as shown) · done 2026-11-02 (owner request)

### Acceptance
- [x] **Print Gantt** (header, next to Report; Ctrl+P in the main view) opens a print view (route `#print`, Back / Esc return) that prints the grid and the Gantt **as the main view shows them**: the mode (Plan: planned bars and every arrow; Track: baseline, forecast/actual bars, status-date line), Color by status or assignee, the critical path (red rings and red arrows), the rows shown (search, filters, collapsed major tasks) and the grid's visible columns
- [x] Paper A4 or A3 landscape (Options, remembered) and Prepared by (default Owner); the printed header says "Plan 16 Nov 2026 – 13 Dec 2026" (Plan) or "Status date …" (Track), "Prepared by …" and "Filtered" when a search or filter is on; footer with the file name and page number; Chrome/Edge name the PDF "{project} - Gantt plan {date}"
- [x] Each page: the table (ID, Task indented by Level, major tasks in bold with their task count, the visible columns; an assignee colour swatch when colouring by assignee) beside the chart fitted to the page width, headers repeated, and a legend (assignee colours or status colours, major task, milestone, critical path, dependency, non-working day) whose measured height sets the rows per page; columns that don't fit beside a 380 px chart are left out and named
- [x] Narrow windows: the Outline buttons had made the toolbar overflow (960 px in Track mode, 1100–1180 px in Plan mode) — Delete, Filter and Columns now show icons below 1100 px, and in Plan mode all five labelled buttons below 1240 px; Print Gantt is a printer icon below 1100 px so the project name keeps its room
- [x] SPEC first: §1, §7.4, §7.6, §7.12, §7.13, new §9.4, §11, §15, §17 (7 decisions)
- [x] `npm run typecheck` clean; `npm test` 66 files, 783 tests; build; `file://` in Chrome 156 and Edge 156 with the owner's real furnace plan: Plan + Color by assignee + critical path + a collapsed group + a hidden column → 7 A4 pages (24 rows each, 159 rows = the rows shown) / 5 A3 pages, PDF page counts equal the preview, table rows line up with the bars, Track mode on A3, a search prints its rows with "Filtered", nothing matched → note and Print disabled; no network, no console errors; M5, §15 QA and the outline check still pass

### Owner checks still open
- Print to a real printer (A4 and A3) and check the colours on paper.

## Public repository and GitHub Pages · 2026-11-04 (owner request)

### Acceptance
- [x] Every real name replaced by a made-up one (SPEC §17, 2026-11-04): the sample (`src/sample/sampleData.ts`) — project, owner, contractors, teams, equipment tags — and the tests, code comments, SPEC and this file; the Excel-made fixtures (`excel-saved.xlsx`, `excel-chart.xlsx`) rewritten in place (their XML parts only), `sample-project.xlsx` and `messy.xlsx` regenerated with `npm run sample`; dates, durations, links, progress and holidays unchanged
- [x] A scan of every tracked file, including the XML inside each `.xlsx`, finds no real name, e-mail address, personal path or key; the Excel files' author and company fields are empty
- [x] `npm run typecheck` clean; `npm test` 66 files, 783 tests, also with `TZ=UTC` (as on GitHub's runners); the four `.xlsx` files open in Excel 365 without repair; the sample shows the same figures (37 %, −3.5 pts, finish 17 Oct +2d, 3 late)
- [x] `.github/workflows/pages.yml`: on push to `main`, type check, tests, build, then deploy the single file as `index.html` (SPEC §3.1)
- [x] CLAUDE.md: rule 8 (made-up names only) and the GitHub Pages note
- [ ] Public history from one clean commit, Pages switched on (owner's choice of route)
