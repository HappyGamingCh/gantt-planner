// Report page 2 (SPEC §9.3): progress by assignee — table (worst variance first), planned vs actual bars,
// workload heatmap (per day for a short project, per week otherwise).
import { useMemo } from 'react';
import { REPORT_BARS_PER_CHART } from '../../config';
import { scheduleState } from '../../engine/progress';
import type { AssigneeSummary, ComputeResult, ISODate, Plan, ScheduleState } from '../../engine/types';
import type { Row } from '../../store/selectors';
import { formatDayMonth, formatPct, formatPts } from '../common/format';
import { assigneeBarsConfig, chartImage } from './charts';
import { assigneesByVariance, workload, type Workload } from './reportData';

/** Variance (pts) text colour by schedule state (§5.8); On track stays neutral so the exceptions stand out. */
const VARIANCE_CLASS: Record<ScheduleState, string> = { Ahead: ' text-early', 'On track': '', 'Slightly behind': ' text-risk', Behind: ' text-late' };

export function AssigneesPage({ plan, result, rows }: { plan: Plan; result: ComputeResult; rows: Row[] }) {
  const list = useMemo(() => assigneesByVariance(result.byAssignee), [result.byAssignee]);
  // Images of at most 20 assignees (580 px), so none is taller than a printed page.
  const bars = useMemo(() => {
    const images: { src: string; height: number }[] = [];
    for (let i = 0; i < list.length; i += REPORT_BARS_PER_CHART) {
      const slice = list.slice(i, i + REPORT_BARS_PER_CHART);
      const height = 60 + 26 * slice.length;
      images.push({ src: chartImage(assigneeBarsConfig(slice), 480, height), height });
    }
    return images;
  }, [list]);
  const ff = result.summary.forecastFinish;
  const heat = useMemo(() => workload(rows, list.map((a) => a.name), plan, ff), [rows, list, plan, ff]);
  if (list.length === 0) {
    return (
      <>
        <h2>Progress by assignee</h2>
        <p className="report-empty">No tasks yet.</p>
      </>
    );
  }
  return (
    <>
      <h2>Progress by assignee</h2>
      <table className="report-table">
        <thead>
          <tr>
            <th>Assignee</th>
            <th>Type</th>
            <th className="num">Tasks</th>
            <th className="num">Completed</th>
            <th className="num">In progress</th>
            <th className="num">Late</th>
            <th className="num">Planned %</th>
            <th className="num">Actual %</th>
            <th className="num">Variance (pts)</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.name}>
              <td>{a.name}</td>
              <td>{a.type ?? ''}</td>
              <td className="num">{a.tasks}</td>
              <td className="num">{a.completed}</td>
              <td className="num">{a.inProgress}</td>
              <td className={`num${a.late > 0 ? ' text-late' : ''}`}>{a.late}</td>
              <td className="num">{formatPct(a.plannedPct)}</td>
              <td className="num">{formatPct(a.actualPct)}</td>
              <td className={`num${VARIANCE_CLASS[scheduleState(a.variancePts)]}`}>{formatPts(a.variancePts).replace(' pts', '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="assignee-body">
        <div className="assignee-bars">
          {bars.map((b, i) => (
            <figure key={i} className="report-chart">
              <figcaption>Planned vs actual{i > 0 ? ' (cont.)' : ''}</figcaption>
              <img src={b.src} width={480} height={b.height} alt="Planned and actual progress per assignee" />
            </figure>
          ))}
        </div>
        <Heatmap list={list} heat={heat} />
      </div>
    </>
  );
}

/** Workload heatmap: shades 0 / 1 / 2 / 3+; a 0 shows no number, a holiday column is hatched and blank. */
function Heatmap({ list, heat }: { list: AssigneeSummary[]; heat: Workload }) {
  if (heat.columns.length === 0) {
    return (
      <figure className="report-chart">
        <figcaption>Workload: open tasks per {heat.unit}</figcaption>
        <p className="report-empty">No open tasks after the status date.</p>
      </figure>
    );
  }
  return (
    <figure className="report-chart">
      <figcaption>Workload: open tasks per {heat.unit}</figcaption>
      <table className={`heatmap${heat.unit === 'day' ? ' daily' : ''}`}>
        <thead>
          <tr>
            <th />
            {heat.columns.map((d, j) => (
              <th key={d} className={heat.holiday[j] ? 'heat-off' : undefined} title={heat.holiday[j] ? 'Holiday' : undefined}>
                {heat.unit === 'week' ? formatDayMonth(d) : <DayHead date={d} withMonth={j === 0 || d.endsWith('-01')} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((a, i) => (
            <tr key={a.name}>
              <th title={a.name}>
                <span className="heat-name">{a.name}</span>
              </th>
              {heat.counts[i]!.map((n, j) =>
                heat.holiday[j] ? (
                  <td key={j} className="heat-off">
                    <span className="sr-only">Holiday</span>
                  </td>
                ) : (
                  <td key={j} className={`heat-${Math.min(n, 3)}`}>
                    {n > 0 ? n : <span className="sr-only">0</span>}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {heat.holiday.some(Boolean) && <p className="report-note">Hatched columns are holidays; they are not counted.</p>}
    </figure>
  );
}

/** Daily column header: the day number, with the month under the first column and each 1st of a month. */
function DayHead({ date, withMonth }: { date: ISODate; withMonth: boolean }) {
  const [day, month] = formatDayMonth(date).split(' ');
  return (
    <>
      {day}
      <span className="heat-month">{withMonth ? month : ' '}</span>
    </>
  );
}
