// Report pages 4+ (SPEC §9.3): the Track-mode Gantt fitted to the page width, the timeline header repeated on
// every page. Rows are 26 px (not 28) so a 25-task plan fits one A4 landscape page. Major tasks are rows of their own
// (bold, indented by Level, with their bar), all expanded.
import { createCalendar } from '../../engine/calendar';
import type { Plan } from '../../engine/types';
import type { Row } from '../../store/selectors';
import { MarkLabel, SummaryMark, TrackMark } from '../gantt/bars';
import { rowDates } from '../gantt/Gantt';
import { fittedScale, ganttRange, gridColumns, showsHolidays, showsWeekends, weekendDays } from '../gantt/scale';
import { Timeline } from '../gantt/Timeline';
import { TIMELINE_HEIGHT } from '../../config';
import { APPENDIX_LEGEND_HEIGHT, AppendixLegend } from './AppendixLegend';
import { Page, type Band } from './ReportPage';
import '../gantt/Gantt.css';

const ROW = 26;
const LABELS = 300;
const CHART = 1040 - LABELS;
/** Room kept after the last bar for its label: a milestone's "19 Oct · +12d" at --fs-sm plus its 6 px gap. */
const TRACK_LABEL_ROOM = 100;
/**
 * Printable height (190 mm ≈ 718.1 px) less the timeline header (TIMELINE_HEIGHT + its 1 px border = 45 px) and
 * the legend line under the chart (APPENDIX_LEGEND_HEIGHT): 25 rows, 715 px, about 3 px to spare. That only holds
 * while the chart <svg> is display: block (Report.css). The title sits in the label header.
 */
const PER_PAGE = Math.floor((718 - (TIMELINE_HEIGHT + 1) - APPENDIX_LEGEND_HEIGHT) / ROW);

export function GanttAppendix({ plan, rows, band }: { plan: Plan; rows: Row[]; band: Band }) {
  if (rows.length === 0) return null;
  const sd = plan.project.statusDate;
  const range = ganttRange(rowDates(rows), sd, createCalendar(plan.holidays.map((h) => h.date)));
  const scale = fittedScale(range.start, range.end, CHART, TRACK_LABEL_ROOM);
  const holidays = showsHolidays(scale) ? plan.holidays.filter((h) => h.date >= range.start && h.date <= range.end) : [];
  const pages = Array.from({ length: Math.ceil(rows.length / PER_PAGE) }, (_, i) => rows.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  const sdX = scale.x(sd) + scale.px;
  const { weeks, days } = gridColumns(scale);
  const vlines = (list: number[], height: number) => list.map((i) => `M${i * scale.px + 0.5},0V${height}`).join('');
  const weekends = showsWeekends(scale) ? weekendDays(scale) : [];
  return (
    <>
      {pages.map((chunk, p) => (
        <Page key={p} band={band}>
          <div className="appendix">
            <div className="appendix-labels" style={{ width: LABELS }}>
              <div className="appendix-head" style={{ height: TIMELINE_HEIGHT }}>
                <strong>Gantt{pages.length > 1 ? ` (${p + 1} of ${pages.length})` : ''}</strong>
                <span>ID · Task</span>
              </div>
              {chunk.map(({ task, r }) => (
                <div key={task.id} className={`appendix-row${r.status === 'Late' ? ' text-late' : ''}${r.summary ? ' appendix-summary' : ''}`} style={{ height: ROW }}>
                  <span className="appendix-id">{task.id}</span>
                  <span className="appendix-name" style={r.level > 1 ? { paddingLeft: (r.level - 1) * 12 } : undefined}>
                    {task.name}
                  </span>
                </div>
              ))}
            </div>
            <div className="appendix-chart">
              <Timeline scale={scale} width={CHART} holidays={holidays} statusDate={sd} />
              <svg className="gantt-chart gantt-track" width={CHART} height={chunk.length * ROW} aria-hidden="true">
                <g className="weekends">
                  {weekends.map((d) => (
                    <rect key={d} x={d * scale.px} y={0} width={scale.px} height={chunk.length * ROW} />
                  ))}
                </g>
                {holidays.map((h) => (
                  <rect key={h.date} className="appendix-nonwork" x={scale.x(h.date)} y={0} width={scale.px} height={chunk.length * ROW} />
                ))}
                <path className="grid-lines" d={vlines(days, chunk.length * ROW) + chunk.map((_, i) => `M0,${(i + 1) * ROW - 0.5}H${CHART}`).join('')} />
                <path className={scale.detail === 'day' ? 'grid-lines grid-weeks' : 'grid-lines'} d={vlines(weeks, chunk.length * ROW)} />
                {chunk.map((row, i) => (
                  <g key={row.task.id}>
                    {row.r.summary ? <SummaryMark row={row} top={i * ROW} rowHeight={ROW} scale={scale} mode="Track" /> : <TrackMark row={row} top={i * ROW} rowHeight={ROW} scale={scale} critical={false} />}
                  </g>
                ))}
                {/* The same white halo as the app (§7.8), so the dashes stay visible where they cross a solid bar */}
                <line className="sd-halo" x1={sdX} x2={sdX} y1={0} y2={chunk.length * ROW} />
                <line className="sd-line" x1={sdX} x2={sdX} y1={0} y2={chunk.length * ROW} />
                <g className="labels">
                  {chunk.map((row, i) => (
                    <MarkLabel key={row.task.id} row={row} mode="Track" top={i * ROW} rowHeight={ROW} scale={scale} />
                  ))}
                </g>
              </svg>
            </div>
          </div>
          <AppendixLegend nonwork={holidays.length > 0} />
        </Page>
      ))}
    </>
  );
}
