// "Opening <file>…" over the plan on screen while another file opens (SPEC §7.11). The plan underneath is about to
// be replaced, so it takes no clicks or keys in the meantime.
import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';
import './BusyOverlay.css';

export function BusyOverlay() {
  const opening = useStore((s) => (s.plan && s.busy === 'opening' ? (s.opening ?? '') : null));
  return opening === null ? null : <Scrim name={opening} />;
}

/**
 * A key pressed under the scrim stops here, before the grid or the shortcuts see it. The app's shortcuts don't run,
 * so the browser's own don't either (Ctrl+S "Save page as", Ctrl+O, Ctrl+P), and Tab can't leave the scrim.
 */
export function swallowKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'stopPropagation' | 'preventDefault'>): void {
  e.stopPropagation();
  if (e.key === 'Tab' || e.ctrlKey || e.metaKey) e.preventDefault();
}

function Scrim({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The scrim takes the focus, and keys stop here.
    ref.current?.focus({ preventScroll: true });
    window.addEventListener('keydown', swallowKey, true);
    return () => window.removeEventListener('keydown', swallowKey, true);
  }, []);
  return (
    <div ref={ref} className="busy-overlay" role="status" tabIndex={-1}>
      <p className="busy-card">{name ? `Opening ${name}…` : 'Opening…'}</p>
    </div>
  );
}
