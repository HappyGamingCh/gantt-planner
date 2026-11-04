// Toolbar (SPEC §7.6): undo, redo; add, link, unlink, delete; outdent, indent, outline menu; zoom; search, filter,
// columns, density. Active filters show as chips below it.
import { ChevronsDownUp, ChevronsUpDown, Columns3, Funnel, Group, IndentDecrease, IndentIncrease, Link2, ListTree, Plus, Redo2, Rows3, Search, Trash2, Undo2, Ungroup, Unlink, X } from 'lucide-react';
import type { ColumnKey, Density, Zoom } from '../../config';
import type { ComputeResult, Plan, Status } from '../../engine/types';
import { addTask, deleteSelected, linkSelected, unlinkSelected } from '../../store/edit';
import { collapseAll, expandAll, groupSelected, indentSelected, outdentSelected, ungroupSelected } from '../../store/outline';
import { assigneeKey, assigneeNames, isFiltering, matches, rowsOf, shownSelection, type Row } from '../../store/selectors';
import { NO_FILTERS, setDensity, setFilters, setZoom, toggleColumn, useStore, type Filters } from '../../store/store';
import { redo, undo } from '../../store/undo';
import { plural } from '../common/format';
import { Menu } from '../common/Menu';
import { Popover } from '../common/Popover';
import { Segmented } from '../common/Segmented';
import { STATUS_LABEL } from '../common/status';
import { OPTIONAL } from '../grid/columns';
import './Toolbar.css';

const ZOOMS: readonly { value: Zoom; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'fit', label: 'Fit' },
];
// Late first: it is the filter used most (the KPI strip's "N late" sets it too).
const STATUSES: readonly Status[] = ['Late', 'In Progress', 'Not Started', 'Completed'];
const DENSITIES: readonly { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact rows' },
  { value: 'default', label: 'Default rows' },
  { value: 'comfortable', label: 'Comfortable rows' },
];

const toggled = <T,>(list: readonly T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function Toolbar({ plan }: { plan: Plan }) {
  const zoom = useStore((s) => s.zoom);
  const density = useStore((s) => s.density);
  const selected = useStore((s) => shownSelection(s).length); // rows hidden by the search or filters don't count
  const canUndo = useStore((s) => s.undo.length > 0);
  const canRedo = useStore((s) => s.redo.length > 0);
  const mode = plan.project.mode;
  return (
    <>
      <div className={`toolbar toolbar-${mode.toLowerCase()}`} role="group" aria-label="Tasks and view">
        {/* aria-disabled, not disabled: the last undo must not drop the keyboard focus to the page. undo() and redo()
            do nothing on an empty stack. */}
        <button type="button" className="btn btn-icon btn-quiet" onClick={undo} aria-disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-icon btn-quiet" onClick={redo} aria-disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button type="button" className="btn btn-primary" onClick={addTask} title="Add task (Ctrl+Enter)">
          <Plus size={16} aria-hidden="true" /> Add task
        </button>
        {mode === 'Plan' && (
          <>
            <button type="button" className="btn btn-quiet" onClick={linkSelected} disabled={selected < 2} aria-label="Link" title="Link the selected tasks in row order (Ctrl+L)">
              <Link2 size={16} aria-hidden="true" /> <span className="toolbar-label">Link</span>
            </button>
            <button type="button" className="btn btn-quiet" onClick={unlinkSelected} disabled={selected < 2} aria-label="Unlink" title="Remove the links among the selected tasks">
              <Unlink size={16} aria-hidden="true" /> <span className="toolbar-label">Unlink</span>
            </button>
          </>
        )}
        {/* The labels give way to the icons in a narrow window (Toolbar.css); aria-label keeps the name. */}
        <button type="button" className="btn btn-quiet" onClick={deleteSelected} disabled={selected === 0} aria-label="Delete" title="Delete the selected tasks (Ctrl+Delete)">
          <Trash2 size={16} aria-hidden="true" /> <span className="toolbar-label">Delete</span>
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <OutlineTools selected={selected} />
        <span className="toolbar-divider" aria-hidden="true" />
        <Segmented label="Zoom" options={ZOOMS} value={zoom} onChange={setZoom} />
        <span className="toolbar-spacer" />
        <SearchBox />
        <FilterButton plan={plan} />
        <Popover
          label="Columns"
          quiet
          title="Show or hide columns"
          button={
            <>
              <Columns3 size={16} aria-hidden="true" /> <span className="toolbar-label">Columns</span>
            </>
          }
        >
          <ColumnsPanel mode={mode} />
        </Popover>
        <Menu
          quiet
          label={`Row density: ${DENSITIES.find((d) => d.value === density)?.label ?? ''}`}
          icon={<Rows3 size={16} aria-hidden="true" />}
          items={DENSITIES.map((d) => ({ label: d.label, checked: d.value === density, onSelect: () => setDensity(d.value) }))}
        />
      </div>
      <FilterChips plan={plan} />
    </>
  );
}

/** §7.6 Outdent / Indent and the Outline menu (major tasks, §5.12). */
function OutlineTools({ selected }: { selected: number }) {
  const outlined = useStore((s) => s.result?.tasks.some((r) => r.level > 1) ?? false);
  return (
    <>
      <button type="button" className="btn btn-icon btn-quiet" onClick={outdentSelected} disabled={selected === 0} aria-label="Outdent" title="Outdent: one level up (Alt+Shift+←)">
        <IndentDecrease size={16} aria-hidden="true" />
      </button>
      <button type="button" className="btn btn-icon btn-quiet" onClick={indentSelected} disabled={selected === 0} aria-label="Indent" title="Indent: under the row above (Alt+Shift+→)">
        <IndentIncrease size={16} aria-hidden="true" />
      </button>
      <Menu
        label="Outline"
        quiet
        icon={<ListTree size={16} aria-hidden="true" />}
        items={[
          { label: 'Group selected tasks', icon: <Group size={16} aria-hidden="true" />, onSelect: groupSelected },
          { label: 'Ungroup', icon: <Ungroup size={16} aria-hidden="true" />, onSelect: ungroupSelected },
          ...(outlined
            ? (['separator', { label: 'Collapse all', icon: <ChevronsDownUp size={16} aria-hidden="true" />, onSelect: collapseAll }, { label: 'Expand all', icon: <ChevronsUpDown size={16} aria-hidden="true" />, onSelect: expandAll }] as const)
            : []),
        ]}
      />
    </>
  );
}

function SearchBox() {
  const text = useStore((s) => s.filters.text);
  return (
    <label className="search">
      <Search size={14} aria-hidden="true" />
      <input id="task-search" type="search" placeholder="Search" aria-label="Search tasks by name, assignee or ID (/)" value={text} onChange={(e) => setFilters({ text: e.target.value })} />
      {/* The "/" shortcut, shown while the box is empty and not focused (Toolbar.css) */}
      <kbd className="search-kbd" aria-hidden="true">
        /
      </kbd>
    </label>
  );
}

function FilterButton({ plan }: { plan: Plan }) {
  const filters = useStore((s) => s.filters);
  const count = filters.assignees.length + filters.statuses.length;
  return (
    <Popover
      label="Filter"
      quiet
      title="Filter by status or assignee"
      button={
        <>
          <Funnel size={16} aria-hidden="true" /> <span className="toolbar-label">Filter</span>
          {count > 0 && <span className="count-badge">{count}</span>}
        </>
      }
    >
      <div className="filter-panel">
        <h4>Status</h4>
        {STATUSES.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => setFilters({ statuses: toggled(filters.statuses, s) })} /> {STATUS_LABEL[s]}
          </label>
        ))}
        <h4>Assignee</h4>
        <div className="filter-names">
          {assigneeNames(plan).map((name) => (
            <label key={name} className="check">
              <input
                type="checkbox"
                checked={filters.assignees.includes(assigneeKey(name))}
                onChange={() => setFilters({ assignees: toggled(filters.assignees, assigneeKey(name)) })}
              />{' '}
              {name}
            </label>
          ))}
        </div>
        {count > 0 && (
          <button type="button" className="btn-link" onClick={() => setFilters({ assignees: [], statuses: [] })}>
            Clear filters
          </button>
        )}
      </div>
    </Popover>
  );
}

function ColumnsPanel({ mode }: { mode: 'Plan' | 'Track' }) {
  const shown = useStore((s) => s.columns[mode]);
  return (
    <div className="filter-panel">
      <h4>Columns in {mode} mode</h4>
      {OPTIONAL.map((c) => {
        const key = c.key as ColumnKey;
        return (
          <label key={key} className="check">
            <input type="checkbox" checked={shown.includes(key)} onChange={() => toggleColumn(mode, key)} /> {c.header(mode)}
          </label>
        );
      })}
    </div>
  );
}

/**
 * What a status chip adds after its name (§7.6): "3 tasks, 1 milestone" when milestones match it too, so the list
 * agrees with the KPI strip, which counts tasks only ("3 late" shows 4 rows). Counted over the rows all the filters
 * match; nothing when no milestone does.
 */
export function statusChipDetail(status: Status, rows: readonly Row[], filters: Filters): string | undefined {
  const matched = rows.filter((row) => !row.r.summary && row.r.status === status && matches(row, filters)); // major tasks aren't counted (§5.12)
  const milestones = matched.filter((row) => row.r.plannedDuration === 0).length;
  if (milestones === 0) return undefined;
  const tasks = matched.length - milestones;
  return [...(tasks > 0 ? [plural(tasks, 'task')] : []), plural(milestones, 'milestone')].join(', ');
}

function FilterChips({ plan }: { plan: Plan }) {
  const filters = useStore((s) => s.filters);
  const result = useStore((s) => s.result);
  return <ActiveFilters plan={plan} result={result} filters={filters} />;
}

/** Active filters as removable chips (§7.6); assignees as their names are written. */
export function ActiveFilters({ plan, result, filters }: { plan: Plan; result: ComputeResult | null; filters: Filters }) {
  if (!isFiltering(filters)) return null;
  const text = filters.text.trim();
  const names = new Map(assigneeNames(plan).map((n) => [assigneeKey(n), n]));
  const rows = result ? rowsOf(plan, result) : [];
  const chips: { key: string; label: string; detail?: string; clear: () => void }[] = [
    ...(text ? [{ key: 'text', label: `“${text}”`, clear: () => setFilters({ text: '' }) }] : []),
    ...filters.statuses.map((s) => ({
      key: `s:${s}`,
      label: STATUS_LABEL[s],
      detail: statusChipDetail(s, rows, filters),
      clear: () => setFilters({ statuses: filters.statuses.filter((x) => x !== s) }),
    })),
    ...filters.assignees.map((a) => ({ key: `a:${a}`, label: names.get(a) ?? a, clear: () => setFilters({ assignees: filters.assignees.filter((x) => x !== a) }) })),
  ];
  return (
    <div className="filter-chips" aria-label="Active filters">
      <span className="filter-chips-label">Showing</span>
      {chips.map((c) => (
        <span key={c.key} className="filter-chip">
          {c.label}
          {c.detail && <span className="filter-chip-detail">· {c.detail}</span>}
          <button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="btn-link" onClick={() => setFilters(NO_FILTERS)}>
        Show all tasks
      </button>
    </div>
  );
}
