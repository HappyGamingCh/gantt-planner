// Report page 3 (SPEC §9.3): late tasks (critical ones flagged, milestones marked), milestones, look-ahead. The
// open-ended look-ahead comes last, so only it runs onto a following printed page.
import { Diamond, Flag } from 'lucide-react';
import type { ISODate } from '../../engine/types';
import type { Row } from '../../store/selectors';
import { formatDateLong, formatVariance, plural } from '../common/format';
import { STATUS_LABEL } from '../common/status';
import { isMilestone, lateSummary, lateTasks, lookAhead, milestones } from './reportData';

const variance = (v: number) => <span className={v > 0 ? 'text-late' : v < 0 ? 'text-early' : 'text-muted'}>{formatVariance(v)}</span>;
/** A milestone isn't counted in progress: "—" rather than a stalled-looking 0%. */
const progress = (row: Row) => (isMilestone(row) ? '—' : `${row.r.progress}%`);
const statusCell = ({ r }: Row) => <td className={r.status === 'Late' ? 'nowrap text-late' : 'nowrap'}>{STATUS_LABEL[r.status]}</td>;

export function AttentionPage({ rows, statusDate, days }: { rows: Row[]; statusDate: ISODate; days: number }) {
  const late = lateTasks(rows);
  const ahead = lookAhead(rows, statusDate, days);
  const ms = milestones(rows);
  return (
    <>
      <h2>Needs attention</h2>
      <h3>Late tasks</h3>
      {late.length === 0 ? (
        <p className="report-empty">No tasks are late.</p>
      ) : (
        <>
          <LateCount {...lateSummary(rows)} />
          <table className="report-table">
            <thead>
              <tr>
                <th className="num">ID</th>
                <th>Task</th>
                <th>Assigned</th>
                <th>Planned Finish</th>
                <th>Forecast Finish</th>
                <th className="num">Variance</th>
                <th className="num">Progress</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {late.map((row) => (
                <tr key={row.task.id}>
                  <td className="num">{row.task.id}</td>
                  <td>
                    {row.r.critical && <CriticalFlag />}
                    {isMilestone(row) && <MilestoneMark />}
                    {row.task.name}
                  </td>
                  <td>{row.task.assigned.join(', ')}</td>
                  <td className="date">{formatDateLong(row.r.plannedFinish)}</td>
                  <td className="date">{formatDateLong(row.r.forecastFinish)}</td>
                  <td className="num">{variance(row.r.variance)}</td>
                  <td className="num">{progress(row)}</td>
                  <td className="remarks">{row.task.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {late.some(({ r }) => r.critical) && (
        <p className="report-note">
          <CriticalFlag /> On the critical path: a further delay moves the forecast finish.
        </p>
      )}

      <h3>Milestones</h3>
      {ms.length === 0 ? (
        <p className="report-empty">The plan has no milestones.</p>
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Milestone</th>
              <th>Planned date</th>
              <th>Forecast / actual date</th>
              <th className="num">Variance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ms.map((row) => (
              <tr key={row.task.id}>
                <td>
                  #{row.task.id} {row.task.name}
                </td>
                <td className="date">{formatDateLong(row.r.plannedFinish)}</td>
                <td className="date">{formatDateLong(row.task.actualFinish ?? row.r.forecastFinish)}</td>
                <td className="num">{variance(row.r.variance)}</td>
                {statusCell(row)}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Look-ahead: next {plural(days, 'day')}</h3>
      {ahead.length === 0 ? (
        <p className="report-empty">Nothing is in progress or due in this window.</p>
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th className="num">ID</th>
              <th>Task</th>
              <th>Assigned</th>
              <th>Forecast Start</th>
              <th>Forecast Finish</th>
              <th className="num">Progress</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ahead.map((row) => (
              <tr key={row.task.id}>
                <td className="num">{row.task.id}</td>
                <td>
                  {isMilestone(row) && <MilestoneMark />}
                  {row.task.name}
                </td>
                <td>{row.task.assigned.join(', ')}</td>
                <td className="date">{formatDateLong(row.r.forecastStart)}</td>
                <td className="date">{formatDateLong(row.r.forecastFinish)}</td>
                <td className="num">{progress(row)}</td>
                {statusCell(row)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** "3 tasks and 1 milestone ◆ are late." The task number is the KPI late count; the diamond doubles as the legend. */
function LateCount({ tasks, milestones: count }: { tasks: number; milestones: number }) {
  return (
    <p className="report-note lead">
      {tasks > 0 && plural(tasks, 'task')}
      {tasks > 0 && count > 0 && ' and '}
      {count > 0 && (
        <>
          {plural(count, 'milestone')} <MilestoneMark />
        </>
      )}
      {tasks + count === 1 ? ' is' : ' are'} late.
    </p>
  );
}

function CriticalFlag() {
  return (
    <span className="crit-flag" title="On the critical path">
      <Flag size={11} aria-label="Critical" />
    </span>
  );
}

function MilestoneMark() {
  return (
    <span className="ms-mark" title="Milestone">
      <Diamond size={10} aria-label="Milestone" />
    </span>
  );
}
