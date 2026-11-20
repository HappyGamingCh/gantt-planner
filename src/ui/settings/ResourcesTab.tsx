import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RESOURCE_PALETTE } from '../../config';
import type { Resource, Task } from '../../engine/types';
import { draftColor, nameProblem, tasksUsing, withoutDraft, type ResourceDraft } from '../../store/settings';
import { plural } from '../common/format';

const TYPES: readonly Resource['type'][] = ['Person', 'Team', 'Contractor'];

/**
 * Settings › Resources (SPEC §7.14): every assignee with its name, type, color and the number of tasks using it. A
 * name in use can't be removed; names are checked when Apply is pressed (`showProblems`).
 */
export function ResourcesTab({
  drafts,
  onDrafts,
  tasks,
  locked,
  showProblems,
  focus,
}: {
  drafts: readonly ResourceDraft[];
  onDrafts: (drafts: ResourceDraft[]) => void;
  tasks: readonly Task[];
  /** The Resources sheet has content but no Name header (§4.4). */
  locked: boolean;
  showProblems: boolean;
  /** A draft to put the cursor in (its id), with a counter so the same one can be asked again. */
  focus: { id: number; n: number } | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<number | null>(null); // the draft whose color palette is open
  useEffect(() => {
    if (focus) list.current?.querySelector<HTMLInputElement>(`[data-draft="${focus.id}"]`)?.focus();
  }, [focus]);
  if (locked) {
    return (
      <p className="settings-note">
        This file’s Resources sheet has no Name header in row 1, so its resources can’t be read or changed here. Rename the column with the names to
        “Name” in Excel and open the file again.
      </p>
    );
  }
  const set = (i: number, fields: Partial<ResourceDraft>) => onDrafts(drafts.map((d, j) => (j === i ? { ...d, ...fields } : d)));
  return (
    <fieldset className="settings-section">
      <legend>Resources ({drafts.length})</legend>
      {drafts.length === 0 && <p className="settings-hint">No resources yet. Names typed in Assigned are added here too.</p>}
      <ul ref={list} className="settings-list resource-list">
        {drafts.map((d, i) => {
          const used = tasksUsing(tasks, d.original);
          const problem = showProblems ? nameProblem(drafts, i) : null;
          const color = draftColor(drafts, i);
          const label = d.name.trim() || 'new resource';
          return (
            <li key={d.id}>
              <div className="resource-row">
                <button
                  type="button"
                  className="swatch-button"
                  style={{ background: color }}
                  aria-label={`Color of ${label}: ${color}`}
                  aria-expanded={open === d.id}
                  title="Color"
                  onClick={() => setOpen(open === d.id ? null : d.id)}
                />
                <input
                  className="settings-input resource-name"
                  data-draft={d.id}
                  value={d.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                  aria-label="Name"
                  aria-invalid={problem ? true : undefined}
                  placeholder="Name"
                />
                <select className="settings-input resource-type" value={d.type ?? ''} onChange={(e) => set(i, { type: (e.target.value || undefined) as Resource['type'] })} aria-label={`Type of ${label}`}>
                  <option value="">No type</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="resource-used">{used > 0 ? plural(used, 'task') : 'Unused'}</span>
                <button
                  type="button"
                  className="btn btn-icon btn-quiet"
                  aria-label={`Remove ${label}`}
                  title={used > 0 ? `Used by ${plural(used, 'task')}: remove it from them first` : 'Remove'}
                  aria-disabled={used > 0}
                  onClick={() => used === 0 && onDrafts(withoutDraft(drafts, i))}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              {problem && <p className="settings-error">{problem}</p>}
              {open === d.id && <Palette color={color} label={label} onPick={(c) => set(i, { color: c })} />}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const id = Math.max(-1, ...drafts.map((d) => d.id)) + 1;
          onDrafts([...drafts, { id, name: '' }]);
          requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>(`[data-draft="${id}"]`)?.focus());
        }}
      >
        <Plus size={16} aria-hidden="true" />
        Add resource
      </button>
    </fieldset>
  );
}

/** The resource palette (§7.2) and a custom color. */
function Palette({ color, label, onPick }: { color: string; label: string; onPick: (color: string) => void }) {
  return (
    <div className="resource-palette" role="group" aria-label={`Colors for ${label}`}>
      {RESOURCE_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch-button swatch-small"
          style={{ background: c }}
          aria-label={c}
          aria-pressed={c.toUpperCase() === color.toUpperCase()}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="resource-custom">
        Custom
        <input type="color" value={color.toLowerCase()} onChange={(e) => onPick(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}
