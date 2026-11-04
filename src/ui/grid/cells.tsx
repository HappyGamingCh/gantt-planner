// Grid cell parts (SPEC §7.7): assignee chips, status chip, progress bar. Also used by the Gantt tooltip.
import type { Status } from '../../engine/types';
import type { AssigneeInfo } from '../../store/selectors';
import { avatarTone } from '../common/contrast';
import { STATUS_LABEL, STATUS_SLUG } from '../common/status';
import { fitChipCount, initials } from './chips';

const AVATAR_W = 22;
/** A tag is its text plus border 1 + padding 4 + swatch 8 + gap 4 on the left, padding 5 + border 1 on the right (Grid.css `.tag`). */
const TAG_EXTRA = 23;

const widths = new Map<string, number>();
let canvas: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in the chips' font (`--fs-sm`), measured once its font has loaded; a rough guess if it can't be. */
function textWidth(text: string): number {
  const known = widths.get(text);
  if (known !== undefined) return known;
  try {
    canvas ??= document.createElement('canvas').getContext('2d');
    if (!canvas) return text.length * 7;
    const size = getComputedStyle(document.documentElement).getPropertyValue('--fs-sm').trim() || '12px';
    const font = `${size} ${getComputedStyle(document.body).fontFamily}`;
    canvas.font = font;
    const width = canvas.measureText(text).width;
    if (document.fonts.check(font, text)) widths.set(text, width);
    return width;
  } catch {
    return text.length * 7;
  }
}

/**
 * Person = round avatar with initials; team, contractor or unknown = neutral tag with a square swatch in the resource
 * colour, then the name (square, so it never reads as the round late dot). Up to `max`, then +N; with a `budget` (the
 * cell's inner width, px), only the chips that fit whole.
 */
export function AssigneeChips({ names, info, max = 2, budget }: { names: readonly string[]; info: Map<string, AssigneeInfo>; max?: number; budget?: number }) {
  const isPerson = (name: string) => info.get(name.trim().toLowerCase())?.type === 'Person';
  const count =
    budget === undefined
      ? Math.min(max, names.length)
      : fitChipCount(
          names.map((name) => (isPerson(name) ? AVATAR_W : textWidth(name) + TAG_EXTRA)),
          budget,
          { max, more: textWidth(`+${names.length}`) },
        );
  const shown = names.slice(0, count);
  return (
    <span className="chips" title={names.join(', ')}>
      {shown.map((name) => {
        const a = info.get(name.trim().toLowerCase());
        const color = a?.color ?? 'var(--idle)';
        const light = avatarTone(color) === 'light-bg';
        return a?.type === 'Person' ? (
          <span key={name} className={light ? 'avatar avatar-light' : 'avatar'} role="img" aria-label={name} style={{ background: light ? color : `color-mix(in srgb, ${color} 80%, black)` }}>
            {initials(name)}
          </span>
        ) : (
          <span key={name} className="tag">
            <span className="tag-swatch" style={{ background: color }} aria-hidden="true" />
            <span className="tag-name">{name}</span>
          </span>
        );
      })}
      {names.length > shown.length && <span className="chip-more">+{names.length - shown.length}</span>}
    </span>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return <span className={`status-chip st-${STATUS_SLUG[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ProgressCell({ progress, status }: { progress: number; status: Status }) {
  return (
    <span className="progress-cell">
      <span className="mini-bar" aria-hidden="true">
        <span className={`mini-fill st-${STATUS_SLUG[status]}`} style={{ width: `${progress}%` }} />
      </span>
      <span className="progress-pct">{progress}%</span>
    </span>
  );
}
