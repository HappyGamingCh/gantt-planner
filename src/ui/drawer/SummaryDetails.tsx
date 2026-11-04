// A major task in the drawer (SPEC §7.9): its calculated values, read-only; only its name and Remarks are the user's.
import type { TaskResult } from '../../engine/types';
import { formatDate, formatDays, formatVariance, plural } from '../common/format';

export function SummaryDetails({ r }: { r: TaskResult }) {
  const finish = r.summary?.actualFinish;
  return (
    <section className="drawer-section">
      <h3>Major task</h3>
      <p className="drawer-empty">{plural(r.summary?.tasks ?? 0, 'task')}: its dates and progress are calculated from them.</p>
      <dl className="drawer-facts">
        <dt>Planned</dt>
        <dd>
          {formatDate(r.plannedStart)} → {formatDate(r.plannedFinish)} · {formatDays(r.plannedDuration)}
        </dd>
        <dt>Progress</dt>
        <dd>{r.progress}%</dd>
        <dt>Actual</dt>
        <dd>{r.actualStart ? `${formatDate(r.actualStart)} → ${finish ? formatDate(finish) : '…'}` : '—'}</dd>
        <dt>Forecast</dt>
        <dd>
          {formatDate(r.forecastStart)} → {formatDate(r.forecastFinish)}
          {r.variance !== 0 && (
            <>
              {' · '}
              <span className={r.variance > 0 ? 'text-late' : 'text-early'}>{formatVariance(r.variance)}</span>
            </>
          )}
        </dd>
      </dl>
    </section>
  );
}
