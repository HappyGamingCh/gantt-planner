// Print Gantt (SPEC §9.4): full screen, route #print. The grid and the Gantt as the main view shows them — mode,
// Color by, critical path, the rows shown and the visible columns — on A4 or A3 landscape pages, printed with the
// browser's "Save as PDF". Back, Options (paper, Prepared by), Print / Save as PDF.
import { ArrowLeft, Printer, SlidersHorizontal } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Paper } from '../../config';
import { createCalendar } from '../../engine/calendar';
import type { ComputeResult, Plan } from '../../engine/types';
import { assigneeInfo, isFiltering, rowsOf, shownRows } from '../../store/selectors';
import { closeView, setPrintPaper, useStore } from '../../store/store';
import { formatDateLong } from '../common/format';
import { Popover } from '../common/Popover';
import { Segmented } from '../common/Segmented';
import { useFontsReady } from '../common/useFontsReady';
import { rowDates } from '../gantt/Gantt';
import { fittedScale, ganttRange, showsHolidays } from '../gantt/scale';
import { Page, PrintChrome } from '../report/ReportPage';
import { legendAssignees, paginate, PAPER, printColumns, rowsPerPage } from './printLayout';
import { PrintLegend, type LegendProps } from './PrintLegend';
import { PrintSheet } from './PrintSheet';
import '../report/Report.css';
import './GanttPrint.css';

const PAPERS: readonly { value: Paper; label: string }[] = [
  { value: 'A4', label: 'A4 landscape' },
  { value: 'A3', label: 'A3 landscape' },
];

/** Room kept right of the last bar for its label: assignee names (Plan), "62% · +3d" (Track). */
const LABEL_ROOM = { Plan: 140, Track: 100 } as const;

export function GanttPrint() {
  const plan = useStore((s) => s.plan);
  const result = useStore((s) => s.result);
  const fileName = useStore((s) => s.file?.name ?? '');
  const session = useStore((s) => s.session);
  if (!plan || !result) return null;
  // Keyed by session: another plan starts over ("Prepared by" = its own Owner).
  return <PrintView key={session} plan={plan} result={result} fileName={fileName} />;
}

function PrintView({ plan, result, fileName }: { plan: Plan; result: ComputeResult; fileName: string }) {
  const { project } = plan;
  const mode = project.mode;
  const paper = useStore((s) => s.printPaper);
  const colorBy = useStore((s) => s.colorBy);
  const critical = useStore((s) => s.critical);
  const filters = useStore((s) => s.filters);
  const pinned = useStore((s) => s.pinned);
  const collapsed = useStore((s) => s.collapsed);
  const shown = useStore((s) => s.columns[mode]);
  const [preparedBy, setPreparedBy] = useState(project.owner);
  const fontsReady = useFontsReady();

  const all = useMemo(() => rowsOf(plan, result), [plan, result]);
  const rows = useMemo(() => shownRows(all, filters, pinned, collapsed), [all, filters, pinned, collapsed]);
  const info = useMemo(() => assigneeInfo(plan), [plan]);
  const calendar = useMemo(() => createCalendar(plan.holidays.map((h) => h.date)), [plan.holidays]);
  const { columns, left, width: tableWidth } = printColumns(shown, mode, paper);
  const chartWidth = PAPER[paper].width - tableWidth;
  // The printed rows' range (§7.8); Plan mode draws planned bars only and no status date, so neither counts there.
  const dates = mode === 'Plan' ? rows.flatMap(({ r }) => [r.plannedStart, r.plannedFinish]) : rowDates(rows);
  const range = ganttRange(dates, mode === 'Plan' && dates.length > 0 ? dates[0]! : project.statusDate, calendar);
  const scale = fittedScale(range.start, range.end, chartWidth, LABEL_ROOM[mode]);
  const holidays = showsHolidays(scale) ? plan.holidays.filter((h) => h.date >= range.start && h.date <= range.end) : [];
  const printed = new Set(rows.map((row) => row.task.id));
  const legend: LegendProps = {
    mode,
    colorBy,
    critical,
    assignees: legendAssignees(rows, info),
    summary: rows.some((row) => row.r.summary),
    milestone: rows.some((row) => !row.r.summary && row.r.plannedDuration === 0),
    links: mode === 'Plan' && rows.some((row) => row.r.links.some((link) => printed.has(link.predId))),
    nonwork: holidays.length > 0,
  };

  // The legend wraps onto as many lines as it needs: measured at the page's width (once the fonts are in), its height
  // sets the rows per page.
  const measure = useRef<HTMLDivElement>(null);
  const [legendHeight, setLegendHeight] = useState(0);
  useLayoutEffect(() => {
    const box = measure.current;
    if (!fontsReady || !box) return;
    const height = Math.ceil(box.getBoundingClientRect().height);
    if (height !== legendHeight) setLegendHeight(height);
  });
  const perPage = rowsPerPage(paper, legendHeight);
  const pages = legendHeight > 0 ? paginate(rows, perPage) : [];

  const filtered = isFiltering(filters);
  const dateLine = mode === 'Plan' ? `Plan ${formatDateLong(result.summary.plannedStart)} – ${formatDateLong(result.summary.plannedFinish)}` : `Status date ${formatDateLong(project.statusDate)}`;
  const band = { title: project.name, meta: [dateLine, preparedBy.trim() && `Prepared by ${preparedBy.trim()}`, filtered && 'Filtered'].filter(Boolean).join(' · ') };
  const empty = all.length === 0 ? 'No tasks to print yet. Add tasks in Plan mode, then print again.' : rows.length === 0 ? 'Nothing to print: no task matches the search or filters.' : null;
  const notes = [filtered && 'Search or filters are on: only the rows shown are printed.', left.length > 0 && `Not enough room for ${left.join(', ')} — hide columns or choose A3.`].filter(Boolean);
  const sheet = `paper-${paper.toLowerCase()}`;

  return (
    <div className="report gantt-print">
      <PrintChrome size={PAPER[paper].size} left={band.title} right={band.meta} footer={`Gantt Planner · ${fileName}`} />
      <div className="report-toolbar">
        <button type="button" className="btn btn-quiet" onClick={closeView}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h1>Print Gantt</h1>
        {empty === null && notes.length > 0 && (
          <p className="print-notes" role="status">
            {notes.join(' ')}
          </p>
        )}
        <span className="toolbar-spacer" />
        <Popover
          label="Print options"
          button={
            <>
              <SlidersHorizontal size={16} aria-hidden="true" /> Options
            </>
          }
        >
          <div className="filter-panel report-options">
            <h4>Paper</h4>
            <Segmented label="Paper size" options={PAPERS} value={paper} onChange={setPrintPaper} />
            <h4>Prepared by</h4>
            <input className="drawer-input" aria-label="Prepared by" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
          </div>
        </Popover>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={pages.length === 0} title={empty ?? undefined}>
          <Printer size={16} aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>
      <div className="report-pages">
        {empty !== null ? (
          <p className="report-blank" role="status">
            {empty}
          </p>
        ) : pages.length === 0 ? (
          <p className="report-wait">Preparing pages…</p>
        ) : (
          pages.map((chunk, p) => (
            <Page key={p} band={band} className={`print-page ${sheet}`}>
              <PrintSheet
                rows={chunk}
                all={rows}
                first={p * perPage}
                mode={mode}
                columns={columns}
                tableWidth={tableWidth}
                chartWidth={chartWidth}
                scale={scale}
                holidays={holidays}
                statusDate={project.statusDate}
                colorBy={colorBy}
                critical={critical}
                info={info}
              />
              <PrintLegend {...legend} />
            </Page>
          ))
        )}
      </div>
      {empty === null && (
        <div ref={measure} className={`print-measure ${sheet}`} aria-hidden="true">
          <PrintLegend {...legend} />
        </div>
      )}
    </div>
  );
}
