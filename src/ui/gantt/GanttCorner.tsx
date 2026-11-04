// Gantt header right corner (SPEC §7.6): Color by (Status / Assignee) and the Critical path toggle. It stays in the
// visible corner while the chart scrolls sideways, in the top (month) tier only, so day numbers, week labels and
// holidays are never covered.
import { Flag, Palette } from 'lucide-react';
import type { ColorBy } from '../../config';
import { setColorBy, toggleCritical, useStore } from '../../store/store';
import { Menu } from '../common/Menu';

/**
 * Px the corner covers at the timeline's right end: its two buttons and padding (≈ 114 px) plus the 12 px fade on its
 * left. Status and Today chips keep clear of it (layoutChips), at every zoom: whenever the chart is scrolled to its
 * end (always, at Fit) the corner sits over the chart's last pixels.
 */
export const CORNER_RESERVE = 126;

const COLOR_BY: readonly { value: ColorBy; label: string }[] = [
  { value: 'status', label: 'Color by status' },
  { value: 'assignee', label: 'Color by assignee' },
];

export function GanttCorner() {
  const colorBy = useStore((s) => s.colorBy);
  const critical = useStore((s) => s.critical);
  return (
    <div className="gantt-corner">
      <Menu
        label={colorBy === 'assignee' ? 'Color by: Assignee' : 'Color by: Status'}
        icon={<Palette size={13} aria-hidden="true" />}
        active={colorBy === 'assignee'}
        items={COLOR_BY.map((c) => ({ label: c.label, checked: c.value === colorBy, onSelect: () => setColorBy(c.value) }))}
      />
      <button type="button" className="btn btn-toggle" aria-pressed={critical} onClick={toggleCritical} title="Critical path: outline the tasks that drive the forecast finish">
        <Flag size={12} aria-hidden="true" /> Critical
      </button>
    </div>
  );
}
