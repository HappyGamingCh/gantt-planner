// Timeline header (SPEC §7.8): months on top; days, ISO weeks or Monday ticks below; holidays. The status date and
// today are chips in the top tier with a short line down through the bottom tier, so no date label is covered.
// `children` sit over its right corner (the main view's Gantt controls); `rightInset` keeps the chips clear of them.
import type { ReactNode } from 'react';
import { TIMELINE_HEIGHT } from '../../config';
import { toDayNumber } from '../../engine/dates';
import type { Holiday, ISODate } from '../../engine/types';
import { formatDayMonth } from '../common/format';
import { bottomSegments, gridColumns, layoutChips, monthLabelOffset, monthSegments, showsHolidays, weekendDays, type ChipBox, type GanttScale } from './scale';

const TIER = TIMELINE_HEIGHT / 2;
/** Height of a holiday's mark at the foot of the bottom tier when a cell holds a week label, not a day number. */
const HOLIDAY_STRIP = 4;

export function Timeline({
  scale,
  width,
  holidays,
  statusDate,
  today,
  rightInset = 0,
  children,
}: {
  scale: GanttScale;
  width: number;
  holidays: Holiday[];
  statusDate?: ISODate;
  today?: ISODate;
  /** Px at the right end the chips keep clear of (the Gantt corner over it). */
  rightInset?: number;
  children?: ReactNode;
}) {
  const { px, detail } = scale;
  const months = monthSegments(scale.start, scale.days);
  const bottom = bottomSegments(scale.start, scale.days, detail);
  const mondays = new Set(gridColumns(scale).weeks);
  const shaded = showsHolidays(scale) ? holidays : [];
  const daysOff = new Set(shaded.map((h) => toDayNumber(h.date) - toDayNumber(scale.start)));
  // §7.8 Weekends: with day numbers, Saturday and Sunday cells are marked (a holiday's grey wins).
  const weekend = new Set(detail === 'day' ? weekendDays(scale) : []);
  // The same x as the chart's lines: the status date at the end of its day, today in the middle of its day.
  const status = statusDate ? { x: scale.x(statusDate) + px, text: `Status · ${formatDayMonth(statusDate)}` } : undefined;
  const now = today ? { x: scale.x(today) + px / 2, text: 'Today' } : undefined;
  let chips = layoutChips(width, status, now, rightInset);
  // A Today chip moved off its line (beside the Status chip, or clear of the corner) names its date, so it is never
  // read as the date under it.
  if (today && now && chips.today && Math.abs(chips.today.cx - now.x) > chips.today.w / 2) {
    const dated = layoutChips(width, status, { ...now, text: `Today · ${formatDayMonth(today)}` }, rightInset);
    if (dated.today) chips = dated;
  }
  const placed = [chips.status, chips.today].filter((c): c is ChipBox => c !== undefined);
  return (
    <div className="timeline">
      {/* HTML, so a month's name stays at the left edge while any of the month is in view (sticky). */}
      <div className="tl-months" style={{ width, height: TIER }} aria-hidden="true">
        {months.map((m) => {
          const offset = monthLabelOffset(m, px, placed, width);
          // The last month stops at `width`: the scale it gets can run up to a day past it (fillScale).
          return (
            <div key={m.day} className="tl-month-cell" style={{ width: Math.max(0, Math.min(m.days * px, width - m.day * px)) }}>
              {offset !== null && (
                <span className="tl-month" style={{ marginLeft: offset }}>
                  {m.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <svg width={width} height={TIMELINE_HEIGHT} aria-hidden="true">
        {[...weekend].filter((d) => !daysOff.has(d)).map((d) => (
          <rect key={`we-${d}`} className="tl-weekend" x={d * px} y={TIER} width={px} height={TIER} />
        ))}
        {/* Day detail: the whole cell under its day number. Otherwise a strip at the foot of the tier, so no week
            label runs across a grey box; the whole cell still shows the tooltip. */}
        {shaded.map((h) =>
          detail === 'day' ? (
            <rect key={h.date} className="tl-holiday" x={scale.x(h.date)} y={TIER} width={px} height={TIER}>
              <title>{h.description || 'Holiday'}</title>
            </rect>
          ) : (
            <g key={h.date}>
              <title>{h.description || 'Holiday'}</title>
              <rect className="tl-holiday-hit" x={scale.x(h.date)} y={TIER} width={px} height={TIER} />
              <rect className="tl-holiday" x={scale.x(h.date)} y={TIMELINE_HEIGHT - HOLIDAY_STRIP} width={px} height={HOLIDAY_STRIP} />
            </g>
          ),
        )}
        {months.map((m) => (
          <line key={m.day} className="tl-line" x1={m.day * px + 0.5} x2={m.day * px + 0.5} y1={0} y2={TIMELINE_HEIGHT} />
        ))}
        <line className="tl-line" x1={0} x2={width} y1={TIER + 0.5} y2={TIER + 0.5} />
        {bottom.map((b) => (
          <line key={b.day} className={detail === 'day' && mondays.has(b.day) ? 'tl-tick tl-week' : 'tl-tick'} x1={b.day * px + 0.5} x2={b.day * px + 0.5} y1={TIER} y2={TIMELINE_HEIGHT} />
        ))}
        {now && <line className="today-line" x1={now.x} x2={now.x} y1={TIER - 3} y2={TIMELINE_HEIGHT} />}
        {status && <line className="sd-line" x1={status.x} x2={status.x} y1={TIER - 3} y2={TIMELINE_HEIGHT} />}
        {bottom.map((b) => (
          <text key={b.day} className={detail === 'day' && daysOff.has(b.day) ? 'tl-day tl-day-off' : weekend.has(b.day) ? 'tl-day tl-day-weekend' : 'tl-day'} x={detail === 'day' ? (b.day + 0.5) * px : b.day * px + 4} y={TIER + TIER / 2} textAnchor={detail === 'day' ? 'middle' : 'start'}>
            {detail === 'day' || b.days * px >= 18 ? b.label : ''}
          </text>
        ))}
        {chips.today && <Chip chip={chips.today} className="tl-today" />}
        {chips.status && <Chip chip={chips.status} className="tl-status" />}
      </svg>
      {children}
    </div>
  );
}

/** Label chip in the top tier, over its line (or beside it, when it had to move). */
function Chip({ chip, className }: { chip: ChipBox; className: string }) {
  return (
    <g className={className}>
      <rect x={chip.cx - chip.w / 2} y={3} width={chip.w} height={TIER - 6} rx={(TIER - 6) / 2} />
      <text x={chip.cx} y={TIER / 2} textAnchor="middle">
        {chip.text}
      </text>
    </g>
  );
}
