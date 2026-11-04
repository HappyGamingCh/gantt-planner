// Text of the template's "Read Me" sheet (SPEC §4.6).
export const README_TITLE = 'Gantt Planner — read me';

export const README_LINES = [
  '1. This file is the data for Gantt Planner. Open gantt-planner.html and click Open to use it.',
  '2. You may edit dark-header columns in Excel. Grey-header columns are calculated and will be overwritten.',
  '3. Predecessors notation: 3 (finish-to-start), 3SS (start-to-start), 3+2 or 3FS+2 (2-day lag), 3SS-1 (1-day lead). Separate with a comma and a space (3, 120).',
  '4. Tasks with predecessors get their Planned Start calculated. To delay a task, add lag (e.g. 3+5).',
  '5. Planned Duration wins over Planned Finish when they disagree.',
  "6. Gantt Planner can't keep charts, pivot tables, text boxes, shapes, sparklines or Excel tables anywhere in this file: saving removes them (a table's cells stay, as a normal range). Please don't add images, formulas or merged cells to the Tasks sheet.",
  '7. Close this file in Excel before saving from Gantt Planner. Use OneDrive version history to restore older versions.',
  '8. Assigned: separate several names with commas. Every day is a working day except the dates in the Holidays sheet.',
  "9. Named ranges must be a fixed range, such as Resources!$A$2:$A$200; saving removes or changes other names. For a drop-down list fed from another sheet, name its range and use =ThatName as the list's source.",
  "10. Major tasks: Level sets a row's place in the outline (1 = top). The rows under a row with a deeper Level are its tasks, as indenting in MS Project. A major task's dates, duration and progress are calculated: only its Task, Level and Remarks are yours to edit.",
];

export const HOLIDAYS_NOTE = 'Add non-working days here (e.g. public holidays). Every other day, weekends included, is a working day.';
