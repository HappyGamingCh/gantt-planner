// Task grid (SPEC §7.7): the chosen columns, row selection (Ctrl/Shift for several) shared with the Gantt, an active
// cell moved with the arrow keys, and in-cell editing (Enter, F2, double-click or typing). Keys: gridKeys.ts.
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { ROW_HEIGHTS, type ColumnKey } from '../../config';
import type { Project, Task } from '../../engine/types';
import { editTask, readOnlyReason, type EditValue } from '../../store/edit';
import type { AssigneeInfo, Row } from '../../store/selectors';
import { openDrawer, select, showToast, useStore } from '../../store/store';
import { GRID_ID } from '../common/focus';
import { CellEditor, type Move } from './CellEditor';
import { gridTemplate, isCalcCell, STICKY_COLUMNS, visibleColumns, type Column } from './columns';
import { clearCell, gridKey, heldWhileEditing, keepActive, type GridCell as Cell, type HiddenCell } from './gridKeys';
import { DropLine, useRowDrag } from './rowDrag';
import './Grid.css';

interface Props {
  rows: Row[];
  tasks: readonly Task[];
  mode: Project['mode'];
  shown: readonly ColumnKey[];
  info: Map<string, AssigneeInfo>;
  suggestions: readonly string[];
  selection: number[];
}

export function Grid({ rows, tasks, mode, shown, info, suggestions, selection }: Props) {
  const columns = visibleColumns(shown);
  const [active, setActive] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<(Cell & { seed?: string; anchor: DOMRect }) | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const order = rows.map((row) => row.task.id);
  const offsets = columns.map((_, i) => columns.slice(0, i).reduce((x, c) => x + c.width, 0));
  const width = columns.reduce((x, c) => x + c.width, 0);
  // §7.7 outline: the slot that indents rows shows while the plan has major tasks, even when every one is collapsed.
  const outlined = useStore((s) => s.result?.tasks.some((r) => r.level > 1) ?? false);
  const rowHeight = ROW_HEIGHTS[useStore((s) => s.density)];
  const { drag, onPointerDown } = useRowDrag(rows, root, rowHeight);

  const cellEl = (cell: Cell) => root.current?.querySelector<HTMLElement>(`[data-row="${cell.id}"] [data-col="${cell.col}"]`) ?? null;
  const lockReason = (row: Row, c: Column) => (c.field ? readOnlyReason(c.field, row.task, row.r, mode) : null);
  // Screen readers follow the active cell through aria-activedescendant; focus stays on the grid (§10).
  const uid = useId();
  const cellId = (id: number, col: Column['key']) => `${uid}-${id}-${col}`;
  const activeDesc = active && !editing && order.includes(active.id) && columns.some((c) => c.key === active.col) ? cellId(active.id, active.col) : undefined;

  // Keep the active cell in view when it moves (clear of the sticky ID and Task columns: Grid.css).
  useEffect(() => {
    if (active && !editing) cellEl(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, editing]);

  // When the active row goes (deleted, hidden by the search) the keyboard stays in place: the row now there, same
  // column; a hidden row gets it back when shown again (gridKeys.ts).
  const lastRow = useRef(0);
  const hidden = useRef<HiddenCell | null>(null);
  useEffect(() => {
    const cols = columns.map((c) => c.key);
    const kept = keepActive(active, hidden.current, lastRow.current, order, cols, (id) => tasks.some((t) => t.id === id));
    hidden.current = kept.hidden;
    lastRow.current = kept.lastRow;
    if (kept.next !== undefined) setActive(kept.next);
  });

  // The active cell follows a selection made elsewhere (Gantt, Issues panel, drawer), so the keys carry on from there.
  const focusId = selection.at(-1);
  useEffect(() => {
    if (active && focusId !== undefined && focusId !== active.id && order.includes(focusId)) setActive({ id: focusId, col: active.col });
  }, [focusId]);

  const startEdit = (cell: Cell, seed?: string) => {
    const row = rows.find((r) => r.task.id === cell.id);
    const c = columns.find((col) => col.key === cell.col);
    const el = cellEl(cell);
    if (!row || !c || !el) return;
    if (!c.editor) return;
    const reason = lockReason(row, c); // the mode lock first, then "set by predecessors" for a linked Start
    if (reason) return showToast(reason);
    if (isCalcCell(row, c)) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the active cell may have been scrolled away (wheel)
    setEditing({ ...cell, seed, anchor: el.getBoundingClientRect() });
  };

  /** Enter, F2 or double-click: edit an editable cell, else open the task in the drawer (focused from the keyboard). */
  const activate = (cell: Cell, focus: boolean) => {
    const row = rows.find((r) => r.task.id === cell.id);
    const c = columns.find((col) => col.key === cell.col);
    if (!row || !c) return;
    if (c.editor && !isCalcCell(row, c)) startEdit(cell);
    else openDrawer(cell.id, { focus });
  };

  const moveTo = (rowIndex: number, colIndex: number, extend = false) => {
    const id = order[Math.max(0, Math.min(order.length - 1, rowIndex))];
    const col = columns[Math.max(0, Math.min(columns.length - 1, colIndex))];
    if (id === undefined || !col) return;
    setActive({ id, col: col.key });
    if (extend) select(id, 'range', order);
    else if (id !== active?.id) select(id);
  };

  const commit = (value: EditValue, move?: Move) => {
    if (!editing) return;
    const c = columns.find((col) => col.key === editing.col);
    if (c?.field && value !== undefined) editTask(editing.id, c.field, value); // undefined: nothing to save
    const [r, ci] = [order.indexOf(editing.id), columns.findIndex((col) => col.key === editing.col)];
    setEditing(null);
    if (move === 'down') moveTo(r + 1, ci);
    else if (move) moveTo(r, ci + (move === 'right' ? 1 : -1));
    if (move) return root.current?.focus({ preventScroll: true });
    // Left by a click or a shortcut: take focus back only if it went nowhere. A blur handler that moves focus makes
    // Chromium drop the user's click, and typing meant for Search or the drawer would then edit this task.
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) root.current?.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== root.current) return;
    if (editing) {
      if (heldWhileEditing(e)) e.preventDefault(); // the editor didn't get the focus: no shortcut acts on its task
      return;
    }
    const { drawerId, panel } = useStore.getState();
    const action = gridKey(e, {
      active: active && { row: order.indexOf(active.id), col: columns.findIndex((col) => col.key === active.col) },
      rows: order.length,
      cols: columns.length,
      focus: order.indexOf(focusId ?? -1),
      selected: !!active && selection.includes(active.id),
      count: selection.length,
      idCell: active?.col === 'id',
      overlay: drawerId !== null || panel !== null,
    });
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'move') moveTo(action.row, action.col, action.extend);
    else if (!active) return;
    else if (action.kind === 'open') activate(active, true);
    else if (action.kind === 'type') startEdit(active, action.seed);
    else if (action.kind === 'clear') clear(active);
    else setActive(null);
  };

  /** Delete / Backspace: blank the cell, as in Excel (§7.12). */
  const clear = (cell: Cell) => {
    const row = rows.find((r) => r.task.id === cell.id);
    const c = columns.find((col) => col.key === cell.col);
    if (row && c) clearCell(row, c, mode);
  };

  const onCellClick = (e: MouseEvent, row: Row, c: Column) => {
    setActive({ id: row.task.id, col: c.key });
    select(row.task.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only', order);
  };

  const cellStyle = (i: number): CSSProperties | undefined => (i < STICKY_COLUMNS ? { left: offsets[i] } : undefined);

  return (
    <div
      ref={root}
      id={GRID_ID}
      className={outlined ? 'grid grid-outline' : 'grid'}
      role="grid"
      aria-label="Tasks"
      aria-rowcount={rows.length + 1}
      aria-multiselectable="true"
      aria-activedescendant={activeDesc}
      tabIndex={0}
      style={{ width, gridTemplateColumns: gridTemplate(columns), '--sticky-w': `${offsets[STICKY_COLUMNS] ?? 0}px` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <div className="grid-head" role="row">
        {columns.map((c, i) => (
          <div key={c.key} role="columnheader" className={`cell${i < STICKY_COLUMNS ? ' cell-sticky' : ''}${c.align === 'right' ? ' cell-right' : ''}${c.className ? ` ${c.className}` : ''}`} style={cellStyle(i)}>
            {c.header(mode)}
          </div>
        ))}
      </div>
      {rows.map((row) => {
        const selected = selection.includes(row.task.id);
        const classes = ['grid-row', selected && 'selected', row.r.summary && 'row-summary', drag?.block.includes(row.task.id) && 'row-dragging'];
        return (
          <div key={row.task.id} data-row={row.task.id} role="row" aria-selected={selected} aria-level={outlined ? row.r.level : undefined} className={classes.filter(Boolean).join(' ')} onPointerDown={(e) => onPointerDown(e, row)}>
            {columns.map((c, i) => {
              const calc = isCalcCell(row, c);
              const reason = c.editor ? lockReason(row, c) : null;
              const locked = !calc && !!reason;
              const isActive = active?.id === row.task.id && active.col === c.key;
              const isEditing = editing?.id === row.task.id && editing.col === c.key;
              const classes = ['cell', i < STICKY_COLUMNS && 'cell-sticky', c.align === 'right' && 'cell-right', c.className, calc && 'cell-calc', locked && 'cell-locked', isActive && 'cell-active', isEditing && 'cell-editing'];
              return (
                <div
                  key={c.key}
                  id={cellId(row.task.id, c.key)}
                  data-col={c.key}
                  role="gridcell"
                  aria-readonly={calc || locked || !c.editor}
                  className={classes.filter(Boolean).join(' ')}
                  style={cellStyle(i)}
                  title={reason ?? (calc ? (row.r.summary ? 'Calculated from its tasks' : 'Calculated') : undefined)}
                  onClick={(e) => onCellClick(e, row, c)}
                  onDoubleClick={() => activate({ id: row.task.id, col: c.key }, false)}
                >
                  {isEditing && editing ? (
                    <CellEditor
                      column={c}
                      row={row}
                      seed={editing.seed}
                      anchor={editing.anchor}
                      tasks={tasks}
                      suggestions={suggestions}
                      onCommit={commit}
                      onCancel={() => {
                        setEditing(null);
                        root.current?.focus({ preventScroll: true });
                      }}
                    />
                  ) : (
                    c.render(row, info)
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {drag && <DropLine drag={drag} taskLeft={(offsets[1] ?? 0) + 8} />}
    </div>
  );
}
