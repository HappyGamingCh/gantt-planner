# Gantt Planner — Product & Technical Specification

Version 1.0 · 2026-10-22

This document is the single source of truth for building Gantt Planner. Build it milestone by milestone (§14). Keywords: **MUST** = required, **SHOULD** = expected unless there is a good reason, **MAY** = optional.

---

## 1. Product summary

Gantt Planner is a lightweight, offline, single-file web app — a simplified MS Project — for planning and tracking one project on a Gantt chart. An Excel workbook (`.xlsx`, kept on OneDrive) is the data store. The app opens the workbook, fills in everything that can be calculated, lets the user add/edit/delete tasks, and writes back to the **same file**. One click produces a printable progress report (S-curve, overall progress, progress by assignee, and more), and another prints the grid and Gantt as they are shown, to send the plan out.

- Users: engineers and planners running projects of **≤ 200 tasks** (typically 100–150), working **every day of the week** (e.g. maintenance turnarounds); non-working days are listed in the `Holidays` sheet.
- UI language: **English**. Task data (names, remarks, people) MAY be Thai.
- Browsers: latest **Microsoft Edge** and **Google Chrome** on Windows.

### 1.1 Goals
1. **Easy.** Someone who has never used MS Project can build a plan and update progress within 5 minutes.
2. **One glance answers "are we on track?"** — progress vs plan, forecast finish, what is late.
3. **Excel stays human-friendly.** The app never breaks formatting, extra columns, or extra sheets.
4. **Zero install.** One HTML file, works offline, no server, no account.
5. **Clean and modern.** Calm, uncluttered, few colors; color only where it carries meaning.

### 1.2 Non-goals (v1)
- FF and SF dependencies (only FS and SS)
- Weighted progress (manhours, cost) — every task counts equally
- Simultaneous multi-user editing, user accounts, permissions
- Resource leveling, cost tracking, hour-level scheduling, multiple calendars
- Dark mode (future)

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Working day | Any day of the week (weekends included) that is not listed in the `Holidays` sheet |
| Planned (= Baseline) | The agreed plan: Planned Start / Duration / Finish. Used for the planned S-curve and for variance |
| Actual | What really happened: Progress, Actual Start, Actual Finish |
| Status date (SD) | The "data date": progress is reported **as of the end of** this day. Set in the header |
| R | The first working day **after** SD — when remaining work can start |
| Forecast | Expected start/finish of each task given actuals, SD and dependencies |
| Variance (d) | Working days between Planned Finish and Actual/Forecast Finish. Positive = late |
| Variance (pts) | Actual % − planned % at the status date, in percentage points (shown to 0.1). Negative = behind |
| SPI | Schedule performance index = actual % ÷ planned %; below 1 = behind plan |
| FS / SS | Link types: finish-to-start (starts after the predecessor finishes) / start-to-start (can start once the predecessor starts) |
| Lag | Working days added to a link; negative = lead (overlap) |
| Milestone | A task with Planned Duration = 0 |
| Major task | A row that groups the rows under it, like a summary task in MS Project: the rows below it with a deeper Level are its tasks. Its dates, duration and progress are calculated from them (§5.12) |
| Level | A row's depth in the outline: 1 = top level, 2 = a task of a level-1 major task, and so on (Tasks column `Level`) |
| Root task | A task with no (valid) predecessors |
| Plan mode | Mode for building the schedule (baseline is editable) |
| Track mode | Mode for updating progress (baseline is read-only) |

---

## 3. Architecture

### 3.1 Runtime & build
- Deliverable: **`dist/gantt-planner.html`**, one self-contained file. Opening it by double-click (`file://`) MUST work. Hosting it over https MUST also work.
- Dev stack: **Vite + React 18 + TypeScript (strict) + vite-plugin-singlefile**. All JS, CSS, fonts and icons are inlined.
- **No runtime network requests** — no CDNs, no Google Fonts, no telemetry. Verify with DevTools → Network.
- Published on **GitHub Pages** by `.github/workflows/pages.yml`: every push to `main` runs the type check and the tests, builds, and serves `dist/gantt-planner.html` as the site's `index.html`. It is the same file: plans are opened from and saved to the user's own computer, never uploaded. The repository is public, so sample and test data use made-up names only (§13).

### 3.2 Libraries
| Purpose | Library | Notes |
|---|---|---|
| Read/write .xlsx with styles | `exceljs` | Do NOT use SheetJS community edition — it drops formatting on write |
| Charts (report) | `chart.js` | Animations off in report |
| State | `zustand` | Undo/redo via snapshots |
| Icons | `lucide-react` | Tree-shaken |
| Fonts | `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-sans-thai` | Inlined as base64 woff2 (weights 400, 500, 600) |
| Gantt | **Custom SVG component** | No gantt library |
| Dates | **Own module** (`engine/dates.ts`, `engine/calendar.ts`) | ISO `YYYY-MM-DD` strings only |

### 3.3 Layers
```
 UI (React components)
        |
 Store (zustand: tasks, project, ui state, undo stack)
        |                              \
 Engine (pure TS: calendar, schedule,   Excel layer (exceljs: schema, read, write, template)
 forecast, progress, s-curve, issues)          |
                                         IO layer (File System Access API / fallback, recent file)
```
- **Engine** is pure and deterministic: `compute(project, tasks, calendar, resources) -> ComputeResult`. No DOM, no React, no timezone-dependent `Date` arithmetic.
- On **every** change the store re-runs the full engine (≤ 200 tasks → well under 10 ms). No incremental caching.

### 3.4 Data flow
1. **Open** → read workbook with ExcelJS → keep the `Workbook` object in memory → parse sheets → normalize (§5.3) → engine → render. Show the Load report (§7.11).
2. **Edit** → store action → push undo snapshot → engine → render → mark dirty.
3. **Save** → write values into the retained workbook (§4.8) → `writeBuffer()` → write file → clear dirty.

### 3.5 File access
- **Preferred: File System Access API.**
  - Open: `showOpenFilePicker({ types: [{ accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] })`. Keep the `FileSystemFileHandle`.
  - Drag & drop a file onto the window: use `DataTransferItem.getAsFileSystemHandle()` when available so Save still writes to the same file. The app opens the single `.xlsx` among the dropped items (e.g. the workbook dropped together with its PDF report); no `.xlsx` (other files, a folder) → "Can't open …" with the `.xlsx`-only message (plus a Save As hint for `.xls`, `.xlsm`, `.xlsb`, `.csv`); several `.xlsx` → "Drop one workbook at a time". This check comes before the unsaved-changes prompt.
  - Save: request `readwrite` permission on first save → `createWritable()` → write → `close()`.
  - Save as…: `showSaveFilePicker({ suggestedName })` with the open file's name. The plan is always written to the file picked: Chromium creates or empties that file before the picker returns, so writing nothing would leave it empty. Picking the open file itself therefore writes there with no conflict check or confirm (it is already emptied); if the plan had content Save removes (charts, …), a toast says so: "Saving removed charts from plan.xlsx, which Gantt Planner can't keep."
  - Only one picker at a time: a second Open or Save as while a picker is open (a double click) does nothing.
  - While a save or an open is running, Open, Reopen, New plan, Try sample and drop wait: a toast says "Wait for the save to finish" / "Wait for the file to open". A save's outcome only ever applies to the plan that started it, and marks as saved exactly the plan it wrote (an edit made while the file is being written stays unsaved).
- **Fallback** (API missing, e.g. Firefox, or the browser refuses a picker with `NotAllowedError`/`SecurityError`, e.g. blocked by policy): open via `<input type="file">`; Save downloads `<same name>.xlsx`, and the download becomes the open file (the file chip then reads `Downloaded 11:58`). Show a one-line banner on the start screen: "Your browser can't save directly to the file. Saving will download a new copy." (it appears as soon as a picker is refused); in the main view, until the first download, the file chip adds `· Save downloads a copy` (the banner text as its tooltip) to a plan with no file handle. When the open picker is refused, the click is used up: an error dialog offers **Choose file…** (a new click) for `<input type="file">`.
- **Recent file:** store the handle in IndexedDB (key `recentFile`). On start, show "Reopen <name>" (needs a click for permission). Wrap all IndexedDB/localStorage access in try/catch; hide the feature if unavailable. Reopen forgets the handle only when the browser reports the file missing (`NotFoundError`: "Couldn't find <name> — it may have been moved, renamed or deleted"); any other read error (e.g. OneDrive offline or still syncing) shows the error and keeps the link; a refused or dismissed permission prompt shows a toast with **Open…**.
- **Conflict detection:** remember `file.lastModified` at open/save. Before saving, call `getFile()` again. If it changed → dialog: *"This file was changed outside Gantt Planner (for example in Excel) since you opened it."* Buttons: **Reload file** · **Overwrite** · **Cancel**.
- **Locked file:** if the write throws (typically because Excel desktop has the file open) → dialog: *"Can't save — the file is probably open in Excel. Close it in Excel, then click Retry."* with the browser's error (name and message) in a muted line under it. Buttons: **Retry** · **Save a copy…** · **Cancel**. **Save a copy…** works like Save as (the copy becomes the open file), but suggests `<name> (copy).xlsx`. If the user picks the open file anyway, the browser has already emptied it, so the plan is written there and a toast says so: "You chose plan.xlsx itself, so your plan was saved there." (plus "Saving removed charts from it, which Gantt Planner can't keep." when it had such content).
- **Other save failures** (each step of Save has its own outcome; every failure is also logged to the console):
  - the file is gone (`NotFoundError` from the conflict check or the write) → *"{file name} was moved, renamed or deleted since you opened it. Save a copy to keep your changes."* Buttons: **Save a copy…** (primary) · **Cancel**.
  - the conflict check can't read the file (any other error, e.g. `NotReadableError` for an online-only OneDrive file while offline; Excel's lock doesn't block reads) → *"Couldn't read {file name} to check for changes, so nothing was written. If the file is in OneDrive, check that it has synced and is available on this computer, then click Retry."* with the error. Buttons: **Retry** (primary) · **Save a copy…** · **Cancel**.
  - the workbook can't be built (nothing written) → *"Gantt Planner couldn't prepare the workbook, so nothing was written to {file name}. Download your data to keep your changes."* with the error. Buttons: **Download my data as .xlsx** (as on the error screen, §10) · **Cancel**.
  - the permission request itself throws → the permission dialog (Try again).
  - written, but the file can't be read back → saved; the next save shows the conflict dialog instead of skipping the check.
- **Content the app can't keep:** ExcelJS drops charts, pivot tables, slicers, timelines, threaded comments, form controls, the data model, text boxes and shapes, sparklines, drop-down lists that refer to another sheet (stored by Excel as `x14:dataValidation`), links to places in the workbook (hyperlinks without a relationship), links to other workbooks, data connections, pictures in cells and linked data types (`xl/richData/`), embedded objects (`xl/embeddings/`), a sensitivity label (`docMetadata/`, or `MSIP_Label` in `docProps/custom.xml`) and defined names that aren't a fixed range (formulas, constants, whole rows or columns, sheet-scoped names; Excel's own `_xl…` names, hidden names and `#REF!` names are ignored) when it writes a file. Part names are found by a byte search of the file; the rest by inflating the parts that hold them (the zip's central directory + `DecompressionStream('deflate-raw')`); a part that can't be read is skipped, never an error. If the opened file contains any of them → warning `W_UNSUPPORTED_CONTENT`, and the first Save to that same file asks first: *"Saving will remove {parts} from {file name}."* Buttons: **Save a copy…** (primary) · **Save anyway** · **Cancel**. The same applies to date cells in ISO format (`t="d"`, written by some tools, never by Excel), which ExcelJS reads as their year number (part "date cells in ISO format (written by another program)"), and to numbers too large for a date (`W_DATE_TOO_LARGE`, part "numbers too large for a date ({cells})", §4.8).
- **Content Save converts:** Excel tables (Format as Table, on any sheet) become normal ranges on every save — cells keep their values and styles, a table's filter buttons move to its sheet when the sheet has no filter of its own (`W_EXCEL_TABLES` at load). Merged cells in Tasks below the header are split on save (`W_MERGED_CELLS`, §4.7–§4.8). Both are added to the same first-Save question ("Excel tables (their cells stay, as normal ranges)", "merged cells in Tasks (each task keeps its value)").
- **Excel filters:** ExcelJS keeps a filter's range but drops its criteria. A sheet counts as saved filtered when its XML has `<filterColumn>` or `filterMode="1"`, or when an Excel table on it has `<filterColumn>` in its table part (`xl/tables/…`, found through the sheet's relationships; Excel writes no `filterMode` for a filtered table). Tasks saved filtered → info `W_EXCEL_FILTER`, and Save shows the rows the filter hid (§4.8). Any other sheet saved filtered → "the filter on sheet "{name}" (rows it hid stay hidden)" is added to `W_UNSUPPORTED_CONTENT` and to the first-Save question: its rows stay hidden, with no filter left to clear.
- **OneDrive:** the user opens the file from their OneDrive-synced folder; OneDrive syncs it. OneDrive version history is the backup (mentioned in the Read Me sheet and Help).
- **M1 MUST verify** that the API works when the HTML is opened via `file://` in both Edge and Chrome. Record the result in the Decisions log (§17).

---

## 4. Excel workbook schema

### 4.1 Sheets
| Sheet | Purpose | App writes? |
|---|---|---|
| `Project` | Key/value settings | Values only |
| `Tasks` | One row per task | Yes |
| `Resources` | List of assignees (people, teams, contractors) | Appends new names |
| `Holidays` | Non-working dates | Never (read only) |
| `Read Me` | Instructions for people who open the file in Excel | Created by the template only; never modified afterwards |

- Sheet names match case-insensitively.
- A missing `Project`/`Tasks`/`Resources`/`Holidays` sheet is created on save. `Read Me` is only created by the template.
- A file without a `Tasks` sheet opens as a plan without tasks, with `W_NO_TASKS_SHEET` naming the sheets the file has.
- Any other sheet is preserved untouched.

### 4.2 `Project` sheet
Column A = `Field`, column B = `Value`.

| Field | Type | If blank | Notes |
|---|---|---|---|
| Project Name | text | `Untitled project` | |
| Owner | text | blank | Default "Prepared by" on the report |
| Project Start | date | Earliest Planned Start of root tasks, else today | Start for root tasks with blank Planned Start |
| Status Date | date | Today (local) | |
| Mode | `Plan` / `Track` | `Plan` | Last used mode |
| Last Saved | date-time | — | Written by the app |
| App Version | text | — | Written by the app (`1.0.0`) |

### 4.3 `Tasks` sheet
Row 1 = headers. Data starts at row 2. A row whose input columns (ID and Level excepted) and user columns are all blank is skipped (and removed on save); so is a row with only an ID. A row with data only in user columns is kept as an untitled task, so user data is never dropped.

Columns are located **by header name** (case- and whitespace-insensitive, aliases allowed), never by position. Users may reorder columns or add their own; unknown columns are preserved and travel with their task row. A column whose header is blank is a user column (`Column F`) only up to the rightmost column that has a header, a value, a formula or a note in some row (so a note travels with its task); columns further right that hold only formatting are ignored and left where they are.
- Row 1 without a `Task` header (a title row above the headers, or other header names) while the sheet has data rows → one error `E_NO_TASK_HEADER` (it names the row that seems to hold the headers among rows 2–10, else lists row 1's headers) instead of a `W_UNTITLED` per row. The rows are still read as untitled tasks with their values in user columns, so Save keeps every value. Headers are never looked for in another row.
- Some input (dark-header) columns missing while the sheet has user columns and data rows → one warning `W_COLUMNS_NOT_FOUND` listing both (up to 5 names each), since a renamed header would otherwise be ignored silently.

| # | Header | Aliases | Type | Kind | Rule |
|---|---|---|---|---|---|
| 1 | ID | Step, Step No, Step Number, No, # | integer > 0 | Input (auto) | Unique and stable. Blank → next free ID |
| 2 | Level | Outline Level | integer 1–8 | Input | Outline depth (§5.12). Blank → §4.7. A file without this column is all Level 1 |
| 3 | Task | Task Name, Name | text | Input | Blank but row has data → `(Untitled)` + warning |
| 4 | Assigned | Assigned To, Resource, Resources, PIC | text | Input | Several names separated by `,` or `;` |
| 5 | Predecessors | Predecessor, Pred | text | Input | Notation in §5.2 |
| 6 | Planned Start | Start, Plan Start | date | Input **or** Calc | Calc when the task has predecessors; input for root tasks |
| 7 | Planned Duration | Duration, Plan Duration | integer ≥ 0 (working days) | Input | 0 = milestone |
| 8 | Planned Finish | Finish, Plan Finish | date | Calc | |
| 9 | Progress (%) | Progress, % Complete, %Complete | integer 0–100 | Input | Blank → 0 |
| 10 | Actual Start | | date | Input | |
| 11 | Actual Finish | | date | Input | |
| 12 | Actual Duration | | integer | Calc | |
| 13 | Successors | Successor | text | Calc | |
| 14 | Status | | text | Calc | `Not Started` / `In Progress` / `Late` / `Completed` |
| 15 | Forecast Start | | date | Calc | |
| 16 | Forecast Finish | | date | Calc | |
| 17 | Variance (d) | Variance | integer | Calc | Positive = late |
| 18 | Critical | | `Yes` / blank | Calc | Filled from M5; blank before |
| 19 | Remarks | Remark, Notes, Comment, Comments | text | Input | |

**Header styling (template and newly added columns):**
- Input headers: fill `#1E293B`, white bold text.
- Calc headers: fill `#E2E8F0`, `#475569` italic text, cell note "Calculated by Gantt Planner — edits here are overwritten".
- Calc data cells: font color `#64748B`.
- Freeze the header row and columns A–C (ID, Level, Task). Autofilter on the header row; on save it widens to columns added on the right (never added back if the user removed it).
- Predecessors cells use the Text format (`@`): the template sets it on the column, and Save sets it on task cells and the column when they are General. In a General cell Excel turns `5,120` into the number 5120 and `3-1` into a date.
- Column widths: ID 6, Level 7, Task 40, Assigned 22, Predecessors 14, dates 12, numbers 10, Status 13, Remarks 40.
- Data validation: Progress decimal 0–100 (accepts 50 or 50%; Excel stores 50% as 0.5, which the reader turns back into 50, §4.7); Planned Duration whole number ≥ 0; Level whole number 1–8; date columns = date.

### 4.4 `Resources` sheet
| Name | Type | Color |
|---|---|---|
| text | `Person` / `Team` / `Contractor` / blank | `#RRGGBB` / blank |

- Names in `Assigned` that are not listed are appended on save (blank Type, auto color) and reported as "Filled".
- Blank Color → next color from the resource palette (§7.2).
- No `Name` header in row 1 while the sheet holds other data → `W_RESOURCES_NO_HEADER`; the sheet is not read (types and colours are not used), and Save leaves it as it is: no `Name` column is appended and no assignee rows are added, so nothing mixes into the user's columns and the warning returns on every open until the header is fixed in Excel.

### 4.5 `Holidays` sheet
| Date | Description |
|---|---|
| date | text |

The template ships with an empty table and a note in row 2 of column D: "Add non-working days here (e.g. public holidays). Every other day, weekends included, is a working day."

No `Date` header in row 1 (a renamed header, or a title row above it) while the sheet holds dates → `W_HOLIDAYS_NO_HEADER` with the number of dates found; none of them is used. Buddhist-era years (§4.7) are converted without a Change, because this sheet is never written.

### 4.6 `Read Me` sheet (template content)
Short, plain English:
1. This file is the data for Gantt Planner. Open `gantt-planner.html` and click **Open** to use it.
2. You may edit dark-header columns in Excel. Grey-header columns are calculated and will be overwritten.
3. Predecessors notation: `3` (finish-to-start), `3SS` (start-to-start), `3+2` or `3FS+2` (2-day lag), `3SS-1` (1-day lead). Separate with a comma and a space (`3, 120`).
4. Tasks with predecessors get their Planned Start calculated. To delay a task, add lag (e.g. `3+5`).
5. Planned Duration wins over Planned Finish when they disagree.
6. Gantt Planner can't keep charts, pivot tables, text boxes, shapes, sparklines or Excel tables anywhere in this file: saving removes them (a table's cells stay, as a normal range). Please don't add images, formulas or merged cells to the `Tasks` sheet.
7. Close this file in Excel before saving from Gantt Planner. Use OneDrive version history to restore older versions.
8. Assigned: separate several names with commas. Every day is a working day except the dates in the `Holidays` sheet.
9. Named ranges must be a fixed range, such as `Resources!$A$2:$A$200`; saving removes or changes other names. For a drop-down list fed from another sheet, name its range and use `=ThatName` as the list's source.
10. Major tasks: Level sets a row's place in the outline (1 = top). The rows under a row with a deeper Level are its tasks, as indenting in MS Project. A major task's dates, duration and progress are calculated: only its Task, Level and Remarks are yours to edit.

### 4.7 Reading rules
- **Dates** — accept: Excel date cells (ExcelJS gives a JS `Date` at UTC midnight → convert with `getUTCFullYear/Month/Date`), Excel serial numbers (counted from 1904-01-01 when the workbook uses the 1904 date system), text `YYYY-MM-DD`, text `d/m/yyyy` (day first), text `d-MMM-yy` / `d MMM yyyy`, also with a Thai month (`ม.ค.`–`ธ.ค.` with or without dots, or the full name: `2 พ.ย. 2569`, `2 พฤศจิกายน 2569`). In a date cell or date text, a year from 2493 to 2742 is a Buddhist-era year: 543 is subtracted (`corrected`, "Buddhist-era year converted"); with a Thai month a 2-digit year is Buddhist-era (`69` → 2569 → 2026). A date must fall in the years 1950–2199. A serial number outside Excel's range (above 2958465, e.g. a 10-digit work-order number) is unparseable, never an error; a date cell too large for Excel shows as `#####` in the message. Unparseable → warning (`W_BAD_DATE`; `W_BAD_HOLIDAY` in Holidays), treated as blank, original text kept on save (§4.8).
- **Numbers** — accept numbers or numeric text. A number shown with a date format (ExcelJS hands it over as a date before 1950, e.g. a duration of 5 shown as `05-Jan-00`) is read as that number; a real date (1950 or later) in a number column stays unparseable. Progress: if value ≤ 1 and the cell has a percent number format (a `%` outside quoted text, `[..]` sections and escaped characters: `0%` is one, `0"%"` is not) → multiply by 100; text like `50%` means 50. Round to integer, clamp 0–100 (warning if clamped). Planned Duration: rounded to a whole number (`corrected`); a day unit after the number is read too — `5d`, `5 d`, `1 day`, `5 days`, `5 วัน`, and MS Project's estimated `5 days?` (case-insensitive) — as that number of working days (`corrected`: "Unit removed"). Other units (weeks, hours, months, elapsed days such as `5 edays`), words, a negative duration, or a duration above 3650 working days (`MAX_DAYS`) → `W_BAD_NUMBER`, treated as blank (Progress: 0), original text kept on save (§4.8).
- **ID** — not a whole number from 1 to 999,999,999,999 (12 digits, `MAX_ID`) → treated as blank: the task gets the next free ID (`corrected`).
- **Formula cells** — use the cached result. Tasks: add one info issue (`W_FORMULA`) that lists where the formulas are: for each column its header as written in the file and its cells, e.g. `Manhours F2:F40, F151` (up to 3 columns, then "and N more columns"; up to 3 ranges per column, then "…"; formulas in blank rows count too). If every formula cell is in one task's row, the issue points to that task. Project sheet: a Project Start or Status Date that is exactly `=TODAY()` or `=NOW()` means today, as Excel shows it; any other formula keeps its cached value. Either way a `corrected` Change records the formula (from `=TODAY()`), because Save writes the value (§4.8).
- **Text** — trim; collapse repeated spaces in task names, assignee names and resource names. The app shows a task name on one line: line breaks (Alt+Enter) become spaces. The cell keeps its line breaks (§4.8): a name whose lines are already tidy is not a change; otherwise each line is trimmed with single spaces and blank lines are dropped (`corrected`, "Spaces tidied", to the tidied lines). In `Assigned` a line break is not a separator: inside a name it becomes a space (Change reason 'Line break read as a space; separate names with ","'); next to a `,` or `;` it is only a space ('Names separated with ", "').
- **Merged cells (Tasks)** — a merged cell other than the merge's first cell reads the merge's value only in the first cell's column: a value merged down (an Assigned cell shared by several steps) belongs to every row; a heading merged across a row stays in its own cell (the other cells read blank). A merge that starts left of the Task cell and covers it (Merge & Center over the whole row, the text in the ID cell) is read as the Task: its first cell reads blank, so the heading becomes a task with that name and the next free ID, and Save writes the text into the Task cell. One warning `W_MERGED_CELLS` lists the merges below the header; Save splits them (§4.8).
- **Level** — a whole number 1–8 (`MAX_LEVEL`); another number is rounded and clamped (`corrected`). Text that isn't a number → `W_BAD_NUMBER`, treated as blank, original text kept on save (§4.8). When no row has a Level (no column, or every cell blank) every row is Level 1 and nothing is recorded. Otherwise a blank Level takes the Level of the row below it — the last row, of the row above (`filled`, "Same level as the row below" / "above"); the first row is Level 1, and a row is at most one Level deeper than the row above (`corrected`). On a major-task row (§5.12) only Task, Level and Remarks are inputs: Assigned and Predecessors are written back as typed but not used (predecessors there → `W_SUMMARY_PREDS`), and its date, duration, progress and actual cells are calculated.
- **Predecessors** that Excel already turned into a number with a thousands format (`5,120` → 5120) or into a date (`3-1` → 1 Mar) → `W_PRED_NOT_TEXT`; the cell is written back as it is (the user must retype it).
- **Planned Start / Planned Duration** that can't be parsed are recorded per task (`Task.unparsed`) so Save keeps their text (§4.8).

### 4.8 Writing rules
- Keep the loaded ExcelJS `Workbook`; mutate it; `writeBuffer()`. **Never rebuild the workbook from scratch.** This preserves widths, freeze panes, validation, other sheets and styles.
- Write **values only**, never formulas.
- **Tasks:** rewrite data rows in the app's task order starting at row 2. Known columns come from app data; unknown columns come from `task.extra` (captured at load). Each task row keeps the cell styles, cell notes, height, hidden state and outline level (row grouping) it had at load (in a plan with major tasks the outline is the app's: see "Outline in Excel"), so formatting travels with the task; a cell the task had blank and unformatted gets the default style, not the first row's. A new task copies the styles of the first data row captured at load (or the template default), has no notes, and takes the outline level of the task above it. A note left at an address by another task is removed. When the sheet was saved filtered in Excel (§3.5), every task row is written visible. Delete leftover rows below the last task (values, styles, notes, outline level).
- Before rows are written, merges in Tasks that reach below the header are split, so every task writes into its own cells (a write into a merged cell would land in the merge's first cell).
- Excel tables on every sheet become normal ranges (§3.5).
- Ranges that covered the whole block of task rows cover it again after the save, as Excel grows or shrinks a range when rows are inserted or deleted inside it: conditional formats and the print area (grow and shrink), data validation (grow only). Other ranges are left alone.
- Input values the app could not parse (bad dates, bad numbers, invalid predecessor notation) are written back **unchanged** so user text is never lost — in input (dark-header) columns, until the user enters a value for that field in the app. Values the app derives don't count: Planned Start and Planned Duration stay unparsed (`Task.unparsed`) through the planned values stored after every edit (§17) and the switch to Track; a cell edit, a drawer edit, a Planned Finish edit (it sets the duration) or a bar drag clears them. Calculated (grey-header) columns, Planned Finish included, are always overwritten.
- A text cell (Task, Assigned, Predecessors, Remarks) whose text the app didn't change is written back as it was, so rich text, hyperlinks (web and file links; ExcelJS drops links to places in the workbook, §3.5) and numbers survive. A Task cell with line breaks (Alt+Enter) keeps them while the app's name is the same text on one line: as it was if its lines are tidy, else with each line trimmed, single-spaced and blank lines dropped (§4.7).
- **Dates:** write `new Date(Date.UTC(y, m - 1, d))` with number format `dd-mmm-yy`, unless the cell already has a date format. An input date cell (Planned Start, Actual Start, Actual Finish) holding a date with a time of day is written back unchanged while its day matches the app's value; the app plans whole days.
- **Numbers:** a number (ID, Planned Duration, Progress, Actual Duration, Variance (d)) written into a date-formatted cell gets the `General` format, so Excel shows `5`, not `05-Jan-00`. Unparsed text written back unchanged keeps its format.
- **Numbers too large for a date:** a cell in any sheet with a date format and a number above Excel's last day (a 10-digit work-order number) loads as an invalid date, and its number is lost at load. Save empties it (a formula keeps its formula, without the cached value), because written back it would make a file Excel can't open. The reader warns (`W_DATE_TOO_LARGE`) and the first Save asks first (§3.5).
- **Progress:** a cell with a percent number format (§4.7) gets a fraction (50 → 0.5) so it still shows 50%; `0"%"` gets 50.
- **Status cell fill:** Completed `#DCFCE7`, In Progress `#DBEAFE`, Late `#FEE2E2`, Not Started none.
- **Major tasks (§5.12):** on a major-task row Planned Start, Planned Duration, Progress, Actual Start and Actual Finish are calculated too, so Save writes the roll-up there; Successors is blank; Assigned and Predecessors are written back as typed. Level is written on every row (normalized, §4.7).
- **Outline in Excel:** while some row is below Level 1, Save shows the outline: a major task's Task cell is bold and every other Task cell is not, each Task cell is indented by Level − 1, and each row's outline level (row grouping) is Level − 1 (at most 7, Excel's limit) with summary rows above their detail, so Excel's +/− buttons collapse each major task. The app then owns the Task column's bold and indent and the Tasks sheet's row grouping; a plan without major tasks keeps them as the file has them.
- Missing known columns → append to the right of the header row with the correct header style, width and validation. Level is the exception: a sheet without it gets it only once some row is below Level 1 (the template has it after ID). Keys of `task.extra` without a column → append a plain column with that header.
- **Project:** update `Value` cells by `Field`; append missing fields.
- **Resources:** append unknown names, with the app's Type/Color when it has them, else blank Type and the resource palette color for the name's position in the list. A Resources sheet with content but no `Name` header in row 1 is left as it is (`W_RESOURCES_NO_HEADER`, §4.4).
- After a successful write: set Last Saved, clear dirty flag, update the `lastModified` baseline.

---

## 5. Scheduling engine

All functions are pure and unit-tested (§12). Dates are ISO strings `YYYY-MM-DD`; internally use UTC.

### 5.1 Calendar (`engine/calendar.ts`)
| Function | Definition |
|---|---|
| `isWorkday(d)` | Not a holiday — all 7 days of the week are working days |
| `snapForward(d)` | `d` if workday, else the next workday after `d` |
| `nextWorkday(d)` | First workday strictly after `d` |
| `addWorkdays(d, n)` | Start at `snapForward(d)`, move `n` workdays forward (n > 0) or backward (n < 0), skipping non-working days. `addWorkdays(d, 0) = snapForward(d)` |
| `countWorkdays(a, b)` | Number of workdays in `[a, b]` inclusive; 0 if `b < a` |
| `workdayDiff(a, b)` | Signed: `b > a` → `countWorkdays(a+1day, b)`; `b < a` → `−countWorkdays(b+1day, a)`; else 0 |

Date arithmetic clamps its results to the years 0100–9999, so an absurd span gives an absurd but well-formed date instead of an error (§10: never a crash).

### 5.2 Predecessor notation (`engine/links.ts`)
```
list  := item ( ("," | ";" | line break) item )*
item  := ID [TYPE] [LAG]          whitespace between ID, TYPE and LAG ignored, case-insensitive
ID    := digits
TYPE  := "FS" | "SS"              default FS
LAG   := ("+" | "-") digits ["d"] working days; negative = lead; at most 3650 (MAX_DAYS)
```
Examples: `3` → FS lag 0 · `3+2` → FS lag 2 · `3FS+2` → FS lag 2 · `5SS` → SS lag 0 · `5ss-1d` → SS lag −1 · `3 SS + 2` → SS lag 2 · `3, 5SS+2` · `3` and `4` on two lines of one cell (Alt+Enter) → `3, 4`.

**Canonical output** (keeps the user's order): FS lag 0 → `3` · FS lag ≠ 0 → `3FS+2` · SS lag 0 → `5SS` · SS lag ≠ 0 → `5SS-1`; joined with `, `.

**Errors** (issue + token ignored for calculation): invalid token — including whitespace between two numbers (`3 4` is never read as `34`; write `3, 4`) and a lag beyond ±3650 working days; `FF`/`SF` ("not supported in v1"); reference to a missing ID; self-reference; duplicate link to the same predecessor (keep first; warning `W_DUP_LINK`). Empty items (e.g. a trailing comma) are ignored silently. If any token has one of these issues, the cell text is written back unchanged; otherwise it is written in canonical form. Links inside a cycle are valid notation: their text is canonicalized and they are only ignored for calculation (§5.3).

**Successors** are derived: for task T, list every task S that links to T, formatted from S's link (e.g. `5, 7SS+2`), sorted by S's row order.

### 5.3 Load normalization ("auto-fill")
Run in this order on open, and the same engine on every recompute:
1. Parse rows → tasks; skip empty rows.
2. IDs: blank → assign `max + 1`; duplicates → later rows get new IDs (error, since references are ambiguous).
3. Parse predecessors; build the graph; detect cycles (strongly connected components; Kahn's algorithm orders the rest). Links inside a cycle are ignored for calculation (error lists the task IDs); tasks upstream or downstream of a cycle are still calculated.
4. Progress: blank → 0; round; clamp.
5. Planned schedule (§5.4) in topological order.
6. Actual rules (§5.5).
7. Forecast, status, variance (§5.6–5.7); critical path (§5.10, from M5).
8. Successors.
9. Resources: unknown assignees added.

**Major tasks (§5.12):** Levels are normalized after step 2 (§4.7). Steps 3–8 run on the other tasks only; major tasks are then rolled up from their tasks.

Every value that differs from the file is recorded as `Change { taskId, field, from, to, kind: 'filled' | 'corrected', reason }`. The app does **not** auto-save; it marks the plan dirty and shows the Load report.

### 5.4 Planned schedule (baseline)
**Mode matters:**
- **Plan mode:** planned values are fully derived from inputs (root-task Planned Start, Planned Duration, links) on every recompute.
- **Track mode:** stored planned values are **frozen**; only blank planned fields are derived with the same rules. Exception: tasks tagged `isNewThisSession` are computed as in Plan mode. Switching Track → Plan triggers a full recompute; if any planned date changes, show a toast "Plan recalculated — N tasks moved" with a link to the change list.

**Per task, in topological order:**
1. **Planned Start (PS)**
   - Has valid links → `PS = max(linkStart(link))` over its links, where
     - FS: `addWorkdays(pred.PF, gap + lag)`; `gap = 1`, except `gap = 0` when this task is a milestone (it sits at the end of its predecessor's finish day) or when the predecessor is a **start milestone**: a milestone with no predecessors, or whose predecessors are all start milestones (it sits at the start of its day, e.g. "Shutdown"). So `A → milestone → B` starts B on the same day as `A → B`.
     - SS: `addWorkdays(pred.PS, lag)`
     - A blank Planned Duration counts as non-milestone here.
     - If the file had a different PS → `corrected` ("Driven by predecessors — use lag to delay").
   - Root task → `PS = snapForward(user PS ?? Project Start)`; if snapped → `corrected` ("Moved to next working day").
2. **Planned Duration (PD)** — blank: if the file has PF ≥ PS → `PD = countWorkdays(PS, PF)` (`filled`); else `PD = 1` (`filled` + warning). A PD above 3650 working days (`MAX_DAYS`) that reaches the engine is invalid: `W_BAD_NUMBER`, then treated as blank.
3. **Planned Finish (PF)** — `PD ≥ 1 ? addWorkdays(PS, PD − 1) : PS`. If the file had a different non-blank PF → `corrected` ("Recalculated from duration").

Example (2026): PS Mon 2 Nov, PD 5 → PF Fri 6 Nov. Successor with `FS` → PS Sat 7 Nov. Successor with `SS+2` → PS Wed 4 Nov. A milestone with `FS` after the first task → Fri 6 Nov, and a task with `FS` after that milestone → Sat 7 Nov. A start milestone on Mon 2 Nov → its `FS` successors start Mon 2 Nov.

### 5.5 Actual rules
| Situation | Behaviour |
|---|---|
| Actual Duration | `AF ? countWorkdays(AS, AF) : (AS ≤ SD ? countWorkdays(AS, SD) : blank)`; at least 1 when AS is set; milestones = 0 |
| AF set, Progress ≠ 100 | Progress = 100 (`corrected`) |
| Milestone with AF set and AS blank | AS = AF (`filled`) |
| Milestone with Progress = 100 and no AF | warning + quick fix "Set Actual Finish = status date" (this warning only; applying it also fills AS by the rule above) |
| Milestone with AS set (entered, not a substitute) on or before SD, and AF blank | Warning `W_MS_NO_AF` + quick fix "Set Actual Finish = Actual Start". For calculation treat as completed on AS, and Progress = 100 (`corrected`, written on save), so applying the quick fix changes no number (at Progress = 100 too: this warning only). An AS after SD doesn't count as reached: the "Actual date after SD" warning only |
| AF set, AS blank (non-milestone) | Warning. For calculation treat AS = AF |
| AF < AS | Warning. For calculation treat AF = AS |
| Progress > 0, AS blank | Warning + quick fix "Set Actual Start = `min(PS, SD)`". For calculation treat AS = `min(PS, SD)` |
| Progress = 100, AF blank | Warning + quick fix "Set Actual Finish = status date". For calculation treat as completed at SD. A non-milestone with AS blank (or outside 1950–2199) too: the quick fix also sets Actual Start = `min(PS, SD)` (the start used for calculation), so applying either quick fix first changes no number |
| Actual date after SD | Warning ("Actual date is after the status date") |
| Actual Start or Actual Finish outside 1950–2199 (e.g. a 2-digit year typed as 0026) | Warning `W_BAD_DATE`; treated as blank for calculation. The engine doesn't rewrite the stored value |

The "for calculation" substitutes are **never written** to Excel.

### 5.6 Forecast
Let `R = nextWorkday(SD)`. Process in topological order.

| Task state | Forecast Start (FS′) | Forecast Finish (FF′) |
|---|---|---|
| Completed (AF set, or treated as completed) | AS | AF |
| In progress (AS set, no AF) | AS | `addWorkdays(R, remaining − 1)` where `remaining = max(1, ceil(PD × (100 − Progress) / 100))` |
| Not started | `max(snapForward(PS), R, constraints)` | `PD ≥ 1 ? addWorkdays(FS′, PD − 1) : FS′` |

Constraints for not-started tasks, from each predecessor's forecast:
- FS: `addWorkdays(pred.FF′, gap + lag)` (gap as in §5.4)
- SS: `addWorkdays(pred.FS′, lag)`

In-progress tasks are not moved by predecessors (they already started).

### 5.7 Status & variance
- `finishRef = AF ?? FF′`
- `Variance (d) = workdayDiff(PF, finishRef)` → positive = late, negative = early.
- **Status:**
  1. `Completed` — AF set (or treated as completed)
  2. `Late` — not completed and Variance > 0
  3. `In Progress` — AS set or Progress > 0
  4. `Not Started` — otherwise

A task not started whose planned start has passed is pushed to R by the forecast, so its forecast finish passes the planned finish and it becomes Late. An in-progress task behind on progress gets a later FF′ and becomes Late. One rule covers both.

### 5.8 Progress metrics
- **Every task has equal weight. Milestones are excluded** from all percentages.
- `plannedPct(task, d)`: `d < PS` → 0; `d ≥ PF` → 100; else `countWorkdays(PS, d) / PD × 100`.
- `actualPct(task)` = Progress.
- **Project actual %** = mean of Progress. **Project planned %** = mean of `plannedPct(task, SD)`.
- **Variance (pts)** = actual % − planned %.
- **SPI** = actual / planned (show `—` when planned = 0).
- **Schedule state** (constants in `config.ts`): ≥ +2.0 pts `Ahead` (green) · > −2.0 `On track` (green) · > −5.0 `Slightly behind` (amber) · otherwise `Behind` (red).
- **Planned Finish (project)** = max PF. **Forecast Finish (project)** = max finishRef. **Finish variance** = `workdayDiff` between them.
- **Time elapsed** = `countWorkdays(project PS, min(SD, project PF)) / countWorkdays(project PS, project PF)`.
- **This week** (the 7 days ending at SD): `actualPctAt(SD) − actualPctAt(SD − 7 days)` and the same for planned.
- **Counts:** Completed, In Progress, Not Started, Late — over non-milestone tasks (like the percentages); milestones done / total separately.
- **By assignee:** the same metrics over the tasks that list that assignee (a shared task counts fully for each assignee). Tasks without an assignee are grouped as `Unassigned`.

### 5.9 S-curve data
Points for every working day from `min(all PS, all AS)` to `max(project PF, project forecast finish)`. A span longer than 2000 days (only absurd durations or lags make one) is sampled every ⌈span / 2000⌉ days; the first day, the status date and the last day are always points.

| Series | Range | Task value at date d |
|---|---|---|
| Planned | whole range | `plannedPct(task, d)` |
| Actual | start → SD | Not started: 0. Completed: 0 before AS, linear AS→AF, 100 from AF. In progress: 0 before AS, linear from 0 at AS to Progress at SD |
| Forecast | SD → end | Completed: 100. In progress: linear from Progress at SD to 100 at FF′ (measured from R). Not started: 0 before FS′, linear FS′→FF′, 100 after |

Project value = mean over non-milestone tasks. `forecast(SD) = actual(SD)` so the lines join.

`actualPctAt(d)` used in §5.8 is the Actual series value at `d`.

### 5.10 Critical path (M5)
On the forecast network of tasks that are not completed:
- Backward pass from the project forecast finish: for tasks without successors `LF = project forecast finish`; `LS = addWorkdays(LF, −(PD − 1))` (milestones: `LS = LF`).
- For each link: FS → `pred.LF ≤ addWorkdays(succ.LS, −(gap + lag))`; SS (only while the predecessor has not started) → `pred.LS ≤ addWorkdays(succ.LS, −lag)`, then `pred.LF = addWorkdays(pred.LS, PD − 1)`. Take the minimum. A started predecessor has met its SS links: its start is an actual, and §5.6 never moves an SS successor by the predecessor's finish.
- `Total float = workdayDiff(FF′, LF)`. **Critical = not completed and float ≤ 0.**

### 5.11 Issue catalog
| Code | Severity | Message | Quick fix |
|---|---|---|---|
| E_DUP_ID | error | ID {id} is used more than once; row {n} got ID {new} | — |
| E_CYCLE | error | Circular dependency: {ids} | — |
| E_BAD_LINK | error | Task {id}: "{token}" is not valid predecessor notation | — |
| E_UNSUPPORTED_LINK | error | Task {id}: FF/SF links are not supported yet | — |
| E_MISSING_PRED | error | Task {id}: predecessor {pid} does not exist | Remove link |
| E_SELF_LINK | error | Task {id} cannot depend on itself | Remove link |
| W_DUP_LINK | warning | Task {id}: predecessor {pid} is listed more than once | — |
| W_START_DRIVEN | info | Task {id}: start set by predecessors | — |
| W_NONWORKDAY | info | Task {id}: start moved to next working day | — |
| W_FINISH_RECALC | info | Task {id}: finish recalculated from duration | — |
| W_NO_DURATION | warning | Task {id}: no duration, set to 1 day | — |
| W_PROGRESS_NO_AS | warning | Task {id}: has progress but no actual start | Set Actual Start = min(PS, SD) |
| W_100_NO_AF | warning | Task {id}: 100% but no actual finish | Set Actual Finish = SD (non-milestone with no AS: also Actual Start = min(PS, SD)) |
| W_MS_NO_AF | warning | Task {id}: milestone has an actual start but no actual finish | Set Actual Finish = Actual Start |
| W_AF_NO_AS | warning | Task {id}: actual finish without actual start | Set Actual Start = Actual Finish |
| W_AF_BEFORE_AS | warning | Task {id}: actual finish is before actual start | — |
| W_FUTURE_ACTUAL | warning | Task {id}: actual date is after the status date | — |
| W_BAD_DATE | warning | Task {id}: "{text}" in {field} is not a date | — |
| W_BAD_NUMBER | warning | Task {id}: "{text}" in {field} is not a valid number | — |
| W_BAD_HOLIDAY | warning | Holidays row {n}: "{text}" is not a date | — |
| W_UNSUPPORTED_CONTENT | warning | This file contains {parts}; Gantt Planner can't keep them, so saving will remove them | — |
| W_EXCEL_TABLES | warning | This file has Excel tables ({names}); Gantt Planner can't keep them, so saving turns them into normal ranges. Formulas that use a table's name will show #REF! | — |
| W_MERGED_CELLS | warning | Merged cells in Tasks ({ranges}) will be split when you save; each task keeps its own value | — |
| W_EXCEL_FILTER | info | The Tasks sheet is filtered in Excel; Gantt Planner can't keep Excel filters, so saving shows every task row | — |
| W_PRED_NOT_TEXT | warning | Task {id}: Excel changed the Predecessors you typed into {text}. Retype them with a space after each comma (5, 120), or write a lead as 3FS-1 | — |
| W_PROGRESS_CLAMPED | warning | Task {id}: progress {v} adjusted to {c} | — |
| W_FORMULA | info | Formulas in Tasks will be saved as values: {where} | — |
| W_UNTITLED | warning | Row {n} has data but no task name | — |
| W_NEW_RESOURCE | info | Added "{name}" to Resources | — |
| W_NO_TASKS_SHEET | warning | No sheet named "Tasks": this file has {sheets}. Rename the sheet with your tasks to Tasks (headers in row 1) and open the file again | — |
| E_NO_TASK_HEADER | error | Tasks sheet: row 1 has no "Task" header{hint} | — |
| W_COLUMNS_NOT_FOUND | warning | Tasks sheet: columns not found: {missing}. Kept as your own columns: {extras}. If one of them is meant to be a planner column, rename its header in Excel and open the file again | — |
| W_HOLIDAYS_NO_HEADER | warning | Holidays sheet: no "Date" header in row 1; its dates ({n}) were not used, so they count as working days | — |
| W_RESOURCES_NO_HEADER | warning | Resources sheet: no "Name" header in row 1, so its types and colors were not read and Save leaves the sheet as it is (new assignees are not added). Rename the column with the names to "Name" in Excel and open the file again | — |
| E_SUMMARY_LINK | error | Task {id}: {pid} is a major task; link to a task inside it | Remove link |
| W_SUMMARY_PREDS | warning | Major task {id}: its predecessors are not used; link the tasks inside it | — |
| W_DATE_TOO_LARGE | warning | Numbers too large for a date in {cells} (Excel shows #####); Gantt Planner can't keep them, so saving removes them. To keep a number, give its cell a number format in Excel and open the file again | — |

`W_PRED_NOT_TEXT` {text}: "the number 1,234" or "the date 2026-03-01".

`W_NO_TASKS_SHEET` {sheets}: the file's sheet names in quotes, or "no sheets".

`E_NO_TASK_HEADER` {hint}: `; the headers seem to be in row {n}. Delete the rows above them in Excel and open the file again` when rows 2–10 hold a Task header; otherwise `; it has "No", "Activity", …. Rename the column with the task names to "Task" in Excel and open the file again` (row 1's headers in quotes, at most 5, then "and N more"), or `. Put the column headers in row 1 and open the file again` when row 1 is empty.

`W_DATE_TOO_LARGE` {cells}: up to 3 cells in any sheet, as `Tasks!I2` or `'Work orders'!B2` (a sheet name with characters other than letters, digits, `_` and `.` is quoted), then `, …`.

### 5.12 Major tasks (outline)
- **Outline:** rows keep their order and each has a Level (§4.7). A row is a **major task** when the row below it has a deeper Level; its **tasks** are the rows below it up to the next row at its Level or shallower, and its **leaf tasks** are those of them that are not major tasks themselves. A row's parent is the nearest row above it with a smaller Level. A plan with every row at Level 1 has no major tasks and works as before.
- **Calculation:** §5.3–§5.10 run on leaf tasks only. A major task has no links and no dates or progress of its own: its Planned Start, Planned Duration, Progress and actual dates in the file are not read. Each major task is then rolled up from its leaf tasks:
  - Planned Start = earliest Planned Start; Planned Finish = latest Planned Finish; Planned Duration = working days from that start to that finish (0 when every leaf task is a milestone on one day).
  - Forecast Start / Forecast Finish = earliest forecast start / latest forecast finish.
  - Actual Start = earliest actual start used for calculation (§5.5); Actual Finish = latest finish once every leaf task is completed, else blank; Actual Duration as §5.5.
  - Progress = the mean progress of its non-milestone leaf tasks (every task weighs the same, as the KPI, §5.8); a major task of milestones only is 100 when all are reached, else 0. Planned % at SD likewise.
  - Variance and Status from its own dates with §5.7: Completed when every leaf task is; Late when its forecast finish is after its planned finish; In progress when one of them has started; else Not started.
  - Critical when any of its leaf tasks is critical.
- **Links:** a predecessor that names a major task → `E_SUMMARY_LINK` (text kept, link not used; quick fix Remove link). Predecessors typed on a major-task row → `W_SUMMARY_PREDS` (kept as typed, not used).
- **Counts:** major tasks are not tasks or milestones for the KPI strip, the S-curve, progress by assignee, the critical path, the report's tables or the Filter's counts.
- **Modes:** a major task always follows its tasks, in Plan and Track mode; it has nothing of its own to freeze.

---

## 6. Modes

A segmented control in the header switches **Plan** ↔ **Track**. The mode is saved to `Project › Mode`.

| | Plan mode | Track mode |
|---|---|---|
| Purpose | Build and adjust the baseline | Update progress against the baseline |
| Editable | Task, Assigned, Predecessors, Planned Start (root tasks), Planned Duration, Planned Finish (→ changes duration), Remarks | Task, Assigned, Progress, Actual Start, Actual Finish, Remarks |
| Read-only | Actual fields shown on demand only | Planned fields and Predecessors — except tasks added in Track mode during this session (tag "New") |
| Default grid columns | ID, Task, Assigned, Duration, Start, Finish, Predecessors | ID, Task, Assigned, Progress, Actual Start, Actual Finish, Forecast Finish, Variance, Status |
| Gantt bars | Planned bars + dependency arrows | Thin baseline bar + forecast/actual bar with progress fill, status colors, status date line; the hovered or selected task's dependency arrows |
| KPI strip | Start · Finish · Duration · Tasks · Milestones · Assignees | Progress · Schedule · Finish · Tasks · Time |
| Toolbar | Undo, Redo, Add, Link, Unlink, Delete, Outdent, Indent, Outline menu, zoom, search, filter, columns | Undo, Redo, Add, Delete, Outdent, Indent, Outline menu, zoom, search, filter, columns |
| Outline (§5.12) | Indent, Outdent, Group, Ungroup, move rows (§8) | The same: the outline changes no task's dates |

Switching Track → Plan when any task has an Actual Start shows a confirm once per opened or created plan (Open, Try sample and New plan ask again): *"Plan mode lets you change the baseline. The planned S-curve and variances will change."* **Switch to Plan** · **Stay in Track**.

New file default: Plan mode. The sample opens in Track mode.

---

## 7. UI design

### 7.1 Principles
1. **Calm by default.** White surfaces, slate text, one blue accent for actions, selection and "now". Red/amber appear only for late or at-risk items. The one other hue in the chrome is the Plan-mode violet (§7.4), which never appears on data.
2. **Show the answer first.** The KPI strip answers "are we on track?" before the user reads any row.
3. **Edit where you look.** Quick edits inline in the grid; full edits in a side drawer that never covers the grid.
4. **Mode-specific views.** Each mode shows only the columns and controls needed for its job, and says which mode it is: the Mode switch has icons, tooltips and a caption, and Plan mode — the one that changes the baseline — tints the grid header row and the timeline header violet.
5. **Forgiving.** Undo for everything, clear save state, warnings instead of crashes.
6. **Readable everywhere.** Text meets 4.5:1 and marks, edges and state indicators 3:1 on every surface they sit on (hover, selected, holiday), secondary text included; only disabled controls are paler.

### 7.2 Design tokens (`src/styles/tokens.css`)
```css
:root {
  /* surfaces: white work areas on a cool off-white page; -2 = hover, header bands, read-only fills; -3 = tracks, pressed */
  --bg: #F6F7F9;          --surface: #FFFFFF;      --surface-2: #F1F3F6;
  --surface-3: #E8EBF0;   /* new: mini-bar and KPI tracks, segmented track, pressed buttons, count pills */
  --border: #E3E6EB;      --border-strong: #CBD2DB;
  --field-edge: #848FA2;  /* new: bottom edge of text/date/number/select fields, field hover (3.27:1, WCAG 1.4.11) */
  --selected: #DBEAFE;    /* new: selected grid row and Gantt lane (same value as --accent-soft, its own meaning) */
  /* text */
  --text: #0F172A;        --text-2: #475569;
  --text-3: #57657A;      /* was #94A3B8 (2.56:1). Secondary text people read: IDs, labels, hints. >= 4.85:1 on every surface */
  --text-placeholder: #6B7789; /* new: placeholders and empty date inputs (4.54:1) */
  --text-disabled: #94A3B8;    /* new: disabled controls ONLY (WCAG-exempt); the old --text-3 value */
  --text-inverse: #FFFFFF;     /* new: text and icons on --accent, --late and --text fills */
  /* accent: fills, strokes, focus. Blue TEXT always uses --accent-text (--accent text is 4.24:1 on a selected row) */
  --accent: #2563EB;      --accent-hover: #1D4ED8; --accent-soft: #DBEAFE;
  --accent-active: #1E40AF; /* new: pressed primary */
  --accent-softer: #EFF5FF; /* new: hover tints, start-screen icon squares, active menu button */
  --accent-text: #1D4ED8;   /* new: links, selected segment label, "Today" */
  --focus: #2563EB;         /* new: focus ring */
  /* modes (SPEC §6): Plan is flagged in violet; Track is the neutral default. Chrome only, never data. */
  --plan: #6D28D9;        /* new: Plan text and icons (7.10:1 on white, 5.98 on --plan-soft) */
  --plan-edge: #7C3AED;   /* new: ring of the lit Plan option (4.77:1 vs the segmented track) */
  --plan-soft: #EDE9FE;   /* new: "Editing the baseline" caption pill */
  --plan-wash: #F3F0FD;   /* new: Plan-mode header bands; same lightness as --surface-2, violet hue */
  --head-bg: var(--surface-2); /* new: grid header row + Gantt timeline band; re-pointed by .main.mode-plan below */
  /* status */
  --done: #15803D;        /* was #16A34A (2.70:1 on a selected lane). 5.02 white, 4.11 selected */
  --done-soft: #DCFCE7;
  --progress: #2563EB;    --progress-soft: #DBEAFE;
  --late: #DC2626;        --late-soft: #FEE2E2;
  --risk: #D97706;        --risk-soft: #FEF3C7;    /* --risk as a graphic only on --surface (3.19:1) */
  --idle: #64748B;        /* was #94A3B8 (2.56:1). 4.76 white, 3.90 selected */
  --idle-soft: #F1F5F9;
  /* status text on white, the soft colours and --selected (WCAG AA) */
  --done-text: #166534;   --progress-text: #1D4ED8; --late-text: #B91C1C; --risk-text: #92400E;
  /* gantt */
  --baseline: #707F95;    /* was #CBD5E1 (1.48:1). 4.07 white, 3.34 selected, 3.04 holiday-on-selected */
  --nonwork: #F3F4F6;     /* unchanged */
  --arrow: #77849A;       /* was #94A3B8 (2.56:1). 3.78 white, 3.40 hover, 3.10 selected */
  /* major tasks (§5.12, §7.7, §7.8) */
  --summary: #334155;     /* major-task bar and its end caps: 10.35 white */
  --summary-soft: #E2E8F0; /* undone part of a Track-mode major-task bar, inside its --summary border */
  --summary-band: #F8FAFC; /* a major task's grid row and Gantt lane; the hover (--surface-2) and selected bands still show */
  /* weekends (§7.8): working days, so lighter than a holiday's --nonwork, in a hue apart from it and the Plan wash */
  --weekend: #EEF2FF;     /* timeline day cell */
  --weekend-col: #F5F7FF; /* chart column */
  --weekend-text: #4338CA; /* day number on --weekend: 7.07 */
  /* shape */
  --radius-xs: 4px;       /* new: menu items, kbd, New tag, swatch-adjacent corners */
  --radius-sm: 6px;  --radius: 8px;  --radius-lg: 12px;
  --radius-xl: 16px;      /* new: start card, drop zone */
  --radius-pill: 999px;   /* new: status pills, KPI pills, badges, counts */
  --shadow-xs: 0 1px 1px rgba(15,23,42,.05);                                            /* new: outlined buttons, lit segment */
  --shadow-1: 0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.08);               /* cards, report sheets */
  --shadow-2: 0 2px 4px -1px rgba(15,23,42,.06), 0 12px 24px -6px rgba(15,23,42,.16);   /* menus, popovers, tooltip, toast */
  --shadow-3: 0 4px 8px -2px rgba(15,23,42,.08), 0 24px 48px -12px rgba(15,23,42,.24);  /* new: dialogs, drawer, issues sheet */
  --backdrop: rgba(15,23,42,.32);   /* behind modal dialogs */
  /* type: only 400/500/600 are inlined; never use 700 */
  --font: "IBM Plex Sans", "IBM Plex Sans Thai", "Leelawadee UI", system-ui, sans-serif;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-base: 14px; --fs-lg: 16px; --fs-xl: 20px; --fs-kpi: 26px;
  --fs-2xl: 24px;                                         /* new: start-screen headline only */
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; /* new */
  --lh-tight: 1.2;   /* new: Latin-only figures (KPI values) */
  --lh: 1.45;        /* new: body (= base.css today) */
  --lh-ui: 1.5;      /* new: single clipped lines that can show Thai (no clipped tone marks) */
  --lh-prose: 1.6;   /* new: dialog body, Remarks, key messages, start sub */
  --tracking-caps: 0.04em; /* new: 11 px uppercase ENGLISH labels only, never data */
  /* spacing (4px scale) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px;
  --sp-8: 32px; --sp-10: 40px;                            /* new */
  /* controls */
  --control-h-sm: 28px; --control-h: 32px; --control-h-lg: 36px; /* new */
  /* motion (§7.2: 150 ms ease-out for hover, drawer and popovers only) */
  --ease: 150ms ease-out;                                 /* new */
  /* layout */
  --row-h: 36px;          /* compact 30px, comfortable 40px */
  --header-h: 60px;       /* was 56 (min-height; it grew to ~64 with the "Today is" hint). Now a fixed height */
  --toolbar-h: 44px; --drawer-w: 400px;
}

/* Mode scope (SPEC §6, §7.1): MainView puts mode-plan / mode-track on .main. Only --head-bg changes. */
.main.mode-plan { --head-bg: var(--plan-wash); }
```
- Numbers use `font-variant-numeric: tabular-nums`.
- Status colours fill bars and marks; text in a status colour (chips, KPI state labels, variance) uses the darker `--*-text` tokens so it meets WCAG AA (§10).
- Text tokens: `--text-3` is secondary text people read (IDs, labels, hints) and meets AA everywhere; `--text-placeholder` is for placeholders and empty date inputs; `--text-disabled` is for disabled controls only. Blue text uses `--accent-text`, never `--accent`.
- `--selected` marks the selected row and lane; where it meets a status colour (the In progress pill, the unfinished part of an In progress or Not started bar), the status element is drawn on white.
- Fields: a light `--border-strong` box with a darker `--field-edge` bottom edge (3:1); dialog fields 36 px; drawer fields, the status date, the search box and the assignee editor 32 px; the predecessor type and lag, the progress number and the project-name rename field 28 px. Buttons keep `--border-strong`; secondary tool buttons are borderless "ghost" buttons. A button that is unavailable but keeps its Tab stop (`aria-disabled`) looks like a disabled one.
- Plan-mode tokens (`--plan`, `--plan-edge`, `--plan-soft`, `--plan-wash`) are used only for the mode cue: the lit Plan option, its caption and `--head-bg` (the grid header row and timeline band).
- Pills (status chips, KPI states, the Issues badge, filter chips, counts): fully rounded (`--radius-pill`), soft fill + strong text (the Filter button's count is solid blue); status pills 20 px, KPI pills 22 px (20 px in the collapsed strip), the Issues badge and filter chips 24 px, counts 16–18 px. Uppercase and letter-spacing only on 11 px English labels, never on data.
- Shadows: xs outlined buttons and the lit segment · 1 cards and report sheets · 2 menus, popovers, tooltip, toast · 3 dialogs, drawer, Issues panel.
- Segmented controls (Mode, Zoom, report look-ahead, progress steps): 32 px overall on a `--surface-3` track; the selected option is a white thumb with a 1 px ring and blue text (violet in Plan for the Mode switch, §7.4).
- Menus and popovers: 32 px menu items with 4 px corners, grey shortcut hints, full-width separators; popover groups are headed by 11 px overlines and made of 26 px checkbox rows with a hover fill. A popover taller than the room below its button ends 8 px above the window's bottom edge and scrolls inside; the Filter assignee list scrolls after 10 names (fewer in a short window). The open menu or popover keeps its button highlighted.
- Focus ring: `2px solid var(--focus)` (the accent blue), offset 2px.
- Motion: 150 ms ease-out (`--ease`) for hover, drawer and popovers (menus and popovers fade in and slide 4 px). No other animation. When the OS asks for reduced motion (`prefers-reduced-motion: reduce`, e.g. Windows "Animation effects" off) there are no transitions or animations at all.
- **Resource palette** (Color by assignee, avatars): `#2563EB #0D9488 #D97706 #7C3AED #DB2777 #0891B2 #65A30D #EA580C #4F46E5 #475569`.
- **Date display:** grid `dd MMM yy` (22 Oct 26); tooltips/report `d MMM yyyy` (22 Oct 2026). Durations `5d`. Percent integer `42%`, rounded half up, but 100% only when the value is exactly 100 and 0% only when it is exactly 0 (99.7 → `99%`, 0.3 → `1%`); the report's assignee bars use the same rounding. Variance `+3d` / `−1d` / `—`. Week starts Monday.

### 7.3 Layout
```
+------------------------------------------------------------------------------------------------+
| <> Control Room Upgrade  v      ( Plan | [Track] )    Status date [13 Nov 26] Today   !3   ...  |
|    control-room.xlsx . Saved 11:58                        [Open]  [Save]  [Report]             |
+------------------------------------------------------------------------------------------------+
| PROGRESS          | SCHEDULE         | FINISH               | TASKS               | TIME          |
| 42%   plan 47%    | -5.0 pts Behind  | 12 Dec 26  +3d       | 8/20 done  2 late   | Day 34 of 60  |
| [####------]      | SPI 0.89         | planned 9 Dec 26     | [##|#|---]          | [######---]   |
+------------------------------------------------------------------------------------------------+
| [<-][->]  [+ Add task]  [Delete]  | Day Week Month Fit | [/ Search] [Filter v] [Columns v] [=] |
+---------------------------------------------+--------------------------------------------------+
| ID  Task              Assigned  Prog  Fcst   |  Nov 2026                                        |
|                                             |  10  11  12  13 :14  17  18  19  20  21          |
| 1   Kick-off meeting  (SA)      100%  3 Nov  |  <>             :                                |
| 2   Site survey       (SA)(KT)   60% 18 Nov  | ####=====------ :                                |
| 3   Detailed design   [Eng]       0% 28 Nov  |                 :  ------------->                |
|                                             |                 : Status 13 Nov                  |
+---------------------------------------------+--------------------------------------------------+
                                                  Double-click a row -> Task drawer slides in (right)
```
- Grid (left) and Gantt (right) share vertical scroll. The grid opens wide enough for its visible columns, up to 60 % of the window (320–900 px). A splitter between them is draggable (←/→ when focused) and sets the width for the current mode; double-click it (or press Enter on it) to fit the columns again.
- The KPI strip can be collapsed to a single line with the chevron at its right edge: each card keeps its label, value and state chip ("N late", the Finish chip); captions and mini bars are hidden. Expanded by default; remembered in preferences (`kpiCollapsed`). The report always shows the full cards.
- The header is a fixed 60 px (`--header-h`), so the strip below it never moves. In Plan mode the grid header row and the Gantt timeline header use `--plan-wash` instead of `--surface-2` (`--head-bg`).
- Drawer slides over the Gantt side only; the grid stays visible.

### 7.4 Header
- Left: small app mark (diamond SVG), **project name** (click to edit inline), below it the **file chip**: file name · save state (`Saved 11:58` / amber dot `Unsaved changes` / `Saving…` / `Opening plan.xlsx…`; `Downloaded 11:58` after a fallback save; in fallback mode, before the first download, `· Save downloads a copy` follows the state, §3.5). `Saving…` starts once Save as… has a file, not while the picker is open.
- Center: **Mode** segmented control with an icon on each option and a tooltip stating its purpose (§6: "Plan mode: build and adjust the baseline (dates, durations, links)", "Track mode: update progress against the baseline"). The selected option is a white thumb with a 1 px ring: violet in Plan, blue in Track. Under it, a caption: Plan "Editing the baseline" (violet pill with a pencil icon), Track "Baseline locked" (lock icon).
- Right: **Status date** date input + "Today" text button · **Issues badge** (`!` + count of errors and warnings — the same number as the Problems tab; amber if warnings, red if errors; hidden when 0; its tooltip and accessible name say it in words, e.g. "2 errors, 1 warning") · **Open** (secondary) · **Save** (primary; disabled when clean) · **Report** (secondary) · **Print Gantt** (secondary, §9.4; below 1100 px a printer icon with the same tooltip and name) · **More (…)** menu (borderless icon button): New plan, Save as…, Download blank template, Project settings (name, owner, project start), Renumber IDs, Keyboard shortcuts, About.
- When SD ≠ today, show a subtle hint under the date: "Today is 22 Oct".
- The header has two rows. Every control — the Mode switch, the status date (label, input, Today), the Issues badge, Open, Save, Report, Print Gantt and More — sits on one top row; the captions under them ("Baseline locked" / "Editing the baseline", "Today is 22 Oct") make the second row, level with the file chip under the project name. The hint coming or going never moves a control.

### 7.5 KPI strip
Equal-width cards (5 in Track mode, 6 compact cards in Plan mode), separated by inset hairlines. Each card: label 11px uppercase `--text-3`; value `--fs-kpi` semibold with its state as a pill (soft fill + strong text: green good, amber risk, red bad, grey neutral); caption 12px `--text-2`; and the mini bar on the card's bottom edge, so the bars of all cards line up.

**Track mode**
1. **Progress** — actual %; caption "plan 47%"; dual mini bar (plan marker over actual fill).
2. **Schedule** — variance pts with a state pill colored by state; caption "SPI 0.89".
3. **Finish** — forecast finish; chip `+3d` (red) / `−2d` (green) / `on time`; caption "planned 9 Dec 26".
4. **Tasks** — "8/20 done"; "2 late" as a red pill when > 0 — in the main view a toggle button (solid red with white text while the filter is on) that filters the grid to Status = Late (late milestones included; search and assignee filters stay), plain text on the report; stacked mini bar Completed / In progress / Late / Not started (the empty track); caption "milestones 1/3" (milestones done / total; no caption without milestones).
5. **Time** — "Day 34 of 60" working days; caption "26 working days left" (to the planned finish, never below 0; "1 working day left"); mini bar.

**Plan mode**: Start · Finish · Duration (working days) · Tasks · Milestones · Assignees (6 compact cards).

**Tooltips**: each card explains its figure on hover. Progress: actual and planned % with two decimals (so the rounded figures add up); Schedule: the subtraction behind Variance (pts), the state bands (from `config.ts`, never hard-coded) and SPI spelled out ("SPI" is also an `<abbr>`); Finish: forecast vs planned finish in working days; Tasks: the count per status (the mini bar's legend; milestones not counted); Time and the Plan-mode Duration: how working days are counted. Tooltips don't print.

**No tasks**: when the plan has no non-milestone tasks, the Track cards show "—" with "No tasks yet" (no state pill, no Progress or Tasks mini bar, no Tasks caption; Tasks reads "0 tasks"); Finish and Time show "—" too when there are no milestones either (then no "on time" chip and no Time caption or mini bar). The Plan cards are unchanged (Project Start and 0 are facts there). The engine values stay as they are (§17: mean of no tasks = 0).

### 7.6 Toolbar
- **Look:** **+ Add task** is the only filled button and the zoom control the only boxed group; Undo, Redo, Link, Unlink, Delete, Filter, Columns and Density are borderless (ghost) buttons that show a background on hover; dividers separate history | edit | view. Search is an outlined field with a "/" hint while empty; Filter is tinted blue while a filter is on.
- **Undo / Redo** (icon buttons at the left of the toolbar, in both modes; disabled when there is nothing to undo / redo, but they keep the keyboard focus; tooltips "Undo (Ctrl+Z)" / "Redo (Ctrl+Y)").
- **+ Add task** (primary, icon): inserts below the selected row, else appends; opens the drawer focused on the name.
- **Link / Unlink** (Plan only; enabled with ≥ 2 selected rows): Link chains the selected tasks FS in row order; Unlink removes links among them.
- **Delete** (enabled with selection; Ctrl+Delete).
- **Outdent / Indent** (ghost icon buttons, both modes; enabled with a selection; Alt+Shift+← / Alt+Shift+→): move the selected rows one Level up / down, a major task with its tasks (§8). **Outline** menu (icon, both modes): Group selected tasks (a new major task "New group" above them, its name ready to type), Ungroup (the selected major task goes and its tasks move up a Level), Collapse all, Expand all.
- **Zoom**: Day · Week · Month · Fit (segmented).
- **Search** (`/` focuses): filters by task name, assignee or ID (`12` or `#12`, exact).
- **Selection under search and filters**: Delete, Link, Unlink, Move up/down and Add task act only on selected rows that are shown; changing the search or filters drops hidden rows from the selection; Move jumps over hidden rows. A task just added, or jumped to from the Issues panel or the drawer's Successors, stays shown (and is scrolled into view) until the search or filters change. Assignee chips show the name as written.
- **Filter** popover: Status (checkboxes, any of; Late first), Assignee (multi-select). Active filters appear as removable chips under the toolbar. The KPI strip's "N late" sets or clears Status = Late. A status chip states its split when milestones match it too — "Late · 3 tasks, 1 milestone" (counted over the rows all filters match; just "Late" when no milestone does) — because the KPI strip counts tasks only (§7.5), so "3 late" and the 4 rows it shows agree.
- **Columns** popover: toggle optional columns per mode.
- **Density** (icon): compact / default / comfortable.
- Gantt header right corner: **Color by** (Status / Assignee), **Critical path** toggle (M5).
- **Narrow windows** (down to the 960 px minimum): the buttons never shrink; the search box narrows first (to 110 px); below 1100 px Delete, Filter and Columns show their icons only, and in Plan mode, which has Link and Unlink too, these five do below 1240 px (tooltip and accessible name unchanged; Filter keeps its count).

### 7.7 Grid
- Sticky header row (`--head-bg`: `--surface-2`, or `--plan-wash` in Plan mode; 12px semibold `--text-2`), with a `--border-strong` rule below it and right of the Task column (the "freeze" line). The header row is exactly as tall as the timeline header including its rule (44 px + 1 px), so the header rules, every row line and the selected-row band meet level at the splitter.
- Row height `--row-h`. Hover: `--surface-2`, on the grid row and its Gantt lane together. Selected: `--selected` + 2 px accent bar on the left; on a selected row the In progress pill and the New tag sit on white so they keep their shape. Cells that can be typed in show a hairline box on hover. Multi-select: Ctrl/Shift + click, or Shift+↑/↓ from the active cell.
- **Cells**
  - ID: 12px `--text-3`, right-aligned. IDs, durations, dates, progress and variance use tabular figures.
  - Task: single line, ellipsis, full name in tooltip; the column takes any spare grid width (at least 200 px). Late tasks show a small red dot before the name; a task added in Track mode this session shows the tag "New" after the name, never cut by the ellipsis.
  - Assigned: chips — Person = circular avatar with initials (first letters of the first two words; Thai skips the leading vowels เ แ โ ใ ไ): white on the resource colour darkened 20 %, or dark text on the plain colour when that colour is too light for 4.5:1; Team/Contractor = neutral rounded tag (white, `--border`) with an 8 px square swatch in the resource colour, then the short name. Show up to 2 chips that fit whole, then `+N`; only a lone first chip may end with "…"; the tooltip lists every name.
  - Progress: 4 px mini bar (status color on a `--surface-3` track) + `%`; the bars of all rows end at the same place.
  - Status: pill with soft background + strong text and a faint ring in its own colour (Completed / In progress / Late / Not started).
  - Forecast Finish: red when later than planned.
  - Variance: `+3d` red, `−1d` green, `—` muted.
  - Calculated cells: `--text-2`, not editable, tooltip "Calculated".
  - Plan mode Start on a task with predecessors: link icon + tooltip "Set by predecessors — add lag to delay".
- **Editing**: click selects a cell; Enter / F2 / double-click / typing starts editing (`/` and `?` are shortcuts, not typing: press Enter or F2 first to type them); on the ID or a calculated cell, Enter / F2 / double-click opens the drawer instead; Enter commits and moves down; Tab commits and moves right; Esc cancels. Leaving a cell by clicking another control commits the edit and leaves the focus on that control.
  - Text: inline input. Remarks keep their line breaks: Alt+Enter (as in Excel) or Shift+Enter adds one, and a remark with several lines opens over the rows below.
  - Numbers (Duration): inline input with validation — whole working days, 0–3650. A decimal is rounded (a note under the cell says so before it is saved); text, a negative number or more than 3650 shows a red message under the cell, and Enter/Tab keep the editor open. Leaving the cell with such a value keeps the old one (toast).
  - Dates: native `<input type="date">` styled to match, as wide as the date needs (it may cover the cell to its left). Only 1950–2199; a date outside that range or half typed shows a red message under the cell and is not saved; clearing every part clears the date.
  - Assigned: chip editor with autocomplete from Resources; Enter on unknown text creates a new name. Text is split on `,` and `;` (a pasted "ACME, ThermCo" gives two names) and takes a matching resource's spelling. Picking a suggestion adds it at once; text left in the box is added when the editor is left (Tab, a click elsewhere, Ctrl+S). Enter on an empty box or Tab saves.
  - Predecessors: text input with live validation (red underline + message for invalid tokens).
  - Progress (Track): popover with a number box (a digit typed on the cell starts it; ↑/↓ ±5), buttons 0 / 25 / 50 / 75 / 100 (a segmented control like Zoom; the drawer uses the same) and a slider (steps of 1). While it is open the cell keeps its mini bar and percent, following the value being typed (the saved value while the box is blank or invalid). Saving the value the task already has changes nothing.
  - Popovers and messages open under the cell, or just above it when they only fit there, and move with the cell while the grid scrolls. In a popover, Enter saves and moves down, Tab / Shift+Tab save and move right / left, Esc cancels, and a click outside saves a changed value. Starting an edit scrolls the cell into view. When the cell is scrolled out of view, Assigned saves its chips (text still in the box is dropped) and Progress cancels.
- **Keyboard outside editing**: arrows move the active cell; Tab / Shift+Tab move along the row and leave the grid after the last / before the first column; Esc (no drawer or panel open) clears the active cell; Delete / Backspace clear the active cell (§7.12). Focus stays on the grid, which points screen readers at the active cell (`aria-activedescendant`). Opening a file (Open, Reopen, drop, Try sample, Reload file) or creating a plan starts the grid afresh: no active cell and no open editor, and the grid and the Gantt scrolled to the first row (the grid also to its first column; the Gantt's horizontal position is §7.8's "on load").
- Read-only cells in the current mode show grey text (`--text-2`, like calculated cells) and a not-allowed cursor; trying to edit shows a toast "Switch to Plan mode to change the baseline."
- **Outline (§5.12):** while the plan has a major task, every Task cell is indented 16 px per Level below 1 behind a 16 px slot; a major task shows ▸ / ▾ in the slot (click collapses / expands it; Alt+Shift+− / Alt+Shift+= on the active row's major task), its name in semibold and the number of its leaf tasks after the name in `--text-3`, on a `--summary-band` row (and Gantt lane); the hover and selected bands still show over it. Its cells other than Task and Remarks are calculated (grey, tooltip "Calculated from its tasks"). A collapsed major task hides its rows in the grid and the Gantt; collapsing is the view's, not the file's (opening a file expands everything). With a search or filter on, a shown task brings its major tasks along (their roll-up still covers all their tasks), and a major task whose name matches the search shows all its tasks.
- **Move rows by dragging:** press and hold a row for 0.4 s, or drag the grip that appears left of the ID on hover, then drag up or down. A 2 px `--accent` line shows where the row will go, indented to the Level it will get; moving the pointer left or right chooses among the Levels the place allows (from the row below's Level to the row above's, or one deeper when the row above is an expanded major task). A major task moves with its tasks and can't be dropped inside itself. Near the top or bottom of the grid it scrolls. Esc cancels; the drop is one undo step. Not while a search or filter is on (toast "Clear the search and filters to move rows by dragging").
- **No tasks** (blank template, every task deleted, no `Tasks` sheet): the grid pane shows "No tasks yet" with **Add task** and "or press Ctrl+Enter. You can also fill the Tasks sheet in Excel and open the file again." in Plan mode, or **Switch to Plan mode** in Track mode. When the reader reported `W_NO_TASKS_SHEET`, its message comes first with an "Open another file" link. With tasks hidden by search or filters the grid says "No task matches the search or filters." instead.

### 7.8 Gantt (custom SVG)
- **Scale:** Day = 32 px/day · Week = 12 px/day · Month = 4 px/day · Fit = choose the largest scale that fits the visible width (min Month, max Day). Range = earliest date − 3 working days → latest date + 5 working days, with SD counted as one of the dates. Default zoom: Fit.
- **Timeline header (2 tiers, `--head-bg` band — `--plan-wash` in Plan mode — with a `--border-strong` rule below; the Color by / Critical corner shares the band):** top = `Nov 2026` (12px semibold `--text`, one step stronger than the 11px `--text-2` day labels), the name staying at the left edge while any of its month is in view; bottom = day numbers (Day), `W46 · 10 Nov` (Week), week ticks (Month). When single days are shown (Day zoom, Fit at 20 px/day or more, the report's Gantt appendix), the header and the chart body draw a line at every day boundary, Monday lines in `--border-strong`.
- **Non-working days (holidays):** `--nonwork` columns at every zoom whenever a day is at least 4 px wide (Day, Week, Month, Fit, and the report's Gantt appendix), with the holiday description as a tooltip in the timeline header. In the header a holiday fills its day cell when the bottom tier shows day numbers; with week labels or Monday ticks it is a 4 px strip at the foot of the tier (the whole cell still shows the tooltip), so no week label runs across a grey box. The columns are drawn over the row bands with multiply blending, so a selected or hovered row stays one continuous band.
- **Status date line** (Track): 2 px `--accent`, dashed, with a 4 px white outline in step with the dashes so it stays visible where it crosses a solid bar; label chip at the top "Status · 13 Nov". **Today line**: 1 px `--text-3` dashed, label "Today"; in Track mode shown only when today ≠ SD (Plan mode has no status-date line, so it always shows today). Both chips sit in the top tier of the timeline, kept inside the chart and clear of the Color by / Critical corner at its right end, with their line running down through the bottom tier; a Today chip that cannot sit on its line (beside the Status chip, or clear of the corner) names its date: "Today · 31 Oct". The today line is drawn only when it falls inside the chart. The lines cross the bars but pass under the bar labels and the timeline's day and week labels, whose halo (5 px on bar labels, 6 px in the timeline) stops a dashed line around the whole label.
- **Plan mode bars:** 16 px tall, radius 4, fill `--accent` (or the assignee color when Color by = Assignee); hovering a bar darkens it to `--accent-hover` (an assignee color stays as is). Label to the right of the bar = assignee names (12px `--text-2`), with a halo in its lane's colour (white, the hover grey or the selected blue).
- **Track mode bars:**
  - Baseline: 4 px bar in `--baseline` at the bottom of the row lane (planned PS→PF).
  - Main bar: forecast/actual window (FS′→FF′), 14 px, radius 4. Done part = solid status color; remaining part = status soft color with a 1 px status-color border. On the selected row the remaining part of In progress and Not started bars is white (border unchanged), so it doesn't merge with the blue lane. Status colors: Completed `--done`, In progress `--progress`, Late `--late`, Not started `--idle`.
  - Label right of the bar: `60%`; Late adds ` · +3d` in red.
- **Major-task bars:** 8 px bar across its tasks (PS→PF in Plan mode, FS′→FF′ in Track mode) with 4 px downward end caps, in `--summary`; in Track mode the done part is solid `--summary` and the rest `--summary-soft` with a 1 px `--summary` border, over the 4 px baseline. Label in Track mode: `62%` (Late adds ` · +3d` in red); none in Plan mode. Not draggable; no critical outline.
- **Weekends:** Saturday and Sunday are working days (§2) but are marked so the week reads at a glance: in the timeline's day numbers their cell is `--weekend` with the number in `--weekend-text` (a holiday's grey wins), and whenever a day is at least 12 px wide (Day, Week, Fit at 12 px/day or more, the report's Gantt appendix) the chart body tints their columns `--weekend-col` (multiply, like holidays), under the holiday columns and the grid lines.
- **Milestones:** 12 px diamond (`--text` in Plan, status color in Track; a Not started milestone is hollow: white with a 1.5 px `--idle` outline, also in the report's Gantt appendix) with the date as label.
- **Dependency arrows:** 1.25 px `--arrow`, rounded elbows, 4 px arrowheads. FS: from bar end → right 8 px → vertical → into successor start. SS: from bar start → left 8 px → vertical → into successor start. Plan mode draws every arrow; on hover/select of a task, its arrows turn `--accent` and other arrows dim to 40%. Track mode draws only the hovered or selected task's arrows (to its predecessors and successors), in `--accent`, between the forecast/actual bars. Bar labels start past the 8 px run, so an arrow never crosses their first letter.
- **Critical path** (M5, toggle): critical bars get a 2 px `--late` outline 2 px clear of the bar (a milestone's ring diamond is 4.5 px larger on each axis), and their arrows turn red.
- **Interactions:** hover → tooltip card (name, assignees, planned dates, forecast/actual dates, progress, variance), hidden by Esc until the pointer leaves the bar; click → select row (synced with grid); double-click → open drawer. On load and on a mode switch, scroll horizontally to SD (Track) or project start (Plan). Changing zoom keeps the date at the centre of the chart in view; when the previous zoom had nothing to scroll (e.g. Fit), it scrolls to SD / project start. Jumping to a task (Issues panel, successor links) scrolls to its bar as the mode draws it: the planned bar in Plan mode, the forecast/actual bar in Track.
- **Drag (M5, Plan mode only):** drag a root task's bar to move Planned Start; drag the right edge of any bar to change Planned Duration. Snap to working days. Show a ghost bar and date tooltip while dragging; near the left or right edge of the Gantt pane the chart scrolls by itself.

### 7.9 Task drawer
```
+------------------------------------------+
| #12  [New]                  [↑] [↓] [x]  |
| Pump overhaul                            |  <- editable title
| (In progress)  (Late +3d)                |
|------------------------------------------|
| ASSIGNED                                 |
| (Somchai x) [Team A x]  [+ Add]          |
| PREDECESSORS                             |
| #10 Pipe spool fabrication   FS  +0  [x] |
| [+ Add predecessor]                      |
| PLANNED                       (lock icon)|
| Start [03 Nov 26]  Duration [5]d         |
| Finish [07 Nov 26]                       |
| PROGRESS                                 |
| [0][25][50][75][100]  ----o----  60%     |
| ACTUAL                                   |
| Start [04 Nov 26]   Finish [          ]  |
| FORECAST                                 |
| 4 Nov 26 -> 14 Nov 26 · +3d   (read-only)|
| SUCCESSORS                               |
| #14 Commissioning (FS)   <- click to jump|
| REMARKS                                  |
| [                                      ] |
|------------------------------------------|
| [Delete task]                    [Done]  |
+------------------------------------------+
```
- Width `--drawer-w`, `--shadow-3`, slides from the right over the Gantt area. The title reads as a heading (no box) until hovered or focused.
- While open, the drawer follows a plain selection (grid click, ↑/↓ in the grid, Gantt click); Ctrl/Shift multi-select leaves it on its task. **↑ / ↓** in its header step to the previous / next shown row (in row order, so stepping still works when the task has just dropped out of a filter such as Status = Late).
- Header chips: the work state (Not started / In progress / Completed); a Late task adds a red "Late +Nd" instead of a second "Late"; a finished task with a variance adds a neutral "Finished Nd late / early".
- Forecast (read-only): Forecast Start → Forecast Finish, then ` · +Nd` (red, late) or ` · −Nd` (green, early) when the variance is not 0. On time, the line ends at the finish date (no "—").
- Sections follow the mode: Plan mode shows Planned first and collapses Actual/Forecast; Track mode shows Progress/Actual first and shows Planned read-only (lock icon).
- Values that can't be changed here (locked by the mode, or a Start set by predecessors) sit in a filled box the size of an input, with the reason as tooltip; a linked Start shows the link icon. An empty date input shows its placeholder dimmed.
- **Add predecessor**: searchable task picker (ID + name; "12" and "#12" both find #12, an exact ID is listed first), then type (FS/SS) and lag (whole working days, at most ±3650). Tasks that would create a cycle are disabled in the picker. Nothing is highlighted until a query is typed (Enter right after opening links nothing); ↑/↓ move the highlight and Enter picks it (an exact ID that can't be linked picks nothing); Esc or a click outside closes the picker.
- The type select stays short (FS / SS); its tooltip names the predecessor ("FS: starts after #10 finishes · SS: can start once #10 starts"). Lag shows a `d` unit (read-only: `FS +2d`). Under an editable list with at least one link, one muted line reads "FS = start after it finishes · SS = start when it starts · lag in working days (− = overlap)".
- Changes apply immediately (each change is one undo step): a field saves on Enter or when it is left, and Esc puts the value back. An entry the plan refuses (blank name, blank Duration or Planned Finish, Duration above 3650, a date outside 1950–2199, a half-typed date) is not saved: a toast says why and the field shows the plan's value again. The progress slider saves a mouse drag on release; keyboard steps (arrows, PageUp/PageDown, Home/End) save on Enter or when the slider is left ("Enter saves · Esc cancels" shows meanwhile), so one change is one edit. "Done" closes the drawer.

### 7.10 Empty state & onboarding
Centered card on `--bg` (a faint accent wash at the top of the page), inside a dashed drop zone:
- Lockup: app mark + "Gantt Planner".
- Title: "Plan and track your project on a Gantt chart"; subtitle: "Your data stays in your Excel file. Works offline."
- A small decorative Track-mode Gantt picture beside the title (hidden in a window 860 px wide or 600 px tall or less).
- Three tiles, each with an icon, its label and a one-line description: **Open Excel plan** (primary) "Continue a plan saved in an .xlsx file" · **New plan** "Start a blank plan from the template" · **Try with sample data** "Explore a furnace turnaround". They stack in a window 720 px wide or less.
- "Reopen control-room.xlsx" as a full-width row under the tiles when a recent file exists.
- Under the card, inside the drop zone: "or drop an .xlsx file here" · "Download blank template".
- **New plan** dialog: Project name, Project start (default next Monday), Owner → creates an in-memory workbook from the template with one empty task in Plan mode; the first Save asks where to save (Save as).
- **Try with sample data** loads the embedded sample (§13) in memory; Save → Save as.

### 7.11 Feedback
- **Load report** (after Open, if any change/issue): a toast "Filled 23 values · corrected 2 · 3 warnings" with **Review**. Review opens the Issues panel. When the tasks weren't found (`W_NO_TASKS_SHEET`, `E_NO_TASK_HEADER`), the toast shows that message instead of the counts, and Review opens Problems.
- **Opening a file** over an open plan: a scrim with a card reading "Opening {file}…" covers the app from the moment the file is chosen until it is shown; it takes no clicks or keys (the plan under it is about to be replaced): the app's shortcuts don't run, and neither do the browser's Ctrl/⌘ ones (Save page as, Open file, Print).
- **Issues panel** (right sheet, same width as drawer): tabs **Problems** (errors, then warnings, under "Errors · n" / "Warnings · n" headings; each row shows a severity icon, the catalog message and the task's "#id · name" under it, with its Quick fix button; click jumps to the task; information items sit last in a closed "Notes" group; the tab count equals the header badge) and **Changes** (grouped by field: "Planned Finish ×12, Successors ×9, …", expandable rows `#7 Planned Start: 3 Nov → 5 Nov · Driven by predecessors`). ←/→ move between the tabs. A quick fix shows a toast with Undo. Tabs are underlined; counts are small pills; each problem is a card with a severity-coloured left rule.
- **Toasts**: bottom-center, auto-hide 4 s (paused while the pointer or focus is on the toast; Esc on it dismisses it), with Undo where relevant ("Task deleted · Undo"). Screen readers announce every toast through a polite live region that is always on the page.
- **Dialogs**: only for destructive or file-level actions (delete with dependents, conflicts, locked file, mode switch confirm, renumber).
- **Unsaved guard**: `beforeunload` prompt when dirty.

### 7.12 Keyboard shortcuts
| Keys | Action |
|---|---|
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as… |
| Ctrl+O | Open |
| Ctrl+P | Print Gantt (§9.4); in the report and in Print Gantt, the browser's Print |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / Redo |
| Ctrl+Enter | Add task below selection |
| Delete / Backspace | Clear the active cell (a calculated or required cell shows a toast instead). Delete on the ID cell, with several rows selected, with no active cell (after Esc), or when the grid doesn't have the focus (e.g. after clicking a Gantt bar): delete selected tasks (confirm when other tasks depend on them) |
| Ctrl+Delete | Delete selected tasks (confirm when other tasks depend on them) |
| Alt+↑ / Alt+↓ | Move selected task up / down among the tasks of its major task (a major task with its tasks) |
| Alt+Shift+→ / Alt+Shift+← | Indent / Outdent the selected rows (§8) |
| Alt+Shift+− / Alt+Shift+= | Collapse / expand the active row's major task |
| Shift+↑ / Shift+↓ | Extend the row selection |
| Enter / F2 | Edit cell; on the ID or a calculated cell, open the drawer |
| Shift+F2 | Open the selected task in the drawer |
| Tab / Shift+Tab | Next / previous cell; leaves the grid at the row ends |
| Ctrl+L | Link selected (Plan) |
| / | Focus search |
| Esc | Close the drawer, Issues panel, popover or menu; cancel edit; clear the active cell; in the report or Print Gantt, back to the main view |
| ? | Show shortcuts |

Ctrl+letter shortcuts match the physical key when the keyboard layout is not Latin (Thai: Ctrl+ห is Ctrl+S); `/` and `?` match the character typed. Ctrl+S, Ctrl+Shift+S, Ctrl+O and Ctrl+P first finish the edit in progress (popover editors included); while a form or confirmation dialog is open they do nothing (Ctrl+P: while any dialog is open). The other shortcuts don't run while any dialog is open or a field has the focus; in the report and Print Gantt views only Esc, the file shortcuts and the browser's Ctrl+P work.

The overlay (`?`) lists this table plus the mouse gestures. Keys that work only inside an editor are in §7.7 and not in the overlay: Alt+Enter / Shift+Enter (new line in a Remark) and the popover keys.

### 7.13 Persisted UI preferences (localStorage, try/catch)
One key, `gantt-planner:prefs`: zoom, grid width per mode (or "fit the columns"), density, visible columns per mode, color-by, critical path on/off, KPI strip collapsed, the report options — sections on/off (Gantt appendix included) and the look-ahead window (days; a saved weeks value falls back to 7) — and the Print Gantt paper (A4 / A3). "Prepared by" is not stored (§9.1, §9.4). Where storage is unavailable the defaults are used. **Never** store project data in localStorage.

---

## 8. Editing behaviour (business rules in the UI)

| Action | Rule |
|---|---|
| Add task | New ID = max ever used + 1 (never reuse in session). Plan mode defaults: name "New task", duration 1, no predecessors, Planned Start = selected task's Planned Start or Project Start. Track mode: same, but Planned Start is never before the first working day after the status date (R, §5.6), so new work isn't Late at once; tagged "New" (planned fields editable this session) |
| Delete task | Remove; strip its links from other tasks. If it has successors, confirm, titled "Delete task?" for one task or "Delete N tasks?" for several: "3 tasks depend on this task. Their links will be removed." Toast with Undo |
| Move up/down | Changes row order only (IDs unchanged). With major tasks: a row (a major task with its tasks) moves past the neighbouring row of the same major task; at the first or last one it stays (toast "Drag the row to move it to another group") |
| Drag a row | Grid only (§7.7): one undo step; the row (a major task with its tasks) goes where the line shows, at the Level it shows, its tasks keeping their depth below it |
| Indent | Each selected row (a major task with its tasks) goes one Level deeper, at most one deeper than the row above it, so the first row can't be indented. When the row above was a task it becomes a major task: its own dates, progress and links stop counting (they stay in the task, so Outdent brings them back) and a toast says so |
| Outdent | Each selected row below Level 1 (a major task with its tasks) goes one Level up. As in MS Project the rows below it that were its siblings become its tasks |
| Group | Outline menu: a new major task "New group" (no links) is inserted above the first selected row at the selection's shallowest Level; the selected rows (each with its tasks) move under it in their order, one Level deeper. Its name opens for typing |
| Ungroup | Outline menu, on a selected major task: the row goes and its tasks move up one Level |
| Delete a major task | Deletes it with all its tasks; always confirms: "Delete Arch Panel and its 5 tasks?" |
| Add task with major tasks | Below the selected row at its Level; on an expanded major task, as its first task; on a collapsed one, after its tasks at its Level |
| Renumber IDs | Plan mode, More menu. Renumber 1..n in row order and rewrite all predecessor references, FF/SF ones included (their ID only; the rest stays as typed). Confirm first. Refused (toast "Fix the predecessors of tasks 30, 40 first — Renumber would change what they point to" · **Review**) while a predecessor names an ID no task has, or unreadable predecessor text holds a number. The drawer, selection, Changes and Problems rows follow their tasks, also through undo and redo |
| Link / Unlink | See §7.6. Link rejects any link that would create a cycle (toast) |
| Edit Planned Duration (Plan) | 0–3650 working days (`MAX_DAYS`); a larger value is refused with the toast "Duration must be 0–3650 days" |
| Edit Planned Finish (Plan) | Sets Planned Duration = `countWorkdays(PS, new PF)` (at least 1; at most 3650, as above). A finish before Planned Start is refused (nothing changes) with the toast "Finish can't be before the start (2 Nov) — set Duration to 0 for a milestone" |
| Edit Planned Start on linked task | Disabled (hint: add lag) |
| Change Project Start (Plan) | In Project settings, when the new date differs and root tasks (no links) start on the old project start, a checked option "Also move N tasks that start on 28 Sep 26 to 5 Oct 26 (linked tasks follow)" ("the task that starts" when there is one) appears under the date. Apply does both as one undo step; Cancel and Esc drop every edit |
| Progress set > 0 with no Actual Start (Track) | Set Actual Start = SD; toast "Actual start set to 13 Nov — change if needed" |
| Progress set to 100 with no Actual Finish | Set Actual Finish = SD (and Actual Start = SD if blank) |
| Progress set on a milestone (Track) | A milestone is reached or not: any value above 0 means 100 — Actual Finish = its Actual Start, or SD when blank (and Actual Start = SD if blank). 0 clears Actual Start and Actual Finish (toast "Milestone not reached — actual dates cleared"): an Actual Start alone would mark it reached (§5.5) |
| Actual Finish entered | Progress = 100; a blank Actual Start = Actual Finish (toast "Actual start set to 30 Sep — change if needed"); a one-day task (start = finish) whose finish moves earlier moves its start too |
| Actual Finish cleared | Progress becomes 99 if it was 100 (toast explains). On a milestone: Actual Start is cleared too and Progress becomes 0 (toast "Milestone not reached — actual dates cleared") |
| Status date changed | Recompute everything; nothing is written to tasks. A date outside 1950–2199 is ignored |
| Date typed outside 1950–2199 | Planned Start, Planned Finish, Actual Start, Actual Finish, Project Start (Project settings) and New plan's Project Start: refused with the toast "Enter a date between 1950 and 2199"; the dialog stays open (§4.7 reads the same range) |
| Undo/redo | Snapshot of `{project, tasks, resources}` per action; cap 100; saving does not clear history. An edit that leaves the plan as it was (a value re-entered, Unlink with no links between the selected tasks — toast "No links between the selected tasks") is no step: no "Unsaved changes", redo kept. The Changes list follows undo and redo |

---

## 9. Report

### 9.1 Access & options
- **Report** button → full-screen report view (in-app route `#report`) with a toolbar: **← Back** · **Print / Save as PDF** · **Options**. Back returns to the main view as it was (scroll positions, active cell; the grid has the focus). Opening or creating a plan from the report (Ctrl+O, drop) shows it in the main view, and Review in a toast leaves the report for the Issues panel.
- Options: sections on/off, Look-ahead window (3 / 7 / 14 days, default 7), Include Gantt appendix (default on), Prepared by (default Owner).
- Report data = current in-memory state (unsaved changes included); the header says "Status date 13 Nov 2026".

### 9.2 Print layout
- A4 landscape, `@page { size: A4 landscape; margin: 10mm; }`.
- Each page: header band (project name left; status date and "Prepared by" right); footer "Gantt Planner · {file name} · Page {n}". Screen-only chrome (report toolbar, toasts, the drop overlay) never prints.
- Tables: repeat header rows, `break-inside: avoid` on rows.
- Charts: Chart.js with animation off, `devicePixelRatio: 2`, fixed size; convert to `<img>` (`toDataURL`) before printing.
- Report palette: Planned `#707F95` (= `--baseline`) 2 px; Actual `#2563EB` 2.5 px; Forecast `#2563EB` dashed; status date vertical line in `--accent` (small custom Chart.js plugin, no extra dependency). Actual and Forecast are drawn over Planned; the legend reads Planned · Actual · Forecast.
- The status donut uses Completed `#15803D` (= `--done`), In progress `#2563EB`, Not started `#CBD5E1`, with 2 px white gaps between slices. The Planned % bars on page 2 use the Planned colour.
- On screen each sheet has a hairline ring and a soft card shadow (`0 0 0 1px --border, --shadow-1`, radius `--radius-sm`); the KPI box is `--radius-lg`. In print, table rules and the KPI box border use `--border-strong` (light greys drop out on office printers); sheets have no shadow and no radius.
- The Gantt appendix draws the status-date line with the same white halo as the app (§7.8), and its label header uses the timeline's band (`--head-bg`, always the neutral grey in the report) and `--border-strong` rule.

### 9.3 Content
**Page 1 — Summary**
- KPI row (same 5 cards as Track mode, print-styled). The report's cards are narrower than the app's, so every state label and chip (Schedule state, Finish `+3d`, Tasks "2 late") sits under its value, never beside it; the mini bars stay on one line at the bottom of the cards.
- **S-curve** (left, ~2/3 width): Planned, Actual, Forecast, status date marker; y 0–100%. The lines start at 0 % on the day before the first S-curve point (§5.9 data unchanged). A status date before the first or after the last point is shown as an arrowed label at that edge ("← Status · 15 Sep" / "Status · 30 Oct →") instead of the line. A series with no values (e.g. Forecast once every task is done) is left out of the chart and its legend.
- Right column: **Status donut** (Completed / In progress / Not started, Late count in the center) and **Key messages** (auto-generated, max 5):
  1. "Overall progress is 42% against a plan of 47% (−5.0 pts, Behind)."
  2. "Forecast finish is 12 Dec 2026, 3 working days after the planned finish." / "…on the planned finish date." When every task is Completed: "Finished on 7 Oct 2026, 3 working days after the planned finish." / "Finished on 7 Oct 2026, on the planned finish date."
  3. "2 tasks are late; the largest delay is #12 Pump overhaul (+3d)." / "No tasks are late."
  4. "Last 7 days: +6% actual vs +8% planned."
  5. "Next 7 days: 5 tasks start and 4 tasks finish." (the look-ahead window). Left out when every task is Completed.

**Page 2 — Progress by assignee**
- Table: Assignee · Type · Tasks · Completed · In progress · Late · Planned % · Actual % · Variance (pts), sorted by variance ascending (worst first). Variance (pts) text takes its schedule-state colour (§5.8): Ahead green, On track uncoloured, Slightly behind amber, Behind red.
- Horizontal grouped bar chart: Planned % vs Actual % per assignee, as images of at most 20 assignees each ("Planned vs actual (cont.)" for the next ones), so none is taller than a printed page. Names longer than 22 characters end with "…" (Thai vowel and tone marks don't count); the table has them in full.
- **Workload heatmap**: rows = assignees (names wrap to at most two lines); cell = number of not-completed tasks (milestones excluded) whose forecast window overlaps the column. When the forecast finish is at most 42 days after Project Start: one column per day for SD+1 … min(SD+14, forecast finish); holidays are hatched, left blank and not counted (a note under the heatmap says so). Otherwise: one column per week from the week of SD to the week of the forecast finish, at most 8. Shades 0 / 1 / 2 / 3+ of `--accent` (3+ = full `--accent` with white numbers); numbers shown, except 0, which is an empty shaded cell. When no task is open, or that range is empty (forecast finish on or before SD; for weekly columns, before the week of SD), the heatmap shows "No open tasks after the status date." instead.

**Page 3 — Needs attention**
- **Late tasks**: ID · Task · Assigned · Planned Finish · Forecast Finish · Variance · Progress · Remarks; sorted by variance descending. Critical flag icon from M5. Late milestones are listed too, marked with a diamond, with "—" for Progress; a line above the table reconciles the count with page 1: "3 tasks and 1 milestone are late." (the task number is the KPI late count).
- **Milestones**: Milestone · Planned date · Forecast/Actual date · Variance · Status.
- **Look-ahead (next N days)**: tasks in progress, plus tasks whose FS′ or FF′ falls in `(SD, SD + N days]`: ID · Task · Assigned · Forecast Start · Forecast Finish · Progress · Status. Milestones are marked with a diamond.
- Dates in these tables use `d MMM yyyy` (§7.2); status and date cells don't wrap.

**Page 4+ — Gantt appendix (optional)**
- Track-mode Gantt rendered to fit the page width (auto Week/Month scale; at least 100 px is kept after the last bar for its label, so long plans shrink the scale slightly), 26 px rows (25 per A4 page), timeline header and a one-line legend (bar filled to % done, planned baseline, status colours, milestone, non-working day when shown, "+3d" = working days late) repeated per page.

Major tasks (§5.12) are not listed in the tables (late tasks, milestones, look-ahead) and not counted anywhere; the Gantt appendix shows them as rows with their bars and names in bold, all expanded.

Empty states: if there is no progress yet, the S-curve shows Planned only with "No progress reported yet". A plan with no non-milestone tasks shows the KPI row as in §7.5 ("—", "No tasks yet") and a single key message "No tasks yet." A plan with no tasks at all shows one note, "No tasks to report yet. Add tasks in Plan mode, then open the report again.", instead of the pages; with every section off the view says "Turn on at least one section in Options." The Print button is disabled in both cases; printing from the browser (Ctrl+P) prints the note, never a blank sheet.

### 9.4 Print Gantt
To send the plan out (before work starts, or as it stands): the grid and the Gantt printed **as the main view shows them**.
- **Access:** **Print Gantt** in the header, or Ctrl+P in the main view → full-screen print view (in-app route `#print`) with a toolbar: **← Back** · title · notes · **Options** (Paper: A4 or A3 landscape, remembered; Prepared by, default Owner, not stored) · **Print / Save as PDF**. Back or Esc returns to the main view as it was, like the report (§9.1). Chrome and Edge name the PDF after the tab title: "{project} - Gantt plan {today}" in Plan mode, "{project} - Gantt {status date}" in Track mode.
- **What is printed:** the current mode — Plan: planned bars, milestones and every arrow; Track: baseline, forecast/actual bars filled to % done, the status-date line, no arrows (the screen shows only the selected task's) — with Color by (status or assignee) and the critical path (rings; red arrows between critical tasks) as set; the rows shown (search, filters and collapsed major tasks as in the main view; a collapsed major task is one row with its task count); and the grid's visible columns for the mode, in their order. Selection, hover and the today line are not printed.
- **Page:** the chosen paper, landscape, 10 mm margins, with the report's printed header and footer (§9.2): project name left; right "Plan 3 Nov – 20 Dec 2026" (Plan mode) or "Status date 13 Nov 2026" (Track mode), then "Prepared by …" and "Filtered" while a search or filter is on; footer "Gantt Planner · {file name} · Page {n}". Each page has the table and, beside it, the chart, with the column headers and the timeline header repeated, then the legend. Rows are 26 px: 25 per A4 page and 37 per A3 page with a one-line legend.
- **Table:** plain text at 11 px, one line per cell (ellipsis): ID; Task indented 12 px per Level below 1, a major task in semibold on the `--summary-band` row with its task count in `--text-3`; then the columns, as the grid shows their values — dates `dd MMM yy`, Forecast Finish and positive Variance in red, Status in its status colour, Critical "Yes" in red; Assigned names start with a swatch of the bar colour when colouring by assignee. Widths (the widest value or header word at 11 px plus 4 px a side): ID 32, Task 180 (A3: 260), Assigned 96, Remarks 160, Predecessors 78, Successors and Status 66, dates 60, Duration, Progress, Variance and Actual Duration 54, Critical 46 px. The table leaves the chart at least 380 px (Track mode's default columns fit beside it on A4): columns that don't fit are left out from the right, and the toolbar says which ("Not enough room for Remarks — hide columns or choose A3").
- **Chart:** the §7.8 marks, timeline, weekends, holidays and grid lines, fitted to the chart's width whatever the zoom (as the report's appendix, with 140 px kept right of the last bar for its label in Plan mode, 100 px in Track mode). The range is §7.8's over the printed rows; in Plan mode over their planned dates only, the status date left out. An arrow between rows on different pages runs to the page edge.
- **Legend** (under the chart on every page, wrapping onto more lines when needed; the rows per page allow for its height): Plan mode — the task bar (or, colouring by assignee, a swatch per assignee of the printed rows' bars and "Unassigned"), major task, milestone, critical path (when on), dependency (when the printed rows have links), non-working day (when drawn). Track mode — the report appendix's items (§9.3), the assignee swatches replacing the status colours when colouring by assignee, plus major task and critical path when shown.
- **Empty:** with no task the view says "No tasks to print yet. Add tasks in Plan mode, then print again."; with none shown "Nothing to print: no task matches the search or filters." The Print button is disabled then; the browser's Print prints the note.

---

## 10. Non-functional requirements
- **Performance:** full recompute < 10 ms for 200 tasks; scrolling smooth at 60 fps.
- **Size:** `dist/gantt-planner.html` < 3 MB.
- **Offline:** zero network requests at runtime.
- **Browsers:** latest Edge and Chrome (Windows). Others: fallback mode only (§3.5).
- **Data safety:** write only on explicit Save; conflict detection; locked-file handling; never lose unparseable user text; never touch unknown columns or sheets.
- **Robustness:** any malformed cell becomes an issue, never a crash. A top-level error boundary shows "Something went wrong" with **Download my data as .xlsx** (writes the in-memory state to a new file).
- **Accessibility:** all actions reachable by keyboard; visible focus; WCAG AA contrast; `aria-label` on icon-only buttons.
- **Privacy:** no telemetry, no external calls.

---

## 11. Project structure
```
gantt-planner/
  CLAUDE.md
  docs/SPEC.md
  PROGRESS.md                 milestone checklist (Claude Code keeps it updated)
  index.html
  vite.config.ts              vite-plugin-singlefile, assetsInlineLimit high, cssCodeSplit false
  src/
    main.tsx  App.tsx  config.ts
    engine/                   pure TS, no DOM
      dates.ts  calendar.ts  links.ts  schedule.ts  actuals.ts  forecast.ts
      status.ts  progress.ts  scurve.ts  critical.ts  issues.ts  compute.ts  types.ts
    excel/
      exceljs.ts  schema.ts  read.ts  write.ts  template.ts  readme.ts
    io/
      fileAccess.ts  recent.ts  download.ts
    store/
      store.ts  undo.ts  selectors.ts
    ui/
      header/  kpi/  toolbar/  grid/  gantt/  drawer/  issues/  report/  print/  empty/  common/
    styles/
      tokens.css  base.css
    sample/
      sampleData.ts           shared by the app ("Try sample") and scripts/make-sample.ts
  scripts/
    make-sample.ts            writes samples/sample-project.xlsx and tests/fixtures/*.xlsx
  samples/
  tests/
    engine/*.test.ts
    excel/*.test.ts
    fixtures/
```

### 11.1 Core types (`engine/types.ts`)
```ts
export type ISODate = string;                 // 'YYYY-MM-DD'
export type LinkType = 'FS' | 'SS';
export interface Link { predId: number; type: LinkType; lag: number }

export interface Task {
  id: number;
  name: string;
  assigned: string[];
  predecessorsText: string;                    // as typed; single source of truth, parsed by compute() every time
  plannedStart?: ISODate;
  plannedDuration?: number;
  plannedFinish?: ISODate;
  progress: number;                            // 0–100
  actualStart?: ISODate;
  actualFinish?: ISODate;
  remarks: string;
  isNewThisSession?: boolean;
  extra: Record<string, unknown>;              // unknown Excel columns (opaque to the engine)
  source?: unknown;                            // the Excel row it was read from (opaque outside the Excel layer; the writer keeps its formatting)
  unparsed?: readonly ('plannedStart' | 'plannedDuration' | 'level')[];  // cells the reader couldn't parse; Save keeps their text until the user sets the field
  level?: number;                              // outline depth 1–8 (§5.12); undefined = blank (a file without the column: Level 1)
}

export interface Project {
  name: string; owner: string;
  projectStart: ISODate; statusDate: ISODate;
  mode: 'Plan' | 'Track';
}

export interface Resource { name: string; type?: 'Person' | 'Team' | 'Contractor'; color?: string }
export interface Holiday { date: ISODate; description: string }
export interface Plan { project: Project; tasks: Task[]; resources: Resource[]; holidays: Holiday[] }  // what a workbook holds; computePlan(plan) = compute() with a calendar from Holidays

export type Status = 'Not Started' | 'In Progress' | 'Late' | 'Completed';

export interface TaskResult {
  id: number;
  plannedStart: ISODate; plannedDuration: number; plannedFinish: ISODate;
  progress: number;                            // value to write back (rounded, clamped, 100 when AF is set)
  level: number;                               // normalized outline depth (§4.7, §5.12)
  summary?: { tasks: number; actualFinish?: ISODate };  // set on a major task: its leaf-task count and rolled-up Actual Finish
  actualStart?: ISODate;                       // value to write back (milestone fill); never a "for calculation" substitute
  actualDuration?: number;
  forecastStart: ISODate; forecastFinish: ISODate;
  variance: number; status: Status;
  predecessorsText: string;                    // canonical, or the original text if any token has an issue
  links: Link[];                               // links used for calculation (valid, not in a cycle)
  successorsText: string;
  plannedPctAtSD: number;
  totalFloat?: number; critical?: boolean;
}

export type QuickFix =
  | { kind: 'setActualStart'; taskId: number; value: ISODate }
  | { kind: 'setActualFinish'; taskId: number; value: ISODate; actualStart?: ISODate } // also fills a blank (or out-of-range) Actual Start
  | { kind: 'removeLink'; taskId: number; predId: number };

export type IssueCode = 'E_DUP_ID' | 'E_CYCLE' | /* … every code in §5.11 … */ 'W_NEW_RESOURCE';
export interface Issue { code: IssueCode; severity: 'error' | 'warning' | 'info'; taskId?: number; message: string; fix?: QuickFix; field?: string } // field: the Tasks field the reader couldn't parse (W_BAD_DATE, W_BAD_NUMBER)
export interface Change { taskId?: number; field: string; from: unknown; to: unknown; kind: 'filled' | 'corrected'; reason: string }

export type ScheduleState = 'Ahead' | 'On track' | 'Slightly behind' | 'Behind';

export interface ProjectSummary {                // §5.8
  plannedStart: ISODate; plannedFinish: ISODate; forecastFinish: ISODate;
  finishVariance: number;                         // working days, + = late
  durationDays: number; elapsedDays: number;      // working days
  actualPct: number; plannedPct: number; variancePts: number; spi: number | null;
  state: ScheduleState;
  weekActualDelta: number; weekPlannedDelta: number;
  counts: { completed: number; inProgress: number; notStarted: number; late: number; total: number }; // milestones excluded
  milestones: { done: number; total: number };
}

export interface AssigneeSummary {
  name: string; type?: Resource['type'];
  tasks: number; completed: number; inProgress: number; late: number;
  plannedPct: number; actualPct: number; variancePts: number;
}

export interface SCurvePoint { date: ISODate; planned: number; actual: number | null; forecast: number | null }

export interface ComputeResult {
  tasks: TaskResult[];
  summary: ProjectSummary;      // §5.8
  byAssignee: AssigneeSummary[];
  sCurve: SCurvePoint[];        // { date, planned, actual|null, forecast|null }
  issues: Issue[];
  changes: Change[];
}
```

---

## 12. Testing
- **Vitest** for the engine and Excel layer. Engine coverage ≥ 90 %.
- **Engine cases (minimum):**
  - Calendar: weekends are working days, holidays (also on weekends), `addWorkdays` positive/negative/zero from a holiday, `countWorkdays` across holidays, `workdayDiff` signs.
  - Links: every notation example in §5.2, canonical output, each error type.
  - Schedule: FS, SS, lag, lead, multiple predecessors (max wins), milestone gaps (into a milestone, after a milestone that follows a task, after a start milestone and a chain of them), blank duration derived from finish, duration wins over finish, root task snapping, Track-mode freeze vs Plan-mode recompute.
  - Cycles: detection and graceful continuation.
  - Actuals: every row of §5.5.
  - Forecast: completed, in progress (remaining rounding), not started pushed by SD, pushed by late predecessor (FS and SS).
  - Status/variance: early, on time, late, completed late.
  - Progress: milestones excluded, all-milestones project, by-assignee with shared tasks, Unassigned group, this-week deltas.
  - S-curve: planned reaches 100 at project PF; actual(SD) = mean progress; forecast joins actual at SD and reaches 100 at forecast finish.
  - Critical path (M5): simple chain, parallel branches with float.
- **Excel round-trip (Node, exceljs):** read sample → write → read: data equal; header fills, column widths, freeze panes, data validation and an extra user column/sheet unchanged. Messy fixture: all issues reported, unparseable text preserved.
- **Manual QA:** §15 before closing each milestone that touches UI.

---

## 13. Sample data
`src/sample/sampleData.ts` defines **"PM (3Y) F-101"**, a furnace maintenance turnaround modelled on a real schedule (its task names, durations and FS/SS/lag/lead structure), on the app's 7-day calendar. The project, people, contractors and equipment tags are made up (§17, 2026-11-04). It is used by "Try with sample data", by `scripts/make-sample.ts` and by the engine tests:
- 25 tasks including 3 milestones (Shutdown: unit handed over to maintenance · Inspection complete · Handover to operations); an extra user column `Area` (the section headings of the original schedule).
- 9 resources: 6 Contractors, 3 Teams; one task with 2 assignees; one task with no assignee.
- FS and SS links, one positive lag (`2FS+1`), one lead (`16FS-1`).
- Project Start Mon 28 Sep 2026, fixed Status Date **Wed 30 Sep 2026**, 2 holidays: Tue 13 Oct (inside the plan) and Fri 23 Oct 2026.
- At SD (22 non-milestone tasks): 7 completed (one finished late), 4 in progress (one behind → Late, one started early), one not started past its planned start (→ Late; no successors, so it doesn't propagate), the rest future. The behind task drives the finish: forecast 17 Oct vs planned 15 Oct (+2d).
- Mode = Track; a few remarks (one in Thai).

`scripts/make-sample.ts` also writes `tests/fixtures/messy.xlsx`: blank IDs, a duplicate ID, invalid notation, an FF link, a cycle, a formula cell, text dates, a %-formatted progress cell, a 100% task without Actual Finish, an extra user column, and an extra sheet.

---

## 14. Milestones & acceptance criteria

### M0 — Scaffold & engine
- Vite + React + TS + singlefile; tokens and base styles; fonts inlined.
- All `engine/` modules from §5 except critical path; `compute()` entry point.
- **AC:** `npm test` passes all §12 engine cases; `npm run build` produces one HTML that opens via `file://` with a placeholder screen and no network requests.

### M1 — Excel I/O & file access
- Schema mapping with aliases; reading rules; normalization with Change log; write-back per §4.8; template generator (all 5 sheets, styles, validation, Read Me); `make-sample.ts`.
- File access: open, drop-to-open, save, save as, fallback, recent file, conflict detection, locked-file dialog.
- **AC:** round-trip tests pass; a saved file opens in Excel with formatting intact; File System Access on `file://` verified in Edge and Chrome (result recorded in §17).

### M2 — Main view (read-only)
- Header, KPI strip (both modes), toolbar shell, grid, Gantt (both modes, zoom, status/today lines, arrows, tooltips), mode switch, empty state, Load report + Issues panel.
- **AC:** the sample renders correctly; KPI numbers match engine test expectations; mode switch changes columns, bars and KPIs.

### M3 — Editing
- Inline editing, drawer, add/insert/delete/move, link/unlink, predecessor picker with cycle prevention, renumber, project settings, status date change, Track auto-fills (§8), quick fixes, undo/redo, shortcuts, dirty state and save flow, search/filter/columns/density, preferences.
- **AC:** every rule in §8 works; undo restores every action; save → reopen shows identical data.

### M4 — Report
- All sections of §9, options, print CSS, chart-to-image.
- **AC:** Edge "Save as PDF" gives 3–4 clean A4 landscape pages (no clipped charts or split rows); report numbers equal the KPI strip.

### M5 — Polish
- Critical path (§5.10) + toggle + Critical column; Color by assignee; drag move/resize (Plan); keyboard shortcuts overlay; About; final QA (§15).
- **AC:** §15 fully passes.

---

## 15. Manual QA checklist
- [ ] Open the sample .xlsx from a OneDrive folder in Edge and in Chrome via `file://`.
- [ ] Load report lists filled/corrected values; Issues quick fixes work.
- [ ] Plan mode: add 3 tasks, chain them with Link, change a duration → successors move.
- [ ] Track mode: set progress 50% on a task → Actual Start auto-set; KPI and S-curve update.
- [ ] Change status date → late flags and forecast update.
- [ ] Save with the file open in Excel → locked-file dialog; close Excel → Retry succeeds.
- [ ] Edit the file in Excel while the app is open, then Save in the app → conflict dialog.
- [ ] Reopen the saved file in Excel: formatting, widths, extra column and extra sheet intact.
- [ ] Thai task names display correctly in grid, Gantt, drawer and report.
- [ ] Undo/redo across 10 mixed actions.
- [ ] Major tasks: Group a few tasks, Indent / Outdent, collapse and expand; dates and % roll up; drag a row into another group and to another Level; Save and open in Excel: bold major tasks, indented names, +/− collapses each group.
- [ ] Day zoom: Saturdays and Sundays marked in the timeline and the chart.
- [ ] Report prints to PDF cleanly.
- [ ] Print Gantt: in Plan mode with Color by assignee and the critical path on, a collapsed group and a hidden column, the PDF shows the same colours, rings, red arrows, rows and columns; A3 fits more rows; Track mode prints its bars and status date.
- [ ] DevTools Network shows zero requests.
- [ ] Keyboard-only: open, add task, edit, save. The first Tab offers "Skip to task grid"; dialogs open on their safe button or first field and give focus back when they close.

---

## 16. Future ideas (out of scope for v1)
Links to and from major tasks · WBS codes · FF/SF links · a per-project working-week setting (e.g. Mon–Fri) · weighting by manhours · dark mode · multiple baselines · SharePoint/Microsoft Graph for multi-user · export report to PowerPoint · import MS Project XML · resource capacity and over-allocation warnings · hatched "slip" on the part of a late bar past its planned finish (also in Color by assignee and in print).

---

## 17. Decisions log
Claude Code appends decisions made during the build (date · decision · reason). Example:
- 2026-10-22 · Every task weighted equally; milestones excluded from % · Owner request: no weighting.
- 2026-10-30 · Develop in `C:\dev\gantt-planner`; `npm run build` copies the HTML and `docs/` to `GANTT_COPY_TO` (set in git-ignored `.env.local`) · Google Drive's virtual drive can't hold `node_modules` (npm write errors, no symlinks); owner chose local dev + copy back.
- 2026-10-30 · Stack: Vite 8 + @vitejs/plugin-react 6, Vitest 5, TypeScript 7, React 18.3; each library is added in the milestone that needs it (exceljs M1, zustand/lucide M2–M3, chart.js M4) · Current versions; keep M0 lean.
- 2026-10-30 · `Task.links` removed: `predecessorsText` is the only source of links and `compute()` parses it on every recompute; `TaskResult` adds `progress`, `actualStart`, `predecessorsText`, `links`; `compute(project, tasks, calendar, resources)` · One source of truth; the writer and Gantt get everything from the result; by-assignee needs Resource types.
- 2026-10-30 · Any link issue (bad token, FF/SF, missing ID, self link, duplicate) → write the text back unchanged; new warning `W_DUP_LINK` · Never drop a reference the user typed; §5.2 listed duplicates without a code.
- 2026-10-30 · Cycles found with strongly connected components; only links between members of the same cycle are ignored; one `E_CYCLE` per cycle, IDs in row order · Kahn's algorithm alone can't tell cycle members from tasks downstream of a cycle.
- 2026-10-30 · Rules that need the sheet are done by the Excel layer (M1): blank/duplicate IDs (`E_DUP_ID`), `W_BAD_DATE`, `W_FORMULA`, `W_UNTITLED`, "today" defaults, and Changes for calc-only columns (Successors, Status, Forecast, Variance, Actual Duration). `compute()` records Changes for Planned Start/Duration/Finish, Progress, Actual Start, Predecessors (canonical rewrite) and new Resources · The engine stays pure and only sees typed tasks.
- 2026-10-30 · Task counts (Tasks KPI, late count, by assignee) exclude milestones; milestones are counted separately · Matches "milestones excluded from %".
- 2026-10-30 · `W_PROGRESS_NO_AS` quick fix sets Actual Start = `min(PS, SD)`, the same value used for calculation; a milestone at 100% without AF only gets `W_100_NO_AF` · Applying the fix doesn't change any number; no double warning.
- 2026-10-30 · Linear parts of the S-curve count working days with end-of-day values (day d includes its own work), like `plannedPct`. The S-curve includes SD as a point when SD is a non-working day; "this week" ends at SD or the workday before it · Lines must join at SD; a weekend SD must still cover 5 working days.
- 2026-10-30 · Mean of no tasks = 0; SPI = null when planned = 0; a plan without tasks reports Project Start as its dates and 0 days; Variance (pts) is rounded to 0.1 (half away from zero) before choosing the schedule state · No NaN; the label must match the number shown.
- 2026-10-30 · Data-error edges: an in-progress task whose AS is after SD forecasts from AS; a substitute finish never precedes the start; Track mode freezes each stored planned field separately and derives blank ones; a duration derived from a finish is at least 1 day; `plannedPct` is capped at 100; Actual Duration uses the "for calculation" values · No negative bars or impossible values from bad input.
- 2026-10-30 · Progress: a non-integer is rounded with a "corrected" Change but no issue; out of range → `W_PROGRESS_CLAMPED`. Rewriting predecessors in canonical form (`3,4` → `3, 4`) is a "corrected" Change · §5.3: every value that differs from the file is recorded.
- 2026-10-30 · Assignee names match case-insensitively after trimming; by-assignee order = Resources order, then new names by first appearance, then Unassigned; people without non-milestone tasks are omitted; a name repeated within one task counts once · Deterministic report order.
- 2026-10-30 · Build: only woff2 (Plex Sans Latin + Plex Sans Thai Thai subsets, 400/500/600, ~106 KB); data-URI favicon; Vite's modulepreload polyfill disabled · Small file; no `/favicon.ico` request over https; no `fetch()` in the bundle.
- 2026-10-30 · Sample replaced by the owner's furnace turnaround data (§13) · Owner request: use their real data, keep the planned template.
- 2026-10-30 · M0 check: `dist/gantt-planner.html` (307 KB) opened via `file://` in headless Chrome (DevTools Protocol) and over `http://localhost` in Chrome: the only requests are the document and inline `data:` fonts; no console errors · AC for M0.
- 2026-10-30 · Working week = all 7 days; only dates in `Holidays` are non-working (§1, §2, §4.5, §5.1, §7.8). "This week" = the 7 days ending at SD, and the look-ahead counts calendar days (§5.8, §9.3); this replaces the "last 5 working days" rule above · Owner decision: turnaround work runs every day. No Project field was added, so the Excel schema is unchanged; a per-project working-week setting is listed in §16.
- 2026-10-30 · FS gap around milestones (§5.4): 0 into a milestone (it sits at the end of its predecessor's finish day) and 0 out of a start milestone (no predecessors, or only start-milestone predecessors); otherwise 1. Forecast and (later) critical path use the same gap · Owner decision: with gap 0 out of every milestone, `A → milestone → B` made B start on A's finish day; a "Shutdown" milestone must still let work start the same day.
- 2026-10-30 · Plans of up to 200 tasks (§1, §3.3, §10). `Assigned` stays as specified (several names separated by `,` or `;`); no importer for the owner's older Excel layout · Owner: real plans have 120–150 tasks; Book1.xlsx was only example data; an activity may have several RPs, separated by `,`.
- 2026-10-30 · M1 libraries: exceljs 4.4.0 (latest; the browser build resolves `exceljs` to its prebuilt `dist/exceljs.min.js` through the package's `browser` field, Node gets the Node build) and zustand 5 (the file session lives in the store from M1, so M2 doesn't rebuild it) · Current versions; one import site, `src/excel/exceljs.ts`.
- 2026-10-30 · Writing keeps each task row's own cell styles, height and hidden state (instead of one style per column), and writes unchanged text cells back as they were (rich text, hyperlinks) (§4.8) · "Never break formatting": a row the user highlighted stays highlighted and moves with its task.
- 2026-10-30 · Unparseable input text is kept only in input (dark-header) columns and only while the field has no value in the app; Planned Finish is a calculated column and is always overwritten (§4.8) · Matches the header colours the Read Me explains; a value entered in the app wins.
- 2026-10-30 · Reading: rows blank except for ID are skipped, rows with data only in user columns become untitled tasks (§4.3); dates outside 1950–2199 are unparseable; a bad ID gets the next free ID; Planned Duration is rounded; new warnings `W_BAD_NUMBER` and `W_BAD_HOLIDAY` (§4.7, §5.11); bad Project-sheet values fall back to their defaults with a `corrected` Change · Pre-numbered empty rows aren't tasks; a typo like `5` in a date column must not stretch the plan back to 1900; the Project sheet is the app's own settings.
- 2026-10-30 · Content ExcelJS would drop (charts, pivot tables, slicers, timelines, threaded comments, form controls, data model) is detected from the file's part names: `W_UNSUPPORTED_CONTENT` at load and a confirm before saving over that file (§3.5); the Read Me says so (§4.6) · ExcelJS can't round-trip these; never delete user content without asking.
- 2026-10-30 · "Save a copy…" (locked-file dialog) works like Save as: the copy becomes the open file · The original stays locked until Excel closes it; continuing on the copy avoids a plan that stays "unsaved".
- 2026-10-30 · Rows left over from deleted tasks are cleared in place (values and styles) rather than spliced out · ExcelJS 4.4's `spliceRows()` does nothing when the rows to remove are the last rows of the sheet.
- 2026-10-30 · M1 check of File System Access on `file://` (headless Chrome 156 and Edge 156 via DevTools Protocol): secure context; `showOpenFilePicker`, `showSaveFilePicker`, handle permissions and `getAsFileSystemHandle` all present; dropping a real file opens it with a handle; the handle survives a reload in IndexedDB ("Reopen"); the template downloads; only the document and inline fonts are requested. The permission prompt and native pickers can't be driven headless: save in place, Save as, locked file and conflict wait for the owner's manual check (PROGRESS.md) · AC for M1.
- 2026-10-30 · Tokens `--done-text`, `--progress-text`, `--late-text`, `--risk-text` for status-coloured text (§7.2) · The status colours on their soft backgrounds (or amber/green on white) are below WCAG AA contrast for 11–13 px text (§10); bars keep the original colours.
- 2026-10-30 · M2 main view: the toolbar has only the zoom until M3 brings editing; the header's Report button arrives with M4 and the More menu holds New plan, Save as… and Download blank template (the other items arrive with their milestones); the status date is shown read-only until M3; default zoom Fit · Each milestone adds the controls it makes work.
- 2026-10-30 · Dependency arrows: Plan mode draws them all; Track mode draws only the hovered or selected task's arrows (to its predecessors and successors), in `--accent`, from forecast/actual bar to forecast/actual bar, meeting a Track bar 4 px above the middle of its row (level with the 14 px bar); milestones are drawn in the middle of their day · All arrows in Track would cover the progress bars, but a tracker must see what drives a slip without switching to Plan, which recalculates the baseline (§5.4). This replaces "arrows in Plan mode only".
- 2026-10-30 · Switching Plan → Track stores the planned dates just shown in the tasks, so Track freezes the baseline the user saw (§5.4); Track → Plan adds any recalculated dates to the Changes list ("Plan recalculated") · Without it, Track would bring back stale stored dates; Save writes these values anyway.
- 2026-10-30 · Issues panel: Problems = the live engine issues + what the reader found at open while it still applies (see below), errors first; the header badge and the Problems tab both count errors and warnings. Changes = the load changes + plan recalculations, until the file is opened again. The amber "Unsaved changes" in the file chip opens Changes while that list holds changes no Save has written yet (after a Save it is plain text) · The Load report toast hides after 4 s; there must be another way back to the list, but not to a list that is already in the file.
- 2026-10-30 · Each task keeps the Excel row it was read from in `Task.source` (opaque outside the Excel layer; §11.1), instead of a table keyed by ID · Formatting and unparsed text must survive Renumber, moves, deletes and undo.
- 2026-10-30 · After every edit, tasks whose plan isn't frozen (Plan mode, or added this session in Track mode) store their derived Planned Start, Duration and Finish · Otherwise the engine reports the app's own edits as corrections ("finish recalculated"); these values are what Save writes. A task whose last link is removed stays where it was.
- 2026-10-30 · Editing rules beyond §8: Plan mode keeps actual fields read-only and Track mode the plan (§6), each with a toast; setting progress below 100 on a task with an Actual Finish clears the finish (toast) · Otherwise the engine shows 100 % again and the edit seems ignored.
- 2026-10-30 · Delete asks only when other tasks depend on the ones going (§8), from the button and the Delete key alike, and the toast offers Undo; Link skips links that would close a cycle (toast), Unlink removes the links among the selected tasks · Undo makes a confirm for every delete unnecessary.
- 2026-10-30 · New IDs = the highest ID used this session or present now, + 1; Renumber resets that counter to the task count · No reuse within a session, no collision after undoing a renumber.
- 2026-10-30 · Undo covers every plan change, the status date and the mode switch included (100 steps); "Unsaved changes" clears when undo returns to the last opened or saved plan · One rule for every action (§8).
- 2026-10-30 · Grid: double-click edits an editable cell and opens the drawer elsewhere (ID, calculated cells, Gantt bars); shortcuts are ignored while typing in a field, and Ctrl+S first finishes the edit in progress; Esc in a drawer field drops the draft, a second Esc closes the drawer · Predictable keys; no lost edits.
- 2026-10-30 · Preferences in localStorage (`gantt-planner:prefs`): zoom, density, grid width per mode, columns per mode, KPI strip collapsed; search and filters reset when a file opens and never change the KPIs · §7.13; the KPIs describe the whole plan.
- 2026-10-30 · Report charts are drawn once with Chart.js (animation off, 2×) and shown as PNG images on screen and in print; the header band and footer of every printed page come from CSS `@page` margin boxes, and screen pages show the band themselves · One image path for screen and print (§9.2: no blank or blurry canvases); margin boxes repeat on pages a long table adds.
- 2026-10-30 · Gantt appendix rows are 26 px instead of 28 px, the title sits in the label header, and long task names end with "…" · 25 rows then fit one A4 landscape page, so the sample prints on 4 pages (§14 M4).
- 2026-10-30 · Report content: the status donut puts late tasks under In progress or Not started (the late count is in the middle); the Late tasks table includes late milestones while the key message counts tasks only, as the KPI strip does; late milestones are marked with a diamond and show "—" for Progress, and the table opens with "N tasks and M milestones are late", where N is the KPI late count; the look-ahead lists milestones too, also marked · Every number matches the KPI strip; page 1 said "3 late" while page 3 listed 4 rows with nothing to tell them apart.
- 2026-10-30 · Report options (sections, look-ahead days) are kept with the preferences; "Prepared by" starts as the Owner each time the report opens · §7.13; Prepared by belongs to the plan, not the browser.
- 2026-10-30 · M4 check: headless Chrome 156 and Edge 156 "Save as PDF" (DevTools `Page.printToPDF` with the page's own CSS page size) of the sample: 4 A4 landscape pages (841.9 × 595 pt), header band and "Gantt Planner · sample-project.xlsx · Page n" on each, no clipped chart or split row; the report KPI row equals the main KPI strip · AC for M4.
- 2026-10-30 · M1 check in Excel 365: files saved by the app (sample, messy, template, and an Excel-edited file saved back by the app) open without repair, with formatting, notes, hyperlinks, conditional formats and validation intact · AC for M1.
- 2026-10-30 · Critical path (§5.10) follows the spec literally on the forecast network in both modes: late finishes start at the project forecast finish (every task, then the minimum over its links), links to or from completed tasks are skipped, FS uses the same gap as the forward pass, and LS uses Planned Duration even for a task in progress — so an unfinished predecessor of work already started gets negative float (critical). Completed tasks have no float and are never critical · One rule set; out-of-sequence work is worth flagging.
- 2026-10-30 · The Gantt header corner holds a palette menu (Color by status / assignee) and a "Critical" toggle; it sticks to the visible right edge while the chart scrolls and is narrow enough to sit over the room after the last date in Fit zoom. Both settings are kept with the preferences (§7.13) · With text labels for every option it hid the last week of the timeline, the forecast finish included.
- 2026-10-30 · Color by Assignee paints a bar in its first assignee's colour (the resource's Color, else the palette, as the avatars); unassigned bars are grey. Track bars: done part solid, the rest a 20 % tint with a border in that colour; milestones keep their status colours · Same colour per person everywhere; status stays readable on milestones.
- 2026-10-30 · Critical path shown: a 2 px red ring with a 1 px gap around critical bars and diamonds, red arrows between two critical tasks (in Track mode, among the focused task's arrows). The report's Late tasks always flag critical tasks, with a one-line legend; the Excel Critical column is written whatever the toggle · In Track mode late bars already have a red border; the toggle is a view setting.
- 2026-10-30 · Drag (§7.8): a press becomes a drag after 4 px; a task "root" = no predecessors used for calculation; a linked task's bar doesn't move and the tooltip and a toast say "Set by predecessors — add lag to delay"; the right-edge handle changes Planned Duration (at least 1 day; milestones only move); Esc cancels; releasing is one edit and one undo step · Same rules as editing the cells (§8).
- 2026-10-30 · Error screen (§10): "Download my data as .xlsx" writes the plan in memory into the opened workbook (its formatting comes along), else into a blank template with the plan's holidays, as "<file name> (recovered).xlsx"; it never writes to the open file. "Try again" re-renders, "Reload" reloads (the unsaved guard still asks) · Data safety first; the crash may come from the open workbook itself.
- 2026-10-30 · Keyboard shortcuts overlay (`?`, or More › Keyboard shortcuts) lists §7.12 plus the mouse gestures (multi-select, double-click, drag); About shows the version, the offline/privacy promise and the bundled libraries and fonts with their licences · Discoverability of drag and multi-select.
- 2026-10-30 · Grid editing: Enter, F2 and double-click put the caret at the end of text (as F2 in Excel) and select a number; typing over a cell still replaces it. Until a cell is active, the focused grid shows a focus ring · Excel users expect F2 to keep the text; §10 visible focus.
- 2026-10-30 · Report print: headings stay with the table that follows them (`break-after: avoid`); long tables still break between rows with the header repeated · A heading alone at the bottom of a page.
- 2026-10-30 · M5 QA (§15) in headless Chrome 156 and Edge 156 via `file://`, with the native pickers replaced by an in-memory file handle so Open, Save, the locked file (the write throws) and the conflict (the file is rewritten) run the app's own code; the saved files were then opened in Excel 365 (no repair; extra sheet, extra column, widths, freeze panes, fills and Thai text intact). Left to the owner: the real pickers, a file in a OneDrive folder, and Excel's own lock · Headless browsers can't drive native pickers or permission prompts.
- 2026-10-30 · Predecessors: a line break separates items like `,` and `;` (Alt+Enter in Excel, rewritten as `3, 4`); whitespace between two numbers is invalid notation (`E_BAD_LINK`, text written back unchanged) instead of being dropped (§5.2) · "Whitespace ignored" merged `3 4` and `1⏎2` into `34` and `12` — often another real task — with no issue, and Save overwrote the user's text. The grid's live check and the drawer use the same parser.
- 2026-10-30 · Size limits in the engine: a lag beyond ±3650 working days is invalid notation (`E_BAD_LINK`); a Planned Duration above 3650 that reaches the engine is `W_BAD_NUMBER` and treated as blank; date arithmetic clamps to years 0100–9999; the S-curve samples spans longer than 2000 days (§5.1, §5.2, §5.4, §5.9) · A typo or a pasted date serial in Duration froze every recompute, and a huge lag made compute() throw "Invalid time value", so the file couldn't be opened (§10: an issue, never a crash). The per-value limits don't bound a long chain, hence the clamp and the sampling.
- 2026-10-30 · The engine checks actual dates too: an Actual Start or Actual Finish outside 1950–2199 is `W_BAD_DATE` and ignored for calculation; the engine doesn't rewrite it (§5.5) · Defence behind the editors' checks: a 2-digit year (0026) was computed as 1926, giving a 36,527-day Actual Duration and a 100-year S-curve.
- 2026-10-30 · A milestone with an Actual Start on or before the status date and no Actual Finish is treated as achieved on its Actual Start (Progress corrected to 100), with warning `W_MS_NO_AF` and quick fix "Set Actual Finish = Actual Start"; a future Actual Start doesn't count. In the app, any progress above 0 on a milestone means 100 % (Actual Finish = its Actual Start, else SD), and progress 0 or clearing Actual Finish clears both actual dates (§5.5, §5.11, §8) · It stayed Late forever, held back its successors and wasn't counted as done, with no warning — and recording "Shutdown happened on 28 Sep" in Actual Start is natural. Only the user's click writes the finish; the quick fix changes no number. Since an Actual Start alone now means reached, un-completing must clear it too; a future Actual Start is more likely a forecast typed in the wrong column.
- 2026-10-30 · The `W_100_NO_AF` quick fix on a non-milestone with no Actual Start also sets Actual Start = `min(PS, SD)`, the start already used for calculation; the button shows both dates. An Actual Start outside 1950–2199 counts as none and is replaced (§5.5, §5.11, §11.1) · Applied first, it stored only the finish, and the "AF set, AS blank" rule then moved the start to SD (Actual Duration 12 → 1, "this week" inflated). A quick fix must never change a number, whatever the order.
- 2026-10-30 · Critical path: an SS link no longer limits the late finish of a predecessor that has started (§5.10). This narrows the earlier critical-path decision: FS links, and SS links from predecessors that haven't started, still flag out-of-sequence work · A started task's SS links are already met and §5.6 never moves an SS successor by its predecessor's finish, so an in-progress task with a long SS successor showed float 0 (critical) with days of slack, and the report said a delay would move the finish.
- 2026-10-30 · Reading never throws on a huge number: a serial above Excel's last day (2958465) is an unparseable date (`W_BAD_DATE` / `W_BAD_HOLIDAY` / a `corrected` Project value), and a date cell too large for Excel shows as `#####` in messages (§4.7) · A 10-digit work-order number pasted into a date column made Open fail with "Invalid time value" and no cell named.
- 2026-10-30 · Buddhist-era years (2493–2742) are converted (−543) with a `corrected` Change "Buddhist-era year converted"; Thai month names are accepted in `d MMM yyyy`, where a 2-digit year is Buddhist-era. In Holidays the conversion is silent; a plain serial number is never reread as Buddhist-era (§4.5, §4.7) · Thai users type พ.ศ.; such years lie outside 1950–2199, so no date accepted before changes; the Holidays sheet is never written, so a Change there would mark every open "unsaved" with nothing Save could fix; a 6-digit number in a General cell is more likely a stray number than a date.
- 2026-10-30 · 1904 date system: serial numbers in a workbook saved with "1904 date system" count from 1904-01-01 (date cells were already right) · A General-format serial in an old Mac workbook moved dates 4 years without a warning.
- 2026-10-30 · ISO date cells (`t="d"`, written by some tools, never by Excel) are not supported: ExcelJS reads `2026-10-30` as the number 2026, so the reader shows a date cell as "1905-07-18" (`W_BAD_DATE`) and Save writes 2026 over the user's date (Excel shows 18-Jul-05). Until that is fixed, the file scan lists them as content the app can't keep (`W_UNSUPPORTED_CONTENT`, "date cells in ISO format (written by another program)"), so the first Save asks and offers Save a copy (§3.5) · **Open question for the owner:** real support needs a pass over the zip before ExcelJS loads it (convert each `t="d"` cell to a serial number, or give the reader the ISO texts). `unsupported.ts` already reads sheet XML with its own zip reader and `DecompressionStream`, so no new dependency is needed to find the cells; rewriting them before `loadWorkbook` means re-zipping, which needs either a small zip writer or `jszip` as a direct dependency (today only a transitive one of ExcelJS).
- 2026-10-30 · Planned Duration text with a day unit (`d`, `day`, `days`, `วัน`, optional trailing `?`) is read as the number ("Unit removed"); other units stay `W_BAD_NUMBER`. A Planned Duration above 3650 (`MAX_DAYS`) is `W_BAD_NUMBER`, blank for calculation, original kept on save (§4.7) · The app shows durations as "5d" and MS Project pastes "5 days"; reading them as blank made 1-day tasks, and in Plan mode the 1-day fallback was then saved over the user's text. A huge duration froze every recompute.
- 2026-10-30 · A number shown with a date format (a date before 1950 from ExcelJS) is read as its serial number in ID, Planned Duration and Progress; when Save writes a number into a date-formatted cell, the cell gets the `General` format (§4.7, §4.8) · Excel gives Finish − Start and inserted columns a date format; a duration of 5 was read as blank and an ID renumbered, so links could point at other tasks.
- 2026-10-30 · IDs read from Excel must have at most 12 digits (`MAX_ID` = 999,999,999,999); a larger one gets the next free ID with a `corrected` Change (§4.7) · From about 16 digits, max + 1 is the same number, so blank rows shared one ID; 12 digits still fits work-order numbers used as IDs.
- 2026-10-30 · Formulas: `W_FORMULA` names each column and its cells and points to the task when only one row has formulas; on the Project sheet `=TODAY()`/`=NOW()` as Project Start or Status Date means today, and any Project formula gets a `corrected` Change because Save writes its value (§4.7, §5.11) · The user couldn't tell a harmless formula in a calculated column from a "Total" row or a user column losing its formula; a `=TODAY()` status date silently froze at the day Excel last recalculated.
- 2026-10-30 · A file without a `Tasks` sheet gives `W_NO_TASKS_SHEET`; a Tasks sheet whose row 1 has no Task header gives one `E_NO_TASK_HEADER` (and no `W_UNTITLED` per row); missing input columns next to user columns give `W_COLUMNS_NOT_FOUND`; Holidays/Resources without their `Date`/`Name` header give `W_HOLIDAYS_NO_HEADER` / `W_RESOURCES_NO_HEADER`, and Save leaves such a Resources sheet as it is (§4.1, §4.3–4.5, §4.8, §5.11). The reader still keeps every row and value; headers are not searched for in other rows and no aliases were added · The app opened such files as an empty or "(Untitled)" plan, or dropped every holiday, without saying why; header aliases would change the Excel schema and wait for the owner. Appending a `Name` column to a Resources sheet whose header was renamed put palette colours into the user's Color column, and on reopen the user's types and colours were ignored with no warning.
- 2026-10-30 · Columns to the right of the last column with a header, a value, a formula or a note are not user columns, even if their cells carry formatting (§4.3) · One formatted cell in column XFD made 16,000 empty user columns and a 6-second Save; a note right of the last column must still travel with its task.
- 2026-10-30 · Task names with line breaks (Alt+Enter) are shown on one line and their cell keeps its line breaks until the name is edited: unchanged when its lines are tidy, else each line tidied (a space typed before Alt+Enter, a blank line) with a `corrected` Change; in `Assigned` a line break inside a name stays a space (not a separator), with a Change reason that says so (§4.7, §4.8) · Save turned the user's two-line names into one line; making a line break an Assigned separator is left to the owner (§17 "Assigned stays as specified").
- 2026-10-30 · An input date cell with a time of day is written back unchanged while its day matches the app's value (§4.8) · Night-shift starts (19:00) were saved as 00:00 with no Change; the app still plans whole days.
- 2026-10-30 · A number too large for a date in a date-formatted cell (any sheet) gives `W_DATE_TOO_LARGE` naming the cells; the first Save asks first (§3.5) and then empties those cells (a formula keeps its formula) (§4.8, §5.11) · ExcelJS loads such a cell as an invalid date, so its number is already lost, and writing it back produced `<v>NaN</v>`, a file Excel 365 can't open even in repair mode: the whole workbook was lost, not one cell.
- 2026-10-30 · Excel tables (ListObjects) are converted to normal ranges on every save, on every sheet; `W_EXCEL_TABLES` at load and the first-Save question ask first. Cells keep values, styles and notes; a table's filter buttons move to the sheet when it has none; structured references in formulas become `#REF!` (the warning says so) · ExcelJS 4.4 writes tables Excel can't open: it reads a missing `headerRowCount` (Excel's default, 1) as 0, and on a sheet with notes (Tasks always has them) writes `tableParts` before `legacyDrawing`. Checked in Excel 365: a saved file with a table on Tasks opens without repair after the conversion.
- 2026-10-30 · Merged cells in Tasks: a merged cell reads the merge's value only in the first cell's column (values merged down are repeated, headings merged across stay in their cell; a heading merged from left of the Task cell across it, e.g. Merge & Center over A:R typed in ID, is read as the Task with a blank ID); `W_MERGED_CELLS` at load and the first-Save question; Save splits every merge that reaches below the header before writing rows · ExcelJS sends a write into a merged cell to the merge's first cell, so after an edit, delete or move one task overwrote another (and a task could vanish into a merged heading row).
- 2026-10-30 · Cell notes and row outline level (grouping) travel with their task like styles; a new task has no notes and joins the group of the task above it; leftover rows lose notes and outline level. Notes are removed with ExcelJS's private `_comment` (its `note` setter can't clear one) · A note or group stayed at its row address and attached to whichever task moved there.
- 2026-10-30 · An existing task's blank, unformatted cell is written with the default style; only a new task copies the first data row's styles (§4.8) · The fallback applied to existing tasks too, so a highlighted first row spread into every blank Remarks/Assigned cell, permanently.
- 2026-10-30 · Unparsed Planned Start / Planned Duration text is kept until the user sets that field (`Task.unparsed`, set by the reader, cleared by `editTask` for the field it patches — a Planned Finish edit clears the duration); `settle()`, the Plan → Track switch and Project Start's "move tasks" don't clear it · The planned values stored after every edit made the writer overwrite "TBC" or "สองวัน" after any unrelated edit (even a status date change) with a value nobody typed. Actual Start/Finish and Progress keep the old rule (their fields aren't filled by the app).
- 2026-10-30 · Content checks look inside compressed parts (drawings, sheets, workbook.xml, custom.xml) through the zip's central directory and `DecompressionStream('deflate-raw')`, so open() awaits the scan; a part that can't be read is skipped. Part names added: `xl/externalLinks/`, `xl/connections.xml`, `xl/queryTables/`, `xl/richData/`, `xl/embeddings/`, `docMetadata/` · Cross-sheet drop-downs (`x14:dataValidation`), sparklines, shapes, internal links, sensitivity labels and formula/constant/whole-column/sheet-scoped defined names are dropped by ExcelJS but live inside deflated XML; no new library. A SharePoint `custom.xml` without a label isn't flagged, so not every OneDrive-for-Business file asks before Save.
- 2026-10-30 · A Tasks sheet saved filtered in Excel (`<filterColumn>` / `filterMode="1"` in the sheet, or `<filterColumn>` in the part of an Excel table on it) → info `W_EXCEL_FILTER`; Save writes every task row visible. Rows hidden by hand in an unfiltered sheet keep their hidden state. Another sheet saved filtered is named in `W_UNSUPPORTED_CONTENT` and the first-Save question ("the filter on sheet "{name}" (rows it hid stay hidden)"); its rows are left as they are · ExcelJS drops the filter criteria but kept the rows hidden, so the team saw tasks missing with no filter to clear. The template always has an autofilter, so the filter range alone can't be the signal. Checked in Excel 365: a filtered table keeps its criteria only in `xl/tables/tableN.xml`, with no `sheetPr`. On sheets the app doesn't rewrite, a row hidden by hand can't be told from one the filter hid, so they aren't shown.
- 2026-10-30 · On save, conditional formats and the print area whose range covered the whole old block of task rows (top row ≤ 2, bottom = the old last row) are resized to the new block; data validation of that shape grows to new rows; the header autofilter widens to the last header column but is never added or narrowed · Excel grows such ranges when rows are inserted inside them; the app rewrites rows instead, so new and shifted tasks fell outside the user's highlight and print area, and columns added by the app (e.g. the sample's Area) had no filter button.
- 2026-10-30 · Predecessors cells use the Text format (`@`): the template's column, and on save every task cell and the column when they are General; `W_PRED_NOT_TEXT` when Excel already turned the notation into a number with a thousands format or a date; the Read Me says "a comma and a space" · In a General cell Excel stores `5,120` as 5120 and `3-1` as 1 Mar, so links were lost with a misleading "predecessor 5120 does not exist". Rebuilding the list from the number isn't safe (`45,6789` is also accepted by Excel).
- 2026-10-30 · Template Progress validation is decimal 0–100 (message "Enter a number from 0 to 100, for example 50 or 50%."), not whole · Typing 50% in Excel stores 0.5, which the whole-number rule rejected although §4.7 reads it as 50; a non-integer is rounded by the reader with a `corrected` Change. Existing files keep their own rule (validation is preserved).
- 2026-10-30 · A percent number format is a `%` outside quoted text, `[..]` sections and escaped characters; `0"%"` and `[Red]0"%"` are not percent formats, so 50 is written as 50 and a 1 reads as 1 % · Writing 0.5 under `0"%"` showed "1%" in Excel. ExcelJS turns `0\%` into `0%` at load, so the backslash form can't be told apart and stays a percent format.
- 2026-10-30 · The writer matches Resources names with the reader's key (`cleanName`, case-insensitive), so a name with a double or non-breaking space isn't appended again · The first save added a duplicate row for such names, silently.
- 2026-10-30 · A save marks as saved exactly the plan it wrote: an edit made while the file is being written (after Ctrl+S, on a slow OneDrive write) keeps "Unsaved changes" and the unsaved guard; edits are not blocked during a save · `cleanPlan` was the plan at the end of the save, so a last edit could be lost with no warning.
- 2026-10-30 · While a save or an open runs, Open, Ctrl+O, Reopen, New plan, Try sample and drop wait with a toast ("Wait for the save to finish" / "Wait for the file to open"); a save's outcome (saved, conflict, failure dialog) applies only to the plan session that started it · An open during a save let the old save clear the new file's "Saving will remove charts…" confirm, set its conflict baseline and mark it saved.
- 2026-10-30 · Save failures are told apart by the step that failed: file gone (NotFoundError) → "moved, renamed or deleted" with Save a copy…; any other error reading the file at the conflict check (e.g. NotReadableError, OneDrive offline) → "Couldn't read {file} to check for changes" with the error, the OneDrive hint, Retry and Save a copy…; the workbook can't be built → Download my data; a throwing permission request → the permission dialog; only errors from the write itself (createWritable, write, close) give the locked-file dialog, now with the error as a details line; every failure is logged to the console. A file that can't be read back after a successful write counts as saved, with a baseline that makes the next save ask (conflict) · "The file is probably open in Excel → Retry" looped forever for a moved file or a build error, and nothing showed the real error. Excel's lock doesn't block reads, so a read error at the check is never the locked file. Error names alone (SecurityError, NoModificationAllowedError) can't tell Excel's lock from a permission problem.
- 2026-10-30 · "Save a copy…" (locked file, permission, content the app can't keep, file gone, unreadable) suggests "<name> (copy).xlsx". Save as… always writes the plan to the file picked, even the open file: Chromium creates or empties the chosen file before showSaveFilePicker returns (SELECT_SAVEAS_FILE → CreateAndTruncateFile), so refusing it or routing it to Save's confirm would leave the user's workbook at 0 bytes. A copy saved onto the open file says so in a toast ("You chose plan.xlsx itself, so your plan was saved there."), and any Save as… onto it names what was removed ("Saving removed charts from …, which Gantt Planner can't keep.") · The picker opened in the plan's folder with its own name: Save + "Replace" overwrote the file the dialog was protecting; the "(copy)" name is what lowers that risk, since the app can't undo the browser's truncation.
- 2026-10-30 · A picker refused with NotAllowedError or SecurityError (e.g. File System Access blocked by policy) switches the session to fallback mode: Open uses `<input type="file">` (an error dialog offers "Choose file…", since the refused picker used up the click) and Save downloads; a second picker while one is open does nothing, so a double click is never taken for a block. A fallback save that fails clears "Saving…" and shows the error; after a download the chip reads "Downloaded hh:mm". Fallback mode is app state, so the start-screen banner appears as soon as a picker is refused, and in the main view a plan with no file handle shows "· Save downloads a copy" in the file chip until the first download (instead of a second banner) · A dropped plan could otherwise never be saved on a locked-down laptop, a build error left Save and Open disabled for good, and nothing in the main view said Save would download.
- 2026-10-30 · Reopen forgets the remembered file only when the browser reports it missing (NotFoundError); other read errors (OneDrive offline or still syncing) show the error and keep the link; a refused or dismissed permission prompt shows a toast with Open… · A temporary OneDrive problem must not lose the link or suggest the file was deleted; a refused prompt did nothing visible.
- 2026-10-30 · Drop-to-open picks the single .xlsx among the dropped items; no .xlsx (other files, a folder) → "Can't open …" with the .xlsx-only message (Save As hint for .xls/.xlsm/.xlsb/.csv); several .xlsx → "Drop one workbook at a time"; the type check runs before the unsaved-changes prompt · Never ask to discard work for a drop that can't open.
- 2026-10-30 · Opening a file shows "Opening {file}…" from the moment it is chosen (after the picker, the Reopen permission or the drop), in the file chip and the start screen, and as a scrim over an open plan that swallows clicks and keys until the new plan is shown (including the browser's own Ctrl/⌘ shortcuts, since the app's Ctrl+S/Ctrl+O handlers that normally prevent them don't run); "Saving…" in Save as… starts once a file is picked · Reading a large or online-only OneDrive file gave no feedback, and edits made meanwhile vanished.
- 2026-10-30 · The main view stays mounted (hidden) under the report, so Back returns to the same scroll positions and active cell, with the focus in the grid; a plan opened or created from the report is shown in the main view, the report restarts per plan ("Prepared by" = its Owner), and Review in a toast leaves the report · Each report round trip lost the user's place in a 150-task plan; a new plan kept the previous plan's "Prepared by", and Review did nothing visible.
- 2026-10-30 · The Load report shows the `W_NO_TASKS_SHEET` / `E_NO_TASK_HEADER` message instead of the counts, with Review opening Problems · "Filled 4 values · 0 warnings" gave no hint that the tasks weren't found.
- 2026-10-30 · An edit that leaves the plan as it was (same value re-entered, a blank left blank, the progress step already chosen, Project settings applied unchanged, a name differing only in spaces, Unlink with nothing to remove) is no undo step, doesn't mark the plan unsaved and keeps the redo history; Unlink says "No links between the selected tasks" (§8) · Looking at a cell and pressing Enter made the file "Unsaved", Open/New asked to discard, and Ctrl+Z seemed to do nothing.
- 2026-10-30 · Renumber also rewrites the ID of FF/SF tokens (the rest as typed), and is refused, with the tasks to fix, while a predecessor names a missing ID or unreadable text holds a number (§8) · A dangling `2` became a link to the new task 2 and its error vanished; `20FF` kept pointing at the old number. Remapping a missing ID would rewrite what the user typed; blocking keeps the text and its meaning.
- 2026-10-30 · Renumber moves the selection, Shift-click anchor, drawer, pinned rows and Changes rows to the new IDs (reader problems follow `Task.source`); undo and redo of a Renumber map them back and forth · After an undo the drawer showed — and edited — another task with the same number.
- 2026-10-30 · The Changes list is restored with the plan on undo and redo; a date recalculated again ("Plan recalculated") keeps one entry, from its value before the first recalculation (§7.11) · Undoing a Track → Plan switch left its entries listed, and switching again listed every move twice.
- 2026-10-30 · Track → Plan confirm: "once per session" means once per opened or created plan; the confirmation resets on Open, Try sample and New plan (§6) · Confirming on the sample switched the team's real plan to Plan mode with no warning.
- 2026-10-30 · A task added in Track mode starts no earlier than the first working day after the status date (R, §5.6) (§8) · Starting on a past date, it was Late at once, raised the planned % for past dates and moved the schedule state before the user typed its name; a start on SD itself is still forecast at R and Late +1.
- 2026-10-30 · A typed Planned Finish before the Planned Start is refused with a toast; only Duration 0 makes a milestone (§8) · Same as reading the file (§5.4: a duration from a finish is ≥ 1) and dragging (at least 1 day); a mistyped date (e.g. a day/month swap) must not change the task's type or move its successors.
- 2026-10-30 · Entering Actual Finish with Actual Start blank fills Actual Start = Actual Finish (toast), the `W_AF_NO_AS` quick fix and the §5.5 calculation value; a one-day task whose finish moves earlier takes its start along (§8) · Same as the 100 % rule; the app's own edit shouldn't raise a warning, and no number changes. Files read with a blank Actual Start still get `W_AF_NO_AS`.
- 2026-10-30 · Dates typed in the app (task dates, Project Start, New plan) must be within 1950–2199, the range the reader accepts (§4.7), else a toast and nothing changes; the status date ignores such a value; Planned Duration (typed, or from a Planned Finish) is at most 3650 days (§8) · A 2-digit year (0026) was computed as 1926 and stretched the plan over a century; a typo in Duration froze every recompute.
- 2026-10-30 · Moving the root tasks with a new Project Start is a checked option inside Project settings, naming the old and new dates, instead of a second "Move · Keep" dialog (§8) · The second dialog replaced Project settings, Esc there dropped the name and owner edits, and its question named no task or date.
- 2026-10-30 · Delete, Link, Unlink, Move and Add-below act only on selected rows the search and filters show; changing them drops hidden rows from the selection; Move jumps over hidden rows; the Toolbar counts shown selected rows (§7.6) · A task selected before searching was deleted or linked without being seen, and Alt+↑ swapped with a hidden row so nothing visibly moved.
- 2026-10-30 · A task just added, or jumped to from the Issues panel or the drawer's Successors, stays shown despite the search and filters until they change, and the view scrolls to it (§7.6) · Like a new row under an Excel AutoFilter; a new task otherwise "vanished" behind the filter and got added twice, and a jump to a hidden task did nothing. Clearing the filters instead would undo the user's filter on every add.
- 2026-10-30 · A toast with an action ("Task deleted · Undo", "Plan recalculated · Review", the load report) is retired by the next plan change or undo, and the delete toast's Undo only undoes that delete (§7.11) · Within 4 s the button undid whatever came last — a rename, or after Ctrl+Z an earlier edit — while the deleted task stayed deleted.
- 2026-10-30 · Problems the reader found stay only while they still apply, worked out from the current plan (not deleted from state, so undo brings them back): they go when their task is deleted; `W_BAD_DATE` / `W_BAD_NUMBER` once Save would no longer write the text back and, before the first Save, the field has a value in the app (a bad Planned Finish, always recalculated, stays until a Save overwrites it); `W_UNTITLED` when the task is named; `W_PRED_NOT_TEXT` once the task's Predecessors text differs from what was read (the user retyped it, or Renumber rewrote it), because Save then writes the new text instead of writing the number or date back; `E_DUP_ID` after Renumber; and after any Save, the problems that Save settles: `E_DUP_ID`, `W_UNTITLED` (saved as "(Untitled)"), `W_FORMULA` (saved as values), `W_UNSUPPORTED_CONTENT`, `W_EXCEL_TABLES`, `W_MERGED_CELLS`, `W_EXCEL_FILTER`. They follow their task's row (`Task.source`) through Renumber, with the new ID in the message and the jump. Other file-level problems (`W_BAD_HOLIDAY`, a missing sheet or header, columns not found) stay until the file is opened again · A badge that can never reach zero teaches the planner to ignore it; Save and the list must agree on what is still in the file.
- 2026-10-30 · Issues panel layout: errors and warnings under "Errors · n" / "Warnings · n" headings, each row with an icon (octagon / triangle), the §5.11 message unchanged and "#id · name" under it; information items (severity info: `W_START_DRIVEN`, `W_NONWORKDAY`, `W_FINISH_RECALC`, `W_FORMULA`, `W_EXCEL_FILTER`, `W_NEW_RESOURCE`; most repeat a Changes row) in a closed "Notes" group that doesn't count. A quick fix shows a toast with Undo and moves the focus to the problem now in its place. The tabs follow the tab pattern (←/→, Home/End, one tab stop). A Changes row whose task is gone shows its "#id" as plain text. Review in the Load report opens Problems when there are errors or warnings (or no Changes), else Changes · Severity must not depend on colour alone (§10); the badge said 13 while the tab said 14; IDs in a hand-kept sheet aren't in row order, so the name identifies the task.
- 2026-10-30 · Dialogs focus their first form field, else the safe primary action (Cancel in the file-changed, discard and delete confirms, "Stay in Track" in the Plan-mode confirm), never the destructive button listed first; when a dialog closes, focus goes back to the control that opened it (a menu item hands over to its menu button), else to the task grid · React's `autoFocus` fires while the `<dialog>` is still closed, so `showModal()` focused the first button: Enter after Ctrl+S on "File changed" reloaded the file and dropped every unsaved edit. §10 keyboard access, §15 keyboard-only flow.
- 2026-10-30 · One Esc closes one thing: a menu, popover or toast that handles Esc consumes it (and puts focus back on its button), so the same key press doesn't also close the drawer, the Issues panel or the report. A dialog that opens while a menu or popover is still open (a shortcut such as `?` or Ctrl+S pressed meanwhile) gets the Esc first · In the report, Esc on Options left the report and lost the typed "Prepared by".
- 2026-10-30 · Keyboard models (§10): menus focus the current choice (else the first item) when they open; ↑/↓/Home/End move, Enter picks, Esc or Tab closes. Segmented controls (Mode, Zoom, Look-ahead) are radio groups with one Tab stop; arrows, Home and End pick the next option (Plan from Track still asks first, §6). The toolbar is a plain group (no arrow-key model) · ARIA roles promise these keys; each segmented control was 2–4 Tab stops.
- 2026-10-30 · Menus mark the current choice (Color by, Row density) with a check icon (`menuitemradio` + `aria-checked`), not a "✓" in the text; the More menu keeps the §7.4 order, with icons, separators (file · project · help) and shortcut hints (Save as… Ctrl+Shift+S, Keyboard shortcuts ?). The Color by button shows an accent fill and is named "Color by: Assignee" while bars are coloured by assignee; Row density is named by the current density. No assignee legend: the Assigned column already shows each assignee's colour on the bar's row · The setting is kept in the preferences, so a plan could reopen with assignee colours and nothing on screen saying so.
- 2026-10-30 · The header status date keeps what is typed as a draft and sets it on Enter or on leaving the field; a day picked in the calendar is set at once; Esc puts the plan's date back. Only dates in 1950–2199 are set (a whole date outside it is refused with a toast); every date input carries `min`/`max` 1950-01-01 / 2199-12-31 · The input reports a value on each key typed in the year (0002, 0020, 0202…): every one was a recompute and an undo step, and year 0202 built a 1,800-year timeline that froze the app for ~14 s.
- 2026-10-30 · The workspace (grid, Gantt, drawer) is the page's `<main>`; a "Skip to task grid" link is the first Tab stop · About 20 Tab stops (header and toolbar) came before the grid on every pass (WCAG 2.4.1).
- 2026-10-30 · Header: the actions column (status date, Issues badge, Open, Save, Report, More) never shrinks below its content and doesn't wrap; the project name gives way with an ellipsis. The status-date label and the "Today is …" hint stay visible · At 1280 px with the Issues badge the label wrapped to two lines and the badge split into "!" over the count.
- 2026-10-30 · KPI strip collapse (§7.3): chevron at the strip's right edge; collapsed = one line per card (label, value, state chip), captions and mini bars hidden; expanded by default, never collapsed automatically by window height; saved as `kpiCollapsed`; the report always shows full cards · At 1280×720 the header, KPI strip and toolbar took a third of the height; auto-collapse would make it the default on every laptop.
- 2026-10-30 · Undo and Redo buttons at the left of the toolbar, besides Ctrl+Z / Ctrl+Y; no per-action labels on the undo stack · Principle 5: undo must be findable without the keyboard, and the shortcuts are ignored while a field has focus. Labels would change every commit() call site.
- 2026-10-30 · Undo / Redo are marked `aria-disabled`, not `disabled`, with nothing to undo / redo · A disabled button loses the focus, so the last undo by Enter or click dropped the keyboard user to the page and the arrow keys no longer reached the grid.
- 2026-10-30 · Toolbar in a narrow window: buttons keep their size, the search box narrows from 196 to 110 px, and below 1100 px in Plan mode Link / Unlink / Delete become icon buttons · The Undo / Redo buttons made the Plan-mode toolbar overflow below ~1160 px (a 1366×768 laptop at 125 % is ~1093 px); it now fits down to the 960 px minimum in both modes. Add task keeps its label (primary action).
- 2026-10-30 · The KPI "N late" is a toggle (main view only) that sets the Status filter to exactly Late and back to all, keeping search and assignees; the Filter popover's separate "Late only" toggle is removed (Status "Late" listed first instead) · One-click daily view; the two controls were the same filter, and ANDing them with other statuses gave empty or wrong results. Clicking "3 late" can show 4 rows: late milestones are included, as in the report's Late tasks table.
- 2026-10-30 · KPI cards carry title tooltips that explain the figure with two-decimal inputs and the state bands from config; the drawer explains FS/SS with a tooltip and a one-line hint and shows lag with a `d` unit; no separate Terms help page · Goal §1.1 for first-time users reading English UI; explanations where the term appears; the shortcuts dialog already scrolls at 1280×720.
- 2026-10-30 · A plan with no tasks: the Track KPI cards and the report show "—" / "No tasks yet" instead of 0 % · On track · on time, and the grid shows "No tasks yet" with Add task (Plan) or Switch to Plan mode (Track); engine values unchanged · A green status for an empty plan is misleading; the blank template is a normal first path.
- 2026-10-30 · Percentages show 100% only when exactly 100 and 0% only when exactly 0 (99.5–99.99 → 99%, 0.01–0.49 → 1%); everything else rounds half up · With 150 tasks one task at 50 % gave "100%" next to "149/150 done" and "−0.3 pts".
- 2026-10-30 · Grid width per mode (§7.3, §7.13): until the splitter is dragged, the grid fits its visible columns, capped at 60 % of the workspace and 320–900 px, so hiding or showing a column resizes it; a dragged width is kept for that mode, and double-click / Enter on the splitter goes back to fitting. A width saved by an older version applies to both modes, except its old default 560, which becomes "fit". Columns are narrower (dates 84 px, Plan Start 96 for the link icon, ID 40, Task min 200, Progress 88, Variance 68, Status 100) and long headers wrap onto two lines; §6's column order is unchanged · On 1280–1440 px laptops the fixed 560 px hid Actual Finish (Track) and Predecessors (Plan), and Track's defaults (972 px) didn't fit even at 900 px. Now Plan shows every default column at 1280 px, Track up to Variance at 1280 and everything at 1440.
- 2026-10-30 · The Task column takes any spare grid width (its width is the minimum), so a grid wider than its columns has no empty strip and long names show in full; the New tag and the late dot are separate from the name, so the ellipsis never hides them · The header, row borders and selection stopped short of the splitter; the tag is the only grid cue that a Track-added task's plan is editable.
- 2026-10-30 · Assigned chips: only whole chips are shown (up to 2, measured in the chips' font), then "+N"; a lone first chip may end with "…". Thai initials skip the leading vowels เ แ โ ใ ไ · Every chip shrank to one letter ("M… Q… +1") in the 116 px column; 'สมชาย ใจดี' gave "สใ".
- 2026-10-30 · Avatar initials: white on the resource colour darkened 20 %; when that is under 4.5:1 (light Excel colours such as yellow, gold, light green, light blue), the avatar uses the plain colour with --text initials and a faint ring · Any #RRGGBB from Resources stays readable (§10); the built-in palette is unchanged.
- 2026-10-30 · Grid popovers (Assigned, Progress): Tab / Shift+Tab save and move, Esc cancels, a click outside (or Ctrl+S / Ctrl+O) saves a changed value; clicks inside a popover don't reach the cell under it. Progress gets a number box (typing a digit on the cell starts it, ↑/↓ ±5), the slider moves in steps of 1, and saving the value the task already has changes nothing (no undo step, no Actual Start filled in by §8). Popovers and hints are placed from their measured size (below the cell, else just above it) and follow the cell while the grid scrolls; starting an edit scrolls the cell into view, and when the cell is then scrolled out of view Assigned saves its chips (text still in the box is dropped, so it never becomes a name off-screen) and Progress cancels · Typing "50" on a Progress cell was dropped while the file still showed "Unsaved changes"; Tab left focus on the page with the popover open; a 33 % value couldn't be entered; popovers floated ~100 px away from their cell and stayed put while the rows scrolled, so a click could set the wrong task.
- 2026-10-30 · Assigned editor: typed or pasted text is split on "," and ";" like the Assigned cell is read, and a name matching a resource takes its spelling; text left in the box is added on Tab, on a click outside, on Ctrl+S, when a drawer field loses focus, and when a suggestion is picked; Esc drops it (in the drawer a second Esc closes the drawer); the drawer's box is keyed by task · A pasted "ACME, ThermCo" became one name that Save appended to the user's Resources sheet; a name typed and then tabbed or clicked away from was silently lost (§17 grid editing: "no lost edits").
- 2026-10-30 · Duration editor keeps the typed text and checks it: a decimal is rounded with a note under the cell (as a Planned Duration read from Excel is rounded, §4.7); text, a negative number or more than 3650 days shows a red message and Enter/Tab keep the editor open; leaving the cell with such a value keeps the old one (toast). The drawer's Duration field reads it the same way (the rounding is said by a toast; text, a negative number or more than 3650 is refused with a toast). The grid's date editor has min 1950-01-01 / max 2199-12-31 and refuses a date outside that range or half typed the same way (the input is asked on every key and click, as the browser sends no input event while a partly filled date stays blank); clearing every part clears the date · "1.5" was saved as 15 days and "a" was dropped without a word; a year typed as "26" was saved as 0026 (computed as 1926); deleting one part of a date cleared the whole date.
- 2026-10-30 · Grid date editor: as wide as the native control needs and growing leftwards over its neighbour (date columns are never sticky) · At 96 px the year was cut off ("30-Sep-2") while typing; widening the columns would push Actual Start/Finish off screen.
- 2026-10-30 · Remarks are edited in the grid with a textarea: Enter saves, Alt+Enter (as in Excel) or Shift+Enter adds a line break, and a remark with several lines opens over the rows below (up to 6 lines shown) · A single-line input silently joined the lines ("…kitVendor…") and Save wrote that over the user's cell (§4.8).
- 2026-10-30 · A grid cell that can't be edited explains why in its tooltip, with the same text as the toast (`readOnlyReason`): in Track mode a linked Planned Start says "Switch to Plan mode to change the baseline.", in Plan mode "Set by predecessors — add lag to delay." · Track mode told the user to add lag, which Track doesn't allow.
- 2026-10-30 · Delete / Backspace in the grid clear the active cell as in Excel (Assigned, Predecessors, Planned Start, Actual Start, Actual Finish, Remarks, through the §8 edit rules; a calculated cell or a field that can't be blank — Task name, Duration, Planned Finish, Progress — shows a toast). Tasks are deleted with Delete on the ID cell, with several rows selected, with no active cell or when the grid doesn't have the focus (e.g. after clicking a Gantt bar), with Ctrl+Delete, the toolbar or the drawer. When the active row is deleted the active cell moves to the row now in its place, same column; while the search or filters hide the active row, the row now in its place stands in and the active cell returns to the hidden row when it shows again, unless the user moved meanwhile. While a cell editor is open, Delete, Backspace and typed keys never run a window shortcut · Excel users clear cells with Delete; a wrong Actual Finish must not cost a task. Replaces "from the button and the Delete key alike" in the delete entry above; the confirm rule is unchanged.
- 2026-10-30 · `/` and `?` never start typing over a cell: they are shortcuts (press Enter or F2 first to type them); a key the grid or an editor already handled never also runs a window shortcut · Pressing `/` on a task name renamed the task to "/".
- 2026-10-30 · Ctrl+letter shortcuts fall back to the physical key (`KeyboardEvent.code`) when the layout reports a non-Latin character (not with AltGr = Ctrl+Alt); `/` and `?` stay on the character typed · On the Thai layout Ctrl+S arrived as "ห", so the browser's "Save page as" opened instead of Save, and undo, redo and Link did nothing.
- 2026-10-30 · Leaving a grid editor by clicking another control commits the edit and leaves the focus on that control; only Enter, Tab and Esc (or a click that lands nowhere focusable) bring the focus back to the grid · Taking the focus back made Chromium drop the click, so text meant for Search or the drawer replaced the task's cell.
- 2026-10-30 · Grid keyboard: Tab / Shift+Tab move between cells and leave the grid after the last / before the first column; Esc with no drawer or panel open clears the active cell; arrows come back on the row the selection ends on · WCAG 2.1.2 no keyboard trap and §10 keyboard reach, keeping Excel-style Tab inside the row.
- 2026-10-30 · The drawer opens from the keyboard: Enter / F2 on the ID or a calculated cell (as double-click) and Shift+F2 (MS Project's Task Information key) for the selected task, from the grid or a Gantt bar. A keyboard-opened drawer takes the focus; closing it returns the focus to the grid. Mouse opening leaves the focus where it was · §10 all actions reachable by keyboard.
- 2026-10-30 · Keyboard multi-select is Shift+↑/↓ from the active cell (Excel's range extension, from the selection anchor); no Ctrl+Space toggle. The grid's active cell follows a selection made elsewhere (Gantt click, Issues panel, drawer). Link (Ctrl+L) with fewer than two tasks selected says how to select more instead of doing nothing · Link, Unlink and multi-delete must be reachable without a mouse (§10); Ctrl+↑/↓ means jump-to-edge to Excel users.
- 2026-10-30 · The grid points screen readers at its active cell with `aria-activedescendant` (focus stays on the grid; no roving tabindex); person avatars are announced by name · §10 accessibility; the active cell was only a CSS outline.
- 2026-10-30 · Ctrl+S, Ctrl+Shift+S and Ctrl+O do nothing (the browser's own dialogs stay suppressed) while a form or confirmation dialog is open (Project settings, New plan, Discard changes?, Plan-mode confirm, Delete, Renumber); they still act over the file dialogs (conflict, can't save, file missing, permission, unsupported content) and help · A shortcut must never close a dialog and silently drop what the user typed or was about to confirm.
- 2026-10-30 · Ctrl+O and drop-to-open finish the edit in progress first, as Ctrl+S does; all three also finish an open Assigned or Progress popover as a click outside it would · Otherwise the unsaved-changes guard missed a typed value, and Save wrote the plan without the popover's change yet showed "Saved".
- 2026-10-30 · While the drawer is open it follows a plain selection (grid click, grid ↑/↓, Gantt click, Successors, previous/next); Ctrl/Shift multi-select leaves it on its task; ↑/↓ buttons in the drawer header step through the shown rows in row order and stay focusable at the first / last row (aria-disabled) · Edits never land on a task the user has left; stepping must survive a "Late only" filter dropping the task just updated.
- 2026-10-30 · Drawer fields keep a draft only while being edited: after Enter, blur or Esc they show the plan's value, so a refused or normalised entry (blank name, blank Duration or Planned Finish, out-of-range number or date) never stays on screen; the refusal is explained by a toast. Each field (and the lag boxes and picker) is keyed by task, so no draft carries over to another task · The drawer must always show what the plan holds (§7.9 "changes apply immediately").
- 2026-10-30 · Drawer date inputs carry min 1950-01-01 / max 2199-12-31; a half-typed date (the browser reports it as blank) is never saved — leaving the field puts the stored date back with the toast "Incomplete date — not saved"; only a fully cleared input clears the date · A slip while correcting one digit must not wipe an Actual Start or move a task to Project Start (§7.1 Forgiving).
- 2026-10-30 · Drawer progress slider: a mouse drag saves on release; keyboard steps (arrows, PageUp/PageDown, Home/End) only move it until Enter or leaving the slider, and Esc reverts · One change = one edit and one undo step; an arrow overshoot (100 → 95 → 100) must not clear and re-stamp Actual Finish (§8); PageUp/PageDown no longer get lost.
- 2026-10-30 · Predecessor picker ranks an exact ID first, then IDs starting with the query, then names containing it; a leading "#" is ignored; nothing is highlighted before a query is typed; ↑/↓ + Enter pick; Enter on an exact ID that can't be linked does nothing; a click outside closes it · Equipment tags in names ("PSV-101") must not outrank the task ID the planner typed; an Enter pressed before typing must not silently link task #1.
- 2026-10-30 · Drawer header chips: first chip = work state (Not started / In progress / Completed); a Late task adds a red "Late +Nd" in place of a second "Late"; a finished task with a variance adds a neutral "Finished Nd late/early" · Follows the §7.9 mock-up; no repeated words; a finished task isn't flagged as still late (same as the Gantt label, §7.8).
- 2026-10-30 · Drawer read-only values use a filled static box with the lock reason (`readOnlyReason`) as tooltip and the link icon on a linked Start; empty date inputs are dimmed. The native date format still follows the browser/OS locale · Same geometry as the inputs beside them; a custom date picker is out of scope (§7.7 native input).
- 2026-10-30 · Shared control styles (`controls.css`, incl. the destructive `.btn-danger` variant) load before any component CSS (main.tsx), so a component rule can modify a shared class at equal specificity · "Delete task" rendered as a neutral button, and the Issues panel's fix buttons and the Filter/Columns popovers lost their own sizes, because `.btn`/`.menu-list` came later in the bundle.
- 2026-10-30 · Gantt rendering: only the hovered bar's ID and the drag's day count are React state; the hover card and the drag tooltip follow the pointer by themselves; the lanes, marks, labels, arrows and timeline are memoised on the freshly computed rows and scale. The schedule is still fully recomputed on every change (CLAUDE.md #4: no memoised partial schedules) · Every pointer move re-rendered 200 rows and all arrows to move a tooltip: 5–9 ms per move, 25–43 ms on a 4× slower CPU, so the tooltip and the drag ghost lagged.
- 2026-10-30 · Bar labels on the main chart start 14 px right of the mark (the 8 px FS run + 6 px), in both modes; the report's Gantt appendix, which draws no arrows, keeps 6 px (§7.8) · The FS vertical at +8 px crossed the first letter of nearly every label (a Thai first letter can read differently).
- 2026-10-30 · Row hover is shared by the grid and the Gantt (a lane or a bar): one generated style rule highlights the row in both panes; it doesn't move while a mouse button is held (bar or splitter drag); the arrows follow only bar hover or the selection (§7.7) · Following a row from a 560 px grid to its bar on 150–200-row plans; arrows following lane hover would flicker as the pointer crosses the chart.
- 2026-10-30 · Drag: on a bar under 16 px wide (Month zoom, a small Fit) the resize handle is 6 px just past the bar's right end instead of 8 px centred on it, so a press on the bar still moves it; the 4 px threshold stays (§7.8) · At 4 px/day the handle covered whole 1–2-day bars, so every move became a resize.
- 2026-10-30 · Drag is measured over the chart, not the screen: scrolling the pane during a drag (wheel, touchpad) keeps the ghost under the pointer. Within 24 px of the pane's left or right edge, or past it, the pane scrolls by itself (a step that grows with depth, up to 16 px a frame), only towards the side the pointer has moved to. Draggable bars set `touch-action: none` (§7.8) · A scroll mid-drag dropped the bar on the wrong date, and Day/Week zoom could only move a bar as far as the visible days; on touch the pan cancelled the drag.
- 2026-10-30 · The arrows' focus is the hovered bar only while its row is still shown, else the last selected task; leaving the chart clears the hover (§7.8) · Deleting or filtering out the task under a resting pointer left every arrow dimmed.
- 2026-10-30 · Jump to a task (Issues panel, successors) scrolls to the start of its mark as the mode draws it (§7.8) · In Plan mode it scrolled to the forecast start, days or weeks from the planned bar during execution.
- 2026-10-30 · Zoom keeps the date at the centre of the Gantt pane; from a view with nothing to scroll (Fit, a short plan) it goes to SD / project start, as on open and on a mode switch (§7.8) · Every zoom click sent the user back to SD or week 1.
- 2026-10-30 · When the range is narrower than the Gantt pane (Week/Month zoom, or Fit capped at Day scale), the timeline, grid lines, holiday columns, today line and row lanes go on to the pane's right edge, and a click there selects the row; the range still sets the Fit scale and the scroll on open (§7.8) · The chart looked cut off and ignored clicks right of its edge, on every Week/Month view and in Fit on an external monitor.
- 2026-10-30 · Esc hides the Gantt hover card until the pointer leaves that bar (§7.12 "close popover"; WCAG 1.4.13); the same press still closes an open drawer or panel. The card is placed by its measured size: below right of the pointer, wholly above it when there's no room below, always inside the window · The card could only be dismissed by moving the pointer, and a 2–3-line Thai name made the flipped card cover the hovered bar.
- 2026-10-30 · Splitter: a 13 px grab zone around the 5 px line, above the sticky headers; pointer capture while dragging, and pointercancel ends the drag; arrow keys still move it 24 px; the shortcuts overlay lists the divider (§7.3) · Touchpad users on 1280×720 resize the grid often and a 5 px target was fiddly.
- 2026-10-30 · Timeline chips (Status, Today) sit in the top tier, centred on their line and kept inside the chart, with a short line down through the bottom tier under the day numbers; a month name a chip would cover moves to the right of the chip, or is left out if the month has no room. When the Today chip would overlap the Status chip (today a few days from SD, more at smaller zooms) it sits beside it on its own side, and is left out only if there is no room there; its line still shows (§7.8) · In the bottom tier the Status chip hid the day numbers or week label around SD, was cut off at the left edge on day 1 of a turnaround, and covered the Today chip completely in the usual "update next morning" case.
- 2026-10-30 · The Gantt header corner (Color by, Critical) sits in the top (month) tier only, with 20 px controls and the "Critical" word kept, so it never covers day numbers, week labels, Monday ticks or holiday cells in any zoom; it can cover a month name that starts in the last ~115 px of the view. This replaces "narrow enough to sit over the room after the last date in Fit zoom" in the corner entry above (§7.6) · In Day zoom the 30 px corner hid the next 4–5 days (the look-ahead) at every scroll position.
- 2026-10-30 · Timeline month names are HTML labels under the SVG header that stick to the left edge of the Gantt pane while any of their month is in view; the next month pushes them off (§7.8) · In Day and Week zoom the default scroll (SD a quarter of the way in) usually left the visible days without a month name.
- 2026-10-30 · Scrolling the Gantt to SD, the project start or a task (on open, mode switch, zoom from Fit, Issues panel) puts it a quarter of the way into the pane but at least 130 px in, so the Status chip starts right of a month name stuck at the left edge (§7.8) · In a narrow Gantt pane (under ~430 px at Week zoom, e.g. a half-screen window) the default Track view opened with the month name hidden under the Status chip.
- 2026-10-30 · Gantt bar labels are drawn in their own layer above the status-date and today lines, with a halo in the lane colour; the lines stay above the bars so the progress fill can be read against the status date (main chart and report appendix) · The dashed line struck through the "100%" labels of tasks that had just finished.
- 2026-10-30 · Holiday columns show whenever a day is ≥ 4 px wide, not only in Day/Week zoom, and blend (multiply) with the row bands (§7.8) · Fit, the default zoom, drops below 10 px/day for plans over ~60 days on a 1280–1366 px laptop, which hid why a bar stretches across a holiday; an opaque holiday column broke the selected row's band.
- 2026-10-30 · With day detail (Day zoom, Fit at 20 px/day or more, report appendix) the timeline header and chart body draw a line at every day boundary; Monday lines use `--border-strong` so weeks still read (§7.8) · Bar edges fall on day boundaries, so start and finish days can be read off the grid.
- 2026-10-30 · Look-ahead window in days (3 / 7 / 14, default 7) instead of weeks; the workload heatmap has one column per day (SD+1 … min(SD+14, forecast finish), holidays hatched, explained in a note and not counted) when the forecast finish is at most 42 days after Project Start, otherwise one per week up to the forecast finish's week (at most 8); with nothing open after the status date it shows "No open tasks after the status date." instead of empty columns; a saved weeks value falls back to 7 days (per-browser setting, no data at risk) · Turnarounds last 2–4 weeks: a 2-week look-ahead listed almost every open task (177 of 187 on a 200-task plan), and the weekly heatmap showed empty weeks after the finish and hid the daily crew peaks contractor call-offs are planned around; a finished plan showed a blank column after the finish, and grey holiday columns looked like days with no work.
- 2026-10-30 · Report S-curve: Actual and Forecast are drawn over Planned (the legend keeps Planned · Actual · Forecast); the chart adds a 0 % point on the day before the first S-curve point (Actual 0 when that day is on or before the status date, else Forecast 0); a series with no values is left out; a status date outside the curve gets an arrowed label at that edge. The engine's S-curve data (§5.9) is unchanged · Chart.js draws the first dataset on top, so an on-plan Actual vanished under Planned; with end-of-day values the lines began at about 20 % in mid-air and didn't match "Last 7 days", which counts from 0; after the finish the status-date marker silently disappeared.
- 2026-10-30 · Report edge cases: when every task is Completed, key message 2 says "Finished on …" and the look-ahead message is left out; a plan with no tasks, or every section off, shows one note instead of the pages; the Print button is disabled and a browser print (Ctrl+P) prints the note · A close-out report must not say "Forecast finish"; Print produced a blank sheet, and the all-off choice is kept with the preferences.
- 2026-10-30 · Report page 3 order: Late tasks, Milestones, Look-ahead (was Late tasks, Look-ahead, Milestones) · The short milestone table stays on the section's first page next to the late tasks; only the open-ended look-ahead runs onto a following page, with its header repeated. A 3-row milestone table no longer sits alone on a mostly blank page before the Gantt appendix.
- 2026-10-30 · Report page 2: the planned-vs-actual chart is drawn as images of at most 20 assignees, so none is taller than a printed page; chart labels end with "…" after 22 characters (graphemes, so Thai marks don't count); heatmap names wrap to two lines, at most 160 px · With 30 assignees the chart was sliced across pages, and a long Thai company name pushed the heatmap past the page edge, which made Chrome shrink the whole printed report.
- 2026-10-30 · Workload heatmap: 3+ cells use full `--accent` with white numbers; 0 cells show the shade-0 background with no visible number (screen readers still read 0); header text (day numbers, month labels, holiday days) uses `--text-2`, never `--text-3` · WCAG AA (§10): white on the 75 % mix was 3.3:1, grey zeros 2.3:1 and `--text-3` labels 2.6:1; blank zeros make busy days easier to scan.
- 2026-10-30 · By-assignee Variance (pts) is coloured by the §5.8 bands: Ahead green, On track uncoloured, Slightly behind amber (`--risk-text`), Behind red · Any negative value was red, so a contractor at −0.5 pts was red while the project at −0.5 pts is On track.
- 2026-10-30 · Report tables (Late tasks, Milestones, Look-ahead) show dates as `d MMM yyyy` like the header and key messages; status and date cells don't wrap. The report's KPI row keeps the main strip's `dd MMM yy` because it reuses the same cards (§9.3) and the full year would push the variance chip onto a second line · §7.2; with long Thai task names "Not started" broke onto two lines and made the look-ahead about 70 % taller.
- 2026-10-30 · Gantt appendix: a one-line legend under the chart on every page (20 px; still 25 rows per A4 page: timeline 45 + rows 650 + legend 20 = 715 of the 718 printable px, with the chart drawn as a block so no inline gap follows it), and at least 100 px kept after the last bar for its label (the scale shrinks only when the 5-day tail is narrower, so short plans keep their full-width scale) · Readers of the printed report have no tooltips; long plans clipped the last milestone's "· +Nd" at the page edge.
- 2026-10-30 · Toasts and the drop overlay never print (`@media print`) · Chrome repeats fixed boxes on every printed page; a "Task deleted · Undo" toast printed on every page of the PDF.
- 2026-10-30 · Browser tab title = the project name ("• " prefix while unsaved; "Gantt Planner" with no plan); in the report view "{project} - Progress report {status date YYYY-MM-DD}", so Chrome/Edge "Save as PDF" suggest a dated, project-specific file name and PDF title; characters not allowed in Windows file names become "-"; the name is cut at 80 characters between graphemes, so a Thai vowel or tone mark is never dropped · Every PDF was offered as "Gantt Planner.pdf", so weekly reports overwrote each other or had to be renamed by hand.
- 2026-10-31 · Merge of the audit lanes' SPEC edits: §7.12 now matches the shortcuts overlay (`HelpDialogs.tsx`) and the window shortcuts (`windowEvents.ts`) — Esc also closes the Issues panel and menus and leaves the report, and the other shortcuts don't run over a dialog, in a field or in the report; editor-only keys (Alt+Enter / Shift+Enter in Remarks) stay in §7.7 because the overlay doesn't list them. §7.13 lists what `prefs.ts` stores · The spec is the source of truth and must describe what the app does.
- 2026-10-31 · Visual refresh "Calm, clear, mode-aware" (audit #56, #130–#134, #136, #139, #148): `--text-3` #57657A (AA on every surface) with new `--text-placeholder` #6B7789 and `--text-disabled` #94A3B8; `--idle` #64748B, `--baseline` #707F95, `--arrow` #77849A, `--done` #15803D so every mark is ≥ 3:1 on white, hover, selected and holiday lanes (`--nonwork` unchanged); new tokens `--surface-3`, `--field-edge`, `--selected`, `--accent-text/-active/-softer`, `--focus`, `--plan*`, `--head-bg`, radii, shadows xs/3, type, control and motion tokens; header fixed at 60 px; ghost tool buttons; KPI pills with bottom-aligned bars and captions on Tasks (milestones) and Time (working days left); neutral assignee tags with a square swatch (Assigned stays 116 px; 6 px cell padding); white unfinished part, In progress pill and New tag on a selected row; status-date line kept `--accent` with a white halo; hollow Not-started milestone; critical ring 2 px clear of the bar; start screen with lockup, picture, described tiles and a Reopen row; underline tabs in the Issues panel; report Planned `#707F95`, Completed `#15803D`, print rules in `--border-strong` · Owner asked for a UI that is "beautiful, easy to use and inviting"; the faint `--text-3`, baseline, idle and arrow colours failed WCAG AA (§10); Plan mode, which changes the baseline, looked like Track, so §7.1 now allows one violet Plan-mode tint in the chrome. Rejected: dark app bar, teal/ink status-date line (judge on #130: keep `--accent`), denser default rows, hatched slip (→ §16), dot status pills (do not fit the Status column).
- 2026-10-31 · Shared-control details of the visual refresh: the field skin is zero-specificity (`:where()`), and so is the base reset of `button, input, select, textarea` (`font`/`color: inherit`), so the skin's colour wins by load order and any area rule wins over both; checkbox rows in popovers are 26 px (not 28) and a popover taller than the room below its button scrolls inside, so the 16-row Columns panel still fits a 1280×720 window; empty date inputs (`data-empty`) show their mask in `--text-placeholder` from one shared rule; date separators get no extra padding (it read as "30 - Sep - 2026") · Keeps the 28/30 px pitch from pushing popovers off a laptop screen and keeps one source of truth for field and empty-date colours.
- 2026-10-31 · Shell details of the visual refresh: the collapsed KPI strip uses 20 px / 11 px pills and gives each value a 20 px line, so the one-line strip is 37 px in both Plan and Track (a 22 px pill made Track 3 px taller than Plan); the Time caption is singular at 1 ("1 working day left"); a filtered Filter button darkens to `--accent-soft` on hover and while its panel is open; the rename hover on the project name is a 4 px `--surface-2` halo (the heading no longer clips its overflow, the name button ellipsises itself) · Collapsing or switching modes must not move the toolbar by different amounts; the halo was cut off by the heading's clip; one tint for "filter on" whatever the pointer does.
- 2026-10-31 · Header rows (visual QA round 1): all header controls share one top row (y 4–36: Mode switch, status date, Issues badge centred on it, Open, Save, Report, More) and the captions form a second row (y 38–54) with the file chip; the name sits on the first row. The rename field keeps the name's line (−3 px margins), so the file chip doesn't move · The "Today is" hint pushed the date row 8 px above Open/Save/Report, and the Mode switch (centred with its caption) sat 9 px above them too: two baselines for the most-used controls.
- 2026-10-31 · Status filter chips state their split when milestones match (visual QA round 1): "Late · 3 tasks, 1 milestone", counted over the rows all filters match, regular weight in the chip's colour (`--progress-text` on `--accent-soft`, 5.49:1); the "N late" KPI and the Late filter keep their meaning (tasks only / late milestones included) · Pressing "3 late" showed 4 rows with nothing saying why; a tasks-only Late filter would hide late milestones, which the planner needs to see.
- 2026-10-31 · Grid visuals (final visual spec §5; audit #56, #130, #131, #148): header band `--head-bg` (violet wash in Plan mode) with a `--border-strong` rule, and a `--border-strong` freeze line right of the Task column in header and body; selected row `--selected`, with the In progress pill and the New tag on white; a hairline box on hover over cells that can be typed in (those with `aria-readonly="false"`); ID 12px `--text-3`, tabular figures in number and date columns; mode-locked cells grey (`--text-2`) like calculated ones; neutral assignee tags (white, `--border`, 8 px square swatch, padding 4 / 5 px) in a 116 px Assigned column whose cell padding is 6 px a side (two-tag text budget 54 px: ACME + NDT fit); status pills 20 px with a faint ring in their own colour; 4 px progress mini bars on `--surface-3` with the % right-aligned at a fixed width; progress steps with the segmented (Zoom) look in the grid popover and the drawer; the number box and the assignee editor use the shared field skin (assignee editor 32 px) · The amber, orange and pink tag tints read as warnings (§7.1 principle 1); `--text-3` IDs were 2.56:1. The design draft widened Assigned to 124 px, but that pushes Track's default columns to 872 px: past the 60 % grid share at 1440 px (864, Status cut) and past 768 px through Variance at 1280 (§7.3). The same two-tag capacity comes from 1 px less tag padding a side and 6 px cell padding, so the column widths, the Task minimum (200 px) and the §7.3 fit stay as they are.
- 2026-10-31 · Grid header row height = timeline header height including its 1 px rule (`calc(--timeline-h + 1px)` = 45 px; TIMELINE_HEIGHT stays 44 for the SVG); cells scroll into view and popovers count as visible below that same 45 px · The grid header box includes its border while the timeline's 44 px SVG has the rule below it, so rows and Gantt lanes were 1 px out of step across the splitter, made more visible by the darker header rule.
- 2026-10-31 · The Progress popover's cell keeps showing its mini bar and percent (the draft value as typed, the saved value while the text is blank or not a percent; the status colour stays the computed one until saved) · The anchor cell went blank — an empty ringed box in the selected row — which read as broken.
- 2026-10-31 · A file opened or a plan created (session + 1) resets the grid: the Grid is keyed by the session, so its active cell and cell editor start empty, and the grid and Gantt panes go back to the first row (the grid to its first column too); the Gantt's horizontal scroll to SD / project start on load is unchanged (§7.7, §7.8) · The main view stays mounted from file to file, so the previous file's scroll and the Grid's local active cell survived the store reset: after opening messy.xlsx the view started at row #26 with rows 1–7 hidden, and a stray active-cell box sat on row 20, where Enter, Delete or F2 would have acted on a cell the user never chose in that file.
- 2026-10-31 · Gantt details of the visual refresh: the Track bar's outlined part keeps rx 3.5 (its 1 px stroke is inset 0.5 px, so its outer edge has the same 4 px corners as the done part, rx 4); the critical ring's centre line runs 3 px outside the bar (rx + 3) so the 2 px ring stands 2 px clear, and in Track mode its outer edge now meets the top of the baseline (geometry of bars and baseline unchanged, §11.3 of the design spec); the status-date halo is drawn in the chart only (the timeline and the report appendix keep a single `.sd-line`); the bar-label groups carry `data-row` and the row-hover rule (`rowHoverCss`) also sets their halo to `--surface-2`, so a hovered row shows no white patch behind its labels · A white halo on the grey hover band looked like a rendering glitch next to every label; concentric corners keep the outlined and done parts flush; the 2 px band of lane colour separates the red ring from warm assignee colours (orange vs red is 1.36:1 when touching).
- 2026-10-31 · Gantt timeline after visual QA: the Status and Today chips keep clear of the last 126 px of the chart (the Color by / Critical corner, 114 px + its 12 px fade), at every zoom, since the corner sits over the chart's end whenever it is scrolled there (always at Fit); a Today chip that had to move off its line reads "Today · 31 Oct"; the today line and chip are left out when the middle of today falls past the chart's right edge (the filled scale can run a day past it); with week labels or Monday ticks a holiday is a 4 px strip at the foot of the timeline (tooltip on the whole cell), in Day detail the day number on a holiday takes `--nonwork` as its halo; label halos widened from 3 px to 5 px (bar labels) and 6 px (timeline labels) · At Fit the Today chip was hidden under the corner, so today and the status date looked alike (filled Status chip vs outlined Today chip); moved left of its line, a plain "Today" sat over the previous week's label and read as that date; at 1440 px the chip showed with no line; grey holiday boxes cut violet patches out of the Plan-mode band around week labels; with 3–4 px halos the dashed status line left stubs in the word gaps ("W40 ·¦28 Sep", "28¦Sep") at 1x, measured in Chrome at 1280 and 1440 px.
- 2026-10-31 · Panels look (visual refresh, final spec §7): the drawer title is a 16 px heading with no box until hovered (field box: `--border-strong` with a `--field-edge` bottom edge, as every field) or focused (accent border + focus ring); section headings are 11 px overlines; Plan mode's "Actual and forecast" fold has a CSS chevron that turns; the predecessor remove × is a 24 px ghost that turns red on hover; picker rows are 30 px, highlighted in `--selected`, and long names end in an ellipsis. Dialogs: `--shadow-3`, 24 px padding, body at `--lh-prose`, keycaps with a 2 px bottom edge in the shortcuts overlay, "Mouse" as an overline. What is typed into a dialog field is regular weight (the 12 px label above it is medium). Toast: 44 px tall with or without an action (8 px block padding, so Undo/Review with its 4 px hover pad fits), `--lh-ui` line height because a message can wrap and name a Thai task, and the same 16 px padding at both ends when it has no action · Owner asked for a UI that is "beautiful, easy to use and inviting"; the spec's 10 px toast padding made toasts with and without an action differ in height.
- 2026-10-31 · Drawer Forecast line shows the variance only when it is not 0, as ` · +Nd` / ` · −Nd`; on time it ends at the finish date. The delete confirm is titled "Delete task?" for one task and "Delete N tasks?" for several · Visual QA: an on-time task's Forecast line ended in a bare "—" that read as a stray character, and the title "Delete tasks?" disagreed with a body about "this task".
- 2026-10-31 · Start screen, error screen and overlays, as built (visual refresh, audit #134, #133): the start page is one full-width grid column and the dashed drop zone is sized to the card (760 px + its 20 px padding + the dashes), so the zone hugs the card; the error card is a fixed 520 px. The start picture's 1 px ring is a box-shadow, so its 300 × 132 viewBox draws 1:1. The headline balances its two lines and tile descriptions avoid a one-word last line (`text-wrap`). Tiles stack below 720 px wide (they still fit three across at 760 px); the hints row wraps. The drop overlay sits above sheets, menus and the opening scrim (z-index 39) and below toasts (40). The "Opening {file}…" card stays on one line and ellipsises a long name. The Issues panel's Notes chevron lines up with the cards' left edge · Without a definite width the card's `min(760px, 100%)` resolved against the zone's own content, so the zone grew to ~960 px around a 760 px card; a bordered SVG scales its picture; Thai file names can be long; before, the Issues sheet, open menus and the sticky grid header painted over the drop overlay.
- 2026-10-31 · Start tiles (visual QA round 1): at rest, the primary tile ("Open Excel plan") has a light accent border, `color-mix(in srgb, var(--accent) 45%, var(--surface))` (≈ #9DB9F6, 1.96:1 on the surface; decorative, because the tile is identified by its label). Only a hovered tile gets the full `--accent` border plus `--shadow-1`. The filled accent icon square (the white icon on --accent is 5.17:1) still marks the primary tile · Before, the primary tile at rest and a hovered tile both had the full accent border, so hovering "New plan" made two tiles look selected, and "Open Excel plan" looked hovered or focused while at rest.
- 2026-10-31 · Report visuals (visual refresh, audit #56 / #148): REPORT_PALETTE Planned `#707F95` (was `#94A3B8`, 2.56:1 → 4.07:1) and Completed `#15803D` (was `#16A34A`), new `separator` `#FFFFFF` for 2 px gaps between donut slices; sheets get a hairline ring + `--shadow-1` and radius `--radius-sm` on screen (a box-shadow ring, so the 297 mm sheet and 10 mm padding are unchanged), the KPI box `--radius-lg`; print rules (tables, KPI box) in `--border-strong`; table numbers tabular (no width change in the sample: still 4 pages); the appendix gets the app's status-date halo, its label header `--head-bg` with a `--border-strong` rule like the timeline beside it, and the legend's milestone is drawn in a 14 px box so the hollow Not-started outline isn't clipped; Thai line boxes 1.5 (`--lh-ui`) for key messages (was 1.45), `.heat-name` and `.appendix-name` (the 26 px row height is unchanged); heatmap cell radius `--radius-xs` (was a literal 3 px) and the 3+ cell's white numbers use `--text-inverse` (same value) · Light greys dropped out on paper (Planned line 2.56:1, baseline 1.48:1) and table rules disappeared on office laser printers; Thai names with stacked tone marks (ปั๊ม, ผู้) need a 1.5 line box where a box clips or lines stack (SPEC §7, final visual spec §3.7). Table paddings, font sizes and line-heights were left alone because page-3 and appendix pagination depend on them (2026-10-30).
- 2026-10-31 · Report page 1: the KPI cards always put the state pill under the value (`.report-kpis .kpi-value` is a column with a 4 px gap, in `KpiStrip.css`; the main strip is unchanged and keeps the pill beside the value where it fits) · The report cards have ≈177 px of content, so "Slightly behind" and "3 late" wrapped under their values while "+2d" stayed beside the Finish date, and "7/22 done 3 late" wrapped by 1 px; the cards no longer read as one anatomy (#132). The tallest card was already two lines, so page 1 is no taller: the sample still prints on 4 A4 pages with page 1 on one sheet. The Finish value keeps the `dd MMM yy` format of the 2026-10-30 entry because the cards are shared with the main strip and the full year would not fit a report card.
- 2026-10-31 · Merge of the visual-refresh SPEC edits, checked against the CSS/TSX: the §7.2 block is `tokens.css` from `:root` on (with the `.main.mode-plan` scope rule; the file's two-line header comment left out); sizes stated as built where the drafts were narrower (Issues badge and filter chips 24 px, counts 16–18 px, the project-name rename field 28 px); mode-locked grid cells show a not-allowed cursor (§7.7 said "lock cursor"); the on-screen page band is not printed (the header and footer come from `@page` margin boxes, §9.2), so in print only tables and the KPI box take `--border-strong`; §7.5 "No tasks" says which cards keep their value when the plan has milestones · SPEC is the source of truth and must say what the code does.
- 2026-11-02 · Major tasks (owner request) are MS Project summary rows: a `Level` column (1–8, after ID in the template) and a positional outline — a row with deeper rows under it is a major task · The owner chose header rows in Excel over a group-name column: the Tasks sheet reads like their old Vertex42 schedule, any depth works (their Refractory and Insulation › Arch Panel), and Excel's own +/− collapses the groups. A file without the column gets it only once a row is below Level 1, so flat plans don't change.
- 2026-11-02 · A major task is calculated only: no links, no dates or progress of its own; links to it or from it are refused (`E_SUMMARY_LINK`, `W_SUMMARY_PREDS`, text kept) · The simplest consistent rule; summary links need FS/SS against a whole group (§16).
- 2026-11-02 · Roll-up: dates are the earliest/latest of its leaf tasks, progress the mean of its non-milestone leaf tasks (the KPI's weighting, §5.8), status by §5.7 on its own dates · A group at 40% then means what the KPI's 40% means, and a group is Late exactly when its finish slips.
- 2026-11-02 · Save shows the outline in Excel (bold major tasks, names indented by Level, row grouping with summary rows above) only while the plan has major tasks; the app then owns the Task column's bold and indent and the row grouping · Readable in Excel and collapsible there with +/−; flat plans keep the user's own formatting and grouping.
- 2026-11-02 · Blank Level in a file with Levels takes the row below's Level (the last row: the row above) · A row inserted in Excel just under a major task, or between its tasks, then joins that group, which is what inserting there means.
- 2026-11-02 · Indent turning the row above into a major task keeps that task's own values in the plan (not used while it is a major task), so Outdent or Undo brings them back; Save writes the roll-up into its row · Reversible in the session; in the file the row is a major task.
- 2026-11-02 · Outdent and Indent are positional, as in MS Project: outdenting a row makes its following siblings its tasks · The outline is the row order plus Levels; moving rows to keep groups apart would reorder the user's plan behind their back.
- 2026-11-02 · Collapse is the view's: not saved in the file, everything expanded on open · The file holds data; Excel's own +/− is the file's collapse.
- 2026-11-02 · Drag to reorder (owner request): press and hold a row 0.4 s, or drag the grip left of the ID; the pointer's left–right position picks the Level among those the place allows; off while searching or filtering · Holding keeps click, double-click and Shift/Ctrl selection as they were; picking the Level while dragging is how outliners move a row into or out of a group; hidden rows would make "where" ambiguous.
- 2026-11-02 · Alt+↑ / Alt+↓ move a row among the tasks of its major task only · Leaving a group is a structural choice: dragging (with its Level) or Outdent make it explicit.
- 2026-11-02 · Deleting a major task deletes its tasks and always confirms with their count · As in MS Project; keeping them would silently re-parent them under the row above.
- 2026-11-02 · Weekends marked (owner request): Saturday/Sunday day numbers in `--weekend-text` on `--weekend` in the timeline, and a `--weekend-col` column tint whenever a day is at least 12 px wide · They are working days in the 7-day calendar (§2), so the mark is lighter than a holiday's grey, in an indigo hue apart from it, from the selection blue and from Plan mode's violet.
- 2026-11-02 · Print Gantt (owner request): a print view, like the report, of the grid and Gantt as the main view shows them — mode, Color by, critical path, rows shown (search, filters, collapsed groups) and visible columns — printed with the browser's "Save as PDF" · The owner sends the plan out before work starts exactly as they set it up on screen; the report's print path is proven offline and needs no PDF library.
- 2026-11-02 · The printed timeline always fits the chart's width on the paper; the zoom is not printed · A chart wider than the paper needs pages across, which are hard to read and to send; the zoom is about the screen.
- 2026-11-02 · The printed timeline spans the printed rows (Plan mode: their planned dates, without the status date); no today line in print · Plan mode draws no status date, so it would only add empty days before the plan; a filtered print (one contractor's work) gets the room of the page; "today" is stale once printed.
- 2026-11-02 · The printed table leaves the chart at least 380 px; columns that don't fit are left out from the right and named in the view · Below that the bars stop being readable, and 380 px is what Track mode's default columns leave on A4; the user can hide columns or choose A3, and nothing is dropped silently.
- 2026-11-02 · Ctrl+P in the main view opens Print Gantt · The browser's print of the main view is a clipped screen; as in MS Project, printing this view means printing the Gantt.
- 2026-11-02 · Arrows between rows on different printed pages run to the page edge · As MS Project prints them; repeating rows or adding connectors is more than a plan handout needs.
- 2026-11-02 · Toolbar labels give way to icons below 1100 px in Track mode (Delete, Filter, Columns) and below 1240 px in Plan mode (also Link and Unlink); was: Link, Unlink and Delete in Plan mode below 1100 px · The Outdent, Indent and Outline buttons made the toolbar wider than the window: by 55 px at 960 px in Track mode, and in Plan mode, which needs 1182 px with every label, up to 82 px from 1100 px on, so the page scrolled sideways.
- 2026-11-04 · Sample and test data made up for the public repository: the project "PM (3Y) F-101", owner "Sunisa R.", contractors ACME, Refracto, ThermCo, ScaffCo, VesselCo and ValveCo, teams NDT, Inst and QC, equipment tags TE-101, AT-102, PSV-101/102/103 and D-101; task names, dates, durations, links, progress and holidays unchanged, so every figure in the tests and in this spec stays · The owner is making the repository public, and the sample had come from their real schedule (2026-10-30). Names keep their length where tests measure chip widths.
- 2026-11-04 · The app is also published on GitHub Pages from `main`, after the type check and the tests pass · The owner wants to open it from the web without copying the file; it is the same single file with no network requests (§3.1), so a plan never leaves the user's computer.
- 2026-11-04 · The public repository's history starts again from one clean commit · The earlier commit held the real names, and a public repository shows its whole history.
