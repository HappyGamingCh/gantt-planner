import type { KeyboardEvent, ReactNode } from 'react';
import { moveIndex } from './focus';

/** One option: its value, visible label, optional tooltip (`title`) and optional leading icon (aria-hidden, 14 px). */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  icon?: ReactNode;
}

/**
 * Segmented control (Plan | Track, zoom, look-ahead): one option is on. A radio group: one Tab stop (the option that
 * is on), and the arrow keys, Home and End pick the next option, as in a desktop radio group. Plan from Track still
 * asks first (§6). `className` replaces the default `segmented` (keep `segmented` in it, e.g. `segmented
 * segmented-mode`); `describedBy` points the group at a caption (the mode caption).
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className = 'segmented',
  describedBy,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  describedBy?: string;
}) {
  const tabStop = options.some((o) => o.value === value) ? value : options[0]?.value;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+↑/↓ moves the selected task
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const next = moveIndex(e.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    e.preventDefault();
    buttons[next]?.focus();
    if (option.value !== value) onChange(option.value);
  };
  return (
    <div className={className} role="radiogroup" aria-label={label} aria-describedby={describedBy} onKeyDown={onKeyDown}>
      {options.map((o) => (
        // title before role: the markup keeps `aria-checked="…" tabindex="…">Label<` (tests/ui/shell.test.ts)
        <button
          key={o.value}
          type="button"
          title={o.title}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === tabStop ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
