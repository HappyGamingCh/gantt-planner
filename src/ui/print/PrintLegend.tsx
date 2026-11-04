// Print Gantt legend (SPEC §9.4): under the chart on every page, because paper has no tooltips. The swatches reuse the
// Gantt's own classes, so their colours come from the tokens (an assignee's from the resource palette).
import type { ColorBy } from '../../config';
import type { Status } from '../../engine/types';
import { STATUS_LABEL, STATUS_SLUG } from '../common/status';
import type { LegendAssignees } from './printLayout';

export interface LegendProps {
  mode: 'Plan' | 'Track';
  colorBy: ColorBy;
  critical: boolean;
  assignees: LegendAssignees;
  /** A major task, a milestone, an arrow and a holiday column are printed. */
  summary: boolean;
  milestone: boolean;
  links: boolean;
  nonwork: boolean;
}

const STATUSES: Status[] = ['Completed', 'In Progress', 'Late', 'Not Started'];

const Swatch = ({ color }: { color: string }) => (
  <svg width={10} height={10} aria-hidden="true">
    <rect width={10} height={10} rx={2} style={{ fill: color }} />
  </svg>
);

export function PrintLegend({ mode, colorBy, critical, assignees, summary, milestone, links, nonwork }: LegendProps) {
  const track = mode === 'Track';
  return (
    <div className="print-legend">
      {track && (
        <>
          <span>
            <svg width={28} height={14} aria-hidden="true">
              <rect className="bar-rest st-progress" x={0.5} y={0.5} width={27} height={13} rx={4} />
              <rect className="bar-done st-progress" width={17} height={14} rx={4} />
            </svg>
            Forecast / actual dates, filled to % done
          </span>
          <span>
            <svg width={24} height={4} aria-hidden="true">
              <rect className="bar-baseline" width={24} height={4} rx={2} />
            </svg>
            Planned dates
          </span>
        </>
      )}
      {colorBy === 'assignee' ? (
        <>
          {assignees.names.map(({ name, color }) => (
            <span key={name}>
              <Swatch color={color} />
              {name}
            </span>
          ))}
          {assignees.unassigned && (
            <span>
              <Swatch color="var(--idle)" />
              Unassigned
            </span>
          )}
        </>
      ) : track ? (
        STATUSES.map((s) => (
          <span key={s}>
            <svg width={10} height={10} aria-hidden="true">
              {/* A Not started bar has no done part: its swatch is the pale outlined rest of the bar, as drawn */}
              {s === 'Not Started' ? <rect className="bar-rest st-idle" x={0.5} y={0.5} width={9} height={9} rx={2} /> : <rect className={`bar-done st-${STATUS_SLUG[s]}`} width={10} height={10} rx={2} />}
            </svg>
            {STATUS_LABEL[s]}
          </span>
        ))
      ) : (
        <span>
          <svg width={24} height={10} aria-hidden="true">
            <rect className="bar-plan" width={24} height={10} rx={3} />
          </svg>
          Task
        </span>
      )}
      {summary && (
        <span>
          <svg width={24} height={11} aria-hidden="true">
            <rect className="bar-summary" width={24} height={7} />
            <path className="bar-summary" d="M0,7h4l-4,4Z M24,7h-4l4,4Z" />
          </svg>
          Major task
        </span>
      )}
      {milestone && (
        <span>
          {/* Inset 1 px, so a hollow Not started outline (Track) isn't clipped */}
          <svg width={14} height={14} aria-hidden="true">
            <path className={track ? 'ms-track st-idle' : 'ms-plan'} d="M7,1 L13,7 L7,13 L1,7 Z" />
          </svg>
          Milestone
        </span>
      )}
      {critical && (
        <span>
          <svg width={track ? 26 : 44} height={14} aria-hidden="true">
            <rect className="crit-ring" x={1} y={1} width={24} height={12} rx={5} />
            {!track && (
              <g className="link link-critical">
                <path d="M28,7 H40" />
                <path className="link-head" d="M44,7 l-4,-3 v6 z" />
              </g>
            )}
          </svg>
          Critical path
        </span>
      )}
      {links && (
        <span>
          <svg width={24} height={10} aria-hidden="true">
            <g className="link">
              <path d="M0,5 H20" />
              <path className="link-head" d="M24,5 l-4,-3 v6 z" />
            </g>
          </svg>
          Dependency
        </span>
      )}
      {nonwork && (
        <span>
          <svg width={10} height={12} aria-hidden="true">
            <rect className="appendix-nonwork legend-nonwork" x={0.5} y={0.5} width={9} height={11} />
          </svg>
          Non-working day
        </span>
      )}
      {track && (
        <span>
          <span className="text-late">+3d</span> = working days late
        </span>
      )}
    </div>
  );
}
