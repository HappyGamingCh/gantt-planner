// Reading the Project, Resources and Holidays sheets (SPEC §4.2, §4.4, §4.5, §4.7). Never throws on cell content.
import { makeIssue } from '../engine/issues';
import { parsePredecessors } from '../engine/links';
import type { Change, Holiday, ISODate, Issue, Project, Resource, Task } from '../engine/types';
import { cellText, cleanName, formulaText, parseDate } from './cells';
import type { CellValue, Row, Worksheet } from './exceljs';
import { BUDDHIST_ERA } from './readMessages';
import { HOLIDAY_HEADERS, PROJECT_FIELDS, RESOURCE_HEADERS, headerColumns, headerKey, resourcesWithoutName, type ProjectField } from './schema';

export function readProject(ws: Worksheet | undefined, tasks: readonly Task[], today: ISODate, date1904: boolean, changes: Change[]): Project {
  const raw = new Map<ProjectField, CellValue>();
  for (let r = 1; ws && r <= ws.rowCount; r++) {
    const row = ws.findRow(r);
    const key = headerKey(cellText(row?.findCell(1)?.value));
    const field = PROJECT_FIELDS.find((f) => headerKey(f) === key);
    if (row && field && !raw.has(field)) raw.set(field, row.findCell(2)?.value ?? null);
  }
  const value = (field: ProjectField) => raw.get(field) ?? null;
  const change = (field: ProjectField, from: unknown, to: unknown, kind: Change['kind'], reason: string) =>
    changes.push({ field, from, to, kind, reason });

  const nameText = cellText(value('Project Name'));
  let name = cleanName(nameText);
  if (name === '') {
    name = 'Untitled project';
    change('Project Name', undefined, name, 'filled', 'No project name');
  } else if (name !== nameText) {
    change('Project Name', nameText, name, 'corrected', 'Spaces tidied');
  }

  const dateField = (field: 'Project Start' | 'Status Date', fallback: ISODate, reason: string) => {
    // =TODAY() / =NOW(): Excel shows today, so the app does too; Save writes it as a date (§4.7).
    const formula = formulaText(value(field));
    if (/^=\s*(TODAY|NOW)\s*\(\s*\)\s*$/i.test(formula)) {
      change(field, formula, today, 'corrected', "Formula: today's date is used, and Save writes it as a date");
      return today;
    }
    const p = parseDate(value(field), date1904);
    if (p.value !== undefined) {
      if (p.buddhist) change(field, cellText(value(field)).trim(), p.value, 'corrected', BUDDHIST_ERA);
      return p.value;
    }
    if (p.bad) change(field, cellText(value(field)).trim(), fallback, 'corrected', `Not a date — ${reason.toLowerCase()}`);
    else change(field, undefined, fallback, 'filled', reason);
    return fallback;
  };
  const rootStart = earliestRootStart(tasks);
  const projectStart = dateField('Project Start', rootStart ?? today, rootStart ? 'Earliest start of the first tasks' : 'Today');
  const statusDate = dateField('Status Date', today, 'Today');

  const modeText = cellText(value('Mode')).trim();
  const mode = modeText.toLowerCase() === 'track' ? 'Track' : 'Plan';
  if (modeText === '') change('Mode', undefined, mode, 'filled', 'New plans start in Plan mode');
  else if (modeText.toLowerCase() !== mode.toLowerCase()) change('Mode', modeText, mode, 'corrected', 'Mode is Plan or Track');

  const project: Project = { name, owner: cleanName(cellText(value('Owner'))), projectStart, statusDate, mode };
  // Any other formula: its last value is used and Save writes that value (§4.8), so the formula goes. Say so (§5.3).
  const values: [ProjectField, string][] = [
    ['Project Name', project.name],
    ['Owner', project.owner],
    ['Project Start', projectStart],
    ['Status Date', statusDate],
    ['Mode', mode],
  ];
  for (const [field, to] of values) {
    const formula = formulaText(value(field));
    if (formula !== '' && !changes.some((c) => c.taskId === undefined && c.field === field)) {
      change(field, formula, to, 'corrected', 'Formula: Save writes its value');
    }
  }
  return project;
}

/** Earliest Planned Start of tasks without valid predecessors (§4.2). */
function earliestRootStart(tasks: readonly Task[]): ISODate | undefined {
  const ids = new Set(tasks.map((t) => t.id));
  let earliest: ISODate | undefined;
  for (const task of tasks) {
    const linked = parsePredecessors(task.predecessorsText).some((t) => t.link && t.link.predId !== task.id && ids.has(t.link.predId));
    if (!linked && task.plannedStart !== undefined && (earliest === undefined || task.plannedStart < earliest)) earliest = task.plannedStart;
  }
  return earliest;
}

export function readResources(ws: Worksheet | undefined, issues: Issue[]): Resource[] {
  const cols = ws ? headerColumns(ws, RESOURCE_HEADERS) : new Map<string, number>();
  const nameCol = cols.get('Name');
  if (!ws) return [];
  if (nameCol === undefined) {
    // A renamed header: the names, types and colours there aren't read, so say so (§4.4) unless the sheet is empty.
    if (resourcesWithoutName(ws)) issues.push(makeIssue('W_RESOURCES_NO_HEADER'));
    return [];
  }
  const text = (row: Row, header: string) => {
    const c = cols.get(header);
    return c === undefined ? '' : cellText(row.findCell(c)?.value).trim();
  };
  const seen = new Set<string>();
  const resources: Resource[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.findRow(r);
    const name = row ? cleanName(cellText(row.findCell(nameCol)?.value)) : '';
    if (!row || name === '' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const resource: Resource = { name };
    const type = (['Person', 'Team', 'Contractor'] as const).find((t) => t.toLowerCase() === text(row, 'Type').toLowerCase());
    if (type) resource.type = type;
    const color = text(row, 'Color');
    if (/^#[0-9a-f]{6}$/i.test(color)) resource.color = color.toUpperCase();
    resources.push(resource);
  }
  return resources;
}

export function readHolidays(ws: Worksheet | undefined, date1904: boolean, issues: Issue[]): Holiday[] {
  const cols = ws ? headerColumns(ws, HOLIDAY_HEADERS) : new Map<string, number>();
  const dateCol = cols.get('Date');
  const descriptionCol = cols.get('Description');
  if (!ws) return [];
  if (dateCol === undefined) {
    // A renamed header or a title row above it: those days would silently count as working days (§4.5).
    let n = 0;
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (parseDate(cell.value, date1904).value !== undefined) n++;
      }),
    );
    if (n > 0) issues.push(makeIssue('W_HOLIDAYS_NO_HEADER', { n }));
    return [];
  }
  const holidays: Holiday[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.findRow(r);
    const value = row?.findCell(dateCol)?.value ?? null;
    // A Buddhist-era year is read silently: the sheet is never written, so a Change would mark every open unsaved.
    const p = parseDate(value, date1904);
    if (p.bad) issues.push(makeIssue('W_BAD_HOLIDAY', { n: r, text: cellText(value).trim() }));
    if (row && p.value !== undefined) {
      const description = descriptionCol === undefined ? '' : cellText(row.findCell(descriptionCol)?.value).trim();
      holidays.push({ date: p.value, description });
    }
  }
  return holidays;
}
