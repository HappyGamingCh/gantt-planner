// KPI strip (SPEC §7.5): Track mode answers "are we on track?"; Plan mode describes the plan. A chevron collapses it
// to one line (§7.3); each card explains its figure in a tooltip.
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ComputeResult, Plan, ScheduleState } from '../../engine/types';
import { assigneeCount } from '../../store/selectors';
import { setFilters, toggleKpis, useStore, type Filters } from '../../store/store';
import { formatDate, formatDays, formatPct, formatPts, formatVariance } from '../common/format';
import { PLAN_DURATION_HINT, trackHints } from './hints';
import './KpiStrip.css';

/** The grid shows late tasks only (the status filter is exactly "Late"). */
export const isLateFilter = (f: Filters) => f.statuses.length === 1 && f.statuses[0] === 'Late';

/** "N late" on the Tasks card: late tasks only, or all again. Search and assignee filters stay. */
export function toggleLateFilter(): void {
  setFilters({ statuses: isLateFilter(useStore.getState().filters) ? [] : ['Late'] });
}

export function KpiStrip({ plan, result }: { plan: Plan; result: ComputeResult }) {
  const collapsed = useStore((s) => s.kpiCollapsed);
  const lateOn = useStore((s) => isLateFilter(s.filters));
  const toggle = collapsed ? 'Show key figures' : 'Collapse key figures';
  return (
    <section className={`kpis kpis-main kpis-${plan.project.mode.toLowerCase()}${collapsed ? ' kpis-collapsed' : ''}`} aria-label="Key figures">
      {plan.project.mode === 'Track' ? (
        <TrackCards result={result} lateOn={lateOn} onShowLate={toggleLateFilter} />
      ) : (
        <PlanCards plan={plan} result={result} />
      )}
      <button type="button" className="btn btn-icon btn-quiet kpi-toggle" aria-expanded={!collapsed} aria-label={toggle} title={toggle} onClick={toggleKpis}>
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>
    </section>
  );
}

function Card({
  label,
  value,
  extra,
  caption,
  hint,
  children,
}: {
  label: string;
  value: ReactNode;
  extra?: ReactNode;
  caption?: ReactNode;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="kpi" title={hint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        {extra}
      </div>
      {caption && <div className="kpi-caption">{caption}</div>}
      {children}
    </div>
  );
}

const STATE_CLASS: Record<ScheduleState, string> = { Ahead: 'good', 'On track': 'good', 'Slightly behind': 'risk', Behind: 'bad' };

const NO_TASKS = 'No tasks yet';

/**
 * Track-mode cards; the report's first page shows the same (§9.3). With `onShowLate` (main view only) the red
 * "N late" is a button that filters the grid to late tasks. A plan without tasks shows "—", not "On track".
 */
export function TrackCards({ result, onShowLate, lateOn = false }: { result: ComputeResult; onShowLate?: () => void; lateOn?: boolean }) {
  const s = result.summary;
  const { completed, inProgress, notStarted, late, total } = s.counts;
  // Progress and Schedule are means over the tasks (milestones excluded); the dates need at least one row.
  const noWork = total === 0;
  const empty = noWork && s.milestones.total === 0;
  const hints = trackHints(s);
  const share = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;
  // Captions (§7.5). Tasks counts milestones, not statuses: the report donut folds late tasks into its other buckets,
  // so status counts here would disagree with it.
  const milestones = s.milestones.total > 0 ? `milestones ${s.milestones.done}/${s.milestones.total}` : undefined;
  const left = Math.max(0, s.durationDays - s.elapsedDays);
  const lateLabel = onShowLate ? (
    <button type="button" className="kpi-state kpi-bad kpi-link" aria-pressed={lateOn} title={lateOn ? 'Remove the Late filter' : 'Show late tasks and milestones'} onClick={onShowLate}>
      {late} late
    </button>
  ) : (
    <span className="kpi-state kpi-bad">{late} late</span>
  );
  return (
    <>
      <Card label="Progress" value={noWork ? '—' : formatPct(s.actualPct)} caption={noWork ? NO_TASKS : `plan ${formatPct(s.plannedPct)}`} hint={noWork ? undefined : hints.progress}>
        {!noWork && (
          <div className="kpi-bar" aria-hidden="true">
            <span className="kpi-fill" style={{ width: `${s.actualPct}%` }} />
            <span className="kpi-marker" style={{ left: `${s.plannedPct}%` }} />
          </div>
        )}
      </Card>
      <Card
        label="Schedule"
        value={noWork ? '—' : formatPts(s.variancePts)}
        extra={!noWork && <span className={`kpi-state kpi-${STATE_CLASS[s.state]}`}>{s.state}</span>}
        caption={
          <>
            <abbr title="Schedule performance index">SPI</abbr> {noWork || s.spi === null ? '—' : s.spi.toFixed(2)}
          </>
        }
        hint={noWork ? undefined : hints.schedule}
      />
      <Card
        label="Finish"
        value={empty ? '—' : formatDate(s.forecastFinish)}
        extra={
          !empty && (
            <span className={`kpi-chip ${s.finishVariance > 0 ? 'kpi-bad' : s.finishVariance < 0 ? 'kpi-good' : ''}`}>
              {s.finishVariance === 0 ? 'on time' : formatVariance(s.finishVariance)}
            </span>
          )
        }
        caption={empty ? NO_TASKS : `planned ${formatDate(s.plannedFinish)}`}
        hint={empty ? undefined : hints.finish}
      />
      <Card
        label="Tasks"
        value={noWork ? '0 tasks' : `${completed}/${total} done`}
        extra={late > 0 && lateLabel}
        caption={noWork ? undefined : milestones}
        hint={noWork ? undefined : hints.tasks}
      >
        {!noWork && (
          <div className="kpi-bar kpi-stack" aria-hidden="true">
            <span className="st-completed" style={{ width: share(completed) }} />
            <span className="st-progress" style={{ width: share(inProgress) }} />
            <span className="st-late" style={{ width: share(late) }} />
            <span className="st-idle" style={{ width: share(notStarted) }} />
          </div>
        )}
      </Card>
      <Card
        label="Time"
        value={empty ? '—' : `Day ${s.elapsedDays} of ${s.durationDays}`}
        caption={empty ? undefined : `${left} working day${left === 1 ? '' : 's'} left`}
        hint={empty ? undefined : hints.time}
      >
        {!empty && (
          <div className="kpi-bar" aria-hidden="true">
            <span className="kpi-fill kpi-fill-time" style={{ width: `${s.durationDays > 0 ? (s.elapsedDays / s.durationDays) * 100 : 0}%` }} />
          </div>
        )}
      </Card>
    </>
  );
}

function PlanCards({ plan, result }: { plan: Plan; result: ComputeResult }) {
  const s = result.summary;
  return (
    <>
      <Card label="Start" value={formatDate(s.plannedStart)} />
      <Card label="Finish" value={formatDate(s.plannedFinish)} />
      <Card label="Duration" value={formatDays(s.durationDays)} caption="working days" hint={PLAN_DURATION_HINT} />
      <Card label="Tasks" value={String(s.counts.total)} hint="Tasks with a duration; milestones are counted separately." />
      <Card label="Milestones" value={String(s.milestones.total)} />
      <Card label="Assignees" value={String(assigneeCount(plan))} />
    </>
  );
}
