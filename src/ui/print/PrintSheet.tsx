// One Print Gantt page (SPEC §9.4): the table (ID, Task, the grid's visible columns) with the chart beside it, each
// under its header, for the page's rows. Arrows to rows on other pages run to the page's edge.
import type { ColorBy } from '../../config';
import type { Holiday, ISODate } from '../../engine/types';
import type { AssigneeInfo, Row } from '../../store/selectors';
import { barPaint, LABEL_DX, Links, MarkLabel, PlanMark, SummaryMark, TrackMark } from '../gantt/bars';
import { gridColumns, showsWeekends, weekendDays, type GanttScale } from '../gantt/scale';
import { Timeline } from '../gantt/Timeline';
import { cellText, cellTone, HEAD_HEIGHT, LEVEL_INDENT, PRINT_ROW, type PrintColumn } from './printLayout';

export interface SheetProps {
  /** The page's rows. */
  rows: Row[];
  /** Every printed row: arrows reach across pages. */
  all: Row[];
  /** Index in `all` of the page's first row. */
  first: number;
  mode: 'Plan' | 'Track';
  columns: PrintColumn[];
  tableWidth: number;
  chartWidth: number;
  scale: GanttScale;
  /** The holiday columns drawn. */
  holidays: Holiday[];
  statusDate: ISODate;
  colorBy: ColorBy;
  critical: boolean;
  info: Map<string, AssigneeInfo>;
}

export function PrintSheet(props: SheetProps) {
  const { mode, chartWidth, scale, holidays, statusDate } = props;
  return (
    <div className="print-gantt">
      <PrintTable {...props} />
      <div className="print-chart" style={{ width: chartWidth }}>
        <Timeline scale={scale} width={chartWidth} holidays={holidays} statusDate={mode === 'Track' ? statusDate : undefined} />
        <PrintChart {...props} />
      </div>
    </div>
  );
}

function PrintTable({ rows, columns, tableWidth, colorBy, info }: SheetProps) {
  return (
    <div className="print-table" style={{ width: tableWidth }}>
      <div className="print-head" style={{ height: HEAD_HEIGHT }}>
        {columns.map((c) => (
          <div key={c.key} className={c.align ? 'print-cell print-right' : 'print-cell'} style={{ width: c.width }}>
            {c.header}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.task.id} className={row.r.summary ? 'print-row print-summary' : 'print-row'} style={{ height: PRINT_ROW }}>
          {columns.map((c) => (
            <PrintCell key={c.key} column={c} row={row} colorBy={colorBy} info={info} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PrintCell({ column, row, colorBy, info }: { column: PrintColumn; row: Row; colorBy: ColorBy; info: Map<string, AssigneeInfo> }) {
  const { key, width, align } = column;
  const { task, r } = row;
  if (key === 'id' || key === 'task') {
    return key === 'id' ? (
      <div className="print-cell print-right print-id" style={{ width }}>
        {task.id}
      </div>
    ) : (
      <div className="print-cell" style={{ width }}>
        <span className="print-text print-name" style={r.level > 1 ? { paddingLeft: (r.level - 1) * LEVEL_INDENT } : undefined}>
          {r.status === 'Late' && <span className="late-dot" aria-label="Late" />}
          {task.name}
        </span>
        {r.summary && <span className="print-count">{r.summary.tasks}</span>}
      </div>
    );
  }
  const text = cellText(key, row);
  const tone = cellTone(key, row);
  // The bar's colour before the names, so the table reads as the colour key too.
  const paint = key === 'assigned' && text !== '' ? barPaint(task, colorBy, info) : undefined;
  return (
    <div className={['print-cell', align && 'print-right', tone].filter(Boolean).join(' ')} style={{ width }}>
      {paint && <span className="print-swatch" style={{ background: paint }} />}
      <span className="print-text">{text}</span>
    </div>
  );
}

function PrintChart({ rows, all, first, mode, chartWidth: width, scale, holidays, statusDate, colorBy, critical, info }: SheetProps) {
  const height = rows.length * PRINT_ROW;
  const { weeks, days } = gridColumns(scale);
  const vlines = (list: number[]) => list.map((i) => `M${i * scale.px + 0.5},0V${height}`).join('');
  const Mark = mode === 'Plan' ? PlanMark : TrackMark;
  const sdX = scale.x(statusDate) + scale.px;
  return (
    <svg className={`gantt-chart gantt-${mode.toLowerCase()}`} width={width} height={height} aria-hidden="true">
      <g className="lanes">
        {rows.map((row, i) => row.r.summary && <rect key={row.task.id} className="lane lane-summary" x={0} y={i * PRINT_ROW} width={width} height={PRINT_ROW} />)}
      </g>
      {showsWeekends(scale) && (
        <g className="weekends">
          {weekendDays(scale).map((d) => (
            <rect key={d} x={d * scale.px} y={0} width={scale.px} height={height} />
          ))}
        </g>
      )}
      <g className="nonwork">
        {holidays.map((h) => (
          <rect key={h.date} x={scale.x(h.date)} y={0} width={scale.px} height={height} />
        ))}
      </g>
      <path className="grid-lines" d={vlines(days) + rows.map((_, i) => `M0,${(i + 1) * PRINT_ROW - 0.5}H${width}`).join('')} />
      <path className={scale.detail === 'day' ? 'grid-lines grid-weeks' : 'grid-lines'} d={vlines(weeks)} />
      {/* Plan mode draws every arrow (§7.8); the page shows the part of each that crosses it */}
      {mode === 'Plan' && (
        <g transform={`translate(0 ${-first * PRINT_ROW})`}>
          <Links rows={all} mode="Plan" rowHeight={PRINT_ROW} scale={scale} focus={null} critical={critical} rowRange={{ first, last: first + rows.length - 1 }} />
        </g>
      )}
      {rows.map((row, i) => (
        <g key={row.task.id}>
          {row.r.summary ? (
            <SummaryMark row={row} top={i * PRINT_ROW} rowHeight={PRINT_ROW} scale={scale} mode={mode} />
          ) : (
            <Mark row={row} top={i * PRINT_ROW} rowHeight={PRINT_ROW} scale={scale} paint={barPaint(row.task, colorBy, info)} critical={critical && row.r.critical === true} />
          )}
        </g>
      ))}
      {/* The app's white halo under the dashes (§7.8) */}
      {mode === 'Track' && (
        <>
          <line className="sd-halo" x1={sdX} x2={sdX} y1={0} y2={height} />
          <line className="sd-line" x1={sdX} x2={sdX} y1={0} y2={height} />
        </>
      )}
      <g className="labels">
        {rows.map((row, i) => (
          <MarkLabel key={row.task.id} row={row} mode={mode} top={i * PRINT_ROW} rowHeight={PRINT_ROW} scale={scale} dx={mode === 'Plan' ? LABEL_DX : undefined} />
        ))}
      </g>
    </svg>
  );
}
