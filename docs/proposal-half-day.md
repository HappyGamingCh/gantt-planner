# Proposal: half-day durations (0.5d)

Status: **approved by the owner and built (2026-11-20).** The rules now live in SPEC.md (§2, §4.3, §4.6–§4.8, §5.1–§5.12, §7.7–§7.9, §8, §11.1) and its decisions in §17. Where the build differs from this draft, SPEC.md wins; the differences are listed at the end.

## Goal
Planned Duration and link lags in steps of half a working day — 0.5, 1, 1.5, … — so that two short jobs can share one day: *Isolate blind* 0.5d → *Air ventilation* 0.5d both happen on Monday, one in the morning and one in the afternoon. A plan of whole days must calculate exactly as it does today.

## Model
- A working day has two halves, **morning** and **afternoon**. The engine counts in half days internally; dates stay whole ISO dates, and the planned and forecast start and finish of a task also say which half: a task **starts** in the morning or the afternoon, and **finishes** at midday or at the end of the day.
- Durations and lags are multiples of 0.5. Milestones stay 0.
- Links work as today, in half days: a task after a predecessor that finishes at midday starts that afternoon (`gap` of §5.4 = the next half day instead of the next day). `3+0.5` starts half a day later; `5SS+1.5` a day and a half after 5 starts.
- Root tasks start in the morning of their Planned Start; to start one in the afternoon, give it a link with a half-day lag, or type the start as described under Excel.
- The working days of the week and the holidays are whole days off, as now.

## Excel
- **Planned Duration**: numbers such as `0.5` or `1.5`. Another decimal is rounded to the nearest half day (`corrected`, "Rounded to half a day"); today it is rounded to a whole day.
- **Lags** in Predecessors: `3+0.5`, `5SS-1.5`, `3FS+0.5d`.
- **Afternoon start / midday finish**: written as the date with the time **12:00**; the cell keeps its date format, so Excel shows only the date. When read, a Planned Start of exactly 12:00 means the afternoon; any other time (a 19:00 night-shift start, MS Project's 08:00) keeps today's meaning, the morning. Planned Finish and the forecast dates are written the same way. This keeps a Track-mode baseline exact when the file is opened again.
- **Validation**: the template's Planned Duration rule becomes "decimal ≥ 0" ("Enter working days, in steps of 0.5 (0 = milestone)"). Older files have the template's whole-number rule, which makes Excel refuse `0.5`: Save would replace that rule only when it is exactly the one the template wrote, never a rule the user made.

## Track mode
- **Actual Start and Actual Finish stay whole days** (progress is reported per day). Actual Duration counts days.
- Variance of a completed task compares days: a 0.5d job finished on its planned day is on time, not "+0.5d". A task not completed can show halves (`+0.5d`) when its forecast moves by half a day.
- Remaining work of a task in progress: `PD × (100 − Progress) %`, rounded up to the next half day (today: the next day), from the morning after the status date.

## Display
- Durations `0.5d`, `1.5d` in the grid, the drawer, Print Gantt and the report; Variance `+0.5d`.
- Dates stay `dd MMM yy`; the drawer and the bar's tooltip add "afternoon" to a start in the afternoon and "midday" to a finish at midday.
- Gantt bars start or end in the middle of the day column (Day zoom: 16 px per half day; Month zoom: 2 px).
- Dragging a bar snaps to half days at Day zoom, and to whole days at Week and Month zoom.

## S-curve and progress
Planned % counts half days: a 0.5d task done on its day reaches 100 % at the end of that day. Every task still weighs the same (§5.8).

## Not included
Hours, shifts, two shifts a day, actual times of day.

## Size and risk
The largest change since the major tasks: the calendar gets half-day arithmetic, then the schedule, forecast, critical path, S-curve and roll-ups use it; the UI's duration editors, Gantt geometry, drag, Print Gantt and report change; the Excel reader and writer learn the 12:00 rule, rounding and the validation update. Safety net: every existing test (whole days) must pass unchanged, plus new half-day tests for each rule above.

## For the owner to decide
1. An afternoon start stored as a hidden 12:00 time in Planned Start (only exactly 12:00 counts) — OK?
2. Save updates the template's own whole-number rule on Planned Duration so Excel accepts 0.5 — OK?
3. Actual dates stay whole days, and a completed task's variance is counted in days — OK?
4. Dragging snaps to half days only at Day zoom — OK?

The owner agreed to all four on 2026-11-20.

## Built differently from this draft
- **Remaining work** rounds up to a whole day for a task whose duration is whole days, as before, and to half a day only for a task with a half in its duration. Rounding every task to half days would have moved the forecasts and variances of existing whole-day plans, which must calculate exactly as before.
- **Milestones** keep the whole-day rules exactly (a milestone after an SS link still sits at the end of its day); one after a task that finishes at midday sits at midday.
- **Lags** that aren't a whole number of half days (`3+0.3`) are invalid notation, kept as typed; only Planned Duration is rounded.
- **Drag** snaps to half days whenever the timeline shows single days: Day zoom, and Fit at 20 px a day or more.
- A whole-day plan was checked against the previous engine on 19,000 random plans (Plan and Track mode, milestones, SS links, leads, holidays, working weeks, major tasks): every number the same.
