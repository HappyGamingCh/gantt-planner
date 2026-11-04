// Gantt appendix legend (SPEC §9.3): one line under the chart on every page, because paper has no tooltips. The
// swatches reuse the Gantt's own classes, so their colours come from the tokens.
import type { Status } from '../../engine/types';
import { STATUS_LABEL, STATUS_SLUG } from '../common/status';

/** Height of the legend line with its top margin, px; kept out of the rows per page. */
export const APPENDIX_LEGEND_HEIGHT = 20;

const STATUSES: Status[] = ['Completed', 'In Progress', 'Late', 'Not Started'];

export function AppendixLegend({ nonwork }: { nonwork: boolean }) {
  return (
    <div className="appendix-legend">
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
      {STATUSES.map((s) => (
        <span key={s}>
          <svg width={10} height={10} aria-hidden="true">
            {/* A Not started bar has no done part: its swatch is the pale outlined rest of the bar, as drawn */}
            {s === 'Not Started' ? (
              <rect className="bar-rest st-idle" x={0.5} y={0.5} width={9} height={9} rx={2} />
            ) : (
              <rect className={`bar-done st-${STATUS_SLUG[s]}`} width={10} height={10} rx={2} />
            )}
          </svg>
          {STATUS_LABEL[s]}
        </span>
      ))}
      <span>
        {/* The Not started milestone is hollow (a 1.5 px outline): inset 1 px so the outline isn't clipped */}
        <svg width={14} height={14} aria-hidden="true">
          <path className="ms-track st-idle" d="M7,1 L13,7 L7,13 L1,7 Z" />
        </svg>
        Milestone
      </span>
      {nonwork && (
        <span>
          <svg width={10} height={12} aria-hidden="true">
            <rect className="appendix-nonwork legend-nonwork" x={0.5} y={0.5} width={9} height={11} />
          </svg>
          Non-working day
        </span>
      )}
      <span>
        <span className="text-late">+3d</span> = working days late
      </span>
    </div>
  );
}
