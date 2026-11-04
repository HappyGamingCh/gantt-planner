// The outline in the Task cell (SPEC §7.7): the slot that indents a row by its Level, and a major task's chevron.
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toggleCollapsed } from '../../store/outline';
import type { Row } from '../../store/selectors';
import { useStore } from '../../store/store';

/** Indent per Level below 1, px. Grid.css shows the slot only while the plan has major tasks (`.grid-outline`). */
export const LEVEL_INDENT = 16;

export function OutlineSlot({ row }: { row: Row }) {
  const { task, r } = row;
  return (
    <span className="outline-slot" style={{ marginLeft: (r.level - 1) * LEVEL_INDENT }}>
      {r.summary && <Chevron id={task.id} name={task.name} />}
    </span>
  );
}

/** ▸ / ▾: collapses or expands the major task; it neither selects the row nor starts a row drag. */
function Chevron({ id, name }: { id: number; name: string }) {
  const collapsed = useStore((s) => s.collapsed.includes(id));
  return (
    <button
      type="button"
      className="outline-toggle"
      tabIndex={-1}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name}`}
      title={collapsed ? 'Expand (Alt+Shift+=)' : 'Collapse (Alt+Shift+−)'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggleCollapsed(id);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}
