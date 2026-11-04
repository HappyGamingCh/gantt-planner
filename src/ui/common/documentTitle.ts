// Browser tab title (§17): the open project, and in the report and Print Gantt the file name Chrome and Edge suggest
// for "Save as PDF" (they use the document title, which also becomes the PDF's title).
import { useEffect } from 'react';
import { todayISO, useStore, type State } from '../../store/store';

// Characters Windows doesn't allow in a file name, plus control characters.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** The longest start of `text` within `max` UTF-16 units that ends between graphemes, so Thai marks stay on their consonant. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return text.slice(0, end);
}

/** A name that is safe as a Windows file name: reserved characters become "-"; at most 80 characters, whole graphemes. */
export function safeFileName(name: string): string {
  return cut(name.replace(UNSAFE, '-').replace(/\s+/g, ' ').trim(), 80).trim() || 'Project';
}

/**
 * "Gantt Planner" with no plan; "<project> - Gantt Planner" (with "• " while unsaved) in the main view;
 * "<project> - Progress report <status date>" in the report, so weekly PDFs get dated, project-specific names;
 * in Print Gantt (§9.4) "<project> - Gantt plan <today>" (Plan mode) or "<project> - Gantt <status date>".
 */
export function documentTitle({
  name,
  statusDate,
  view,
  dirty,
  mode = 'Track',
  today = statusDate,
}: {
  name: string | null;
  statusDate: string;
  view: State['view'];
  dirty: boolean;
  mode?: 'Plan' | 'Track';
  today?: string;
}): string {
  if (name === null) return 'Gantt Planner';
  if (view === 'report') return `${safeFileName(name)} - Progress report ${statusDate}`;
  if (view === 'print') return mode === 'Plan' ? `${safeFileName(name)} - Gantt plan ${today}` : `${safeFileName(name)} - Gantt ${statusDate}`;
  return `${dirty ? '• ' : ''}${name.trim() ? `${name.trim()} - ` : ''}Gantt Planner`;
}

/** Keeps document.title in step with the open plan and the view; called once, in App. */
export function useDocumentTitle(): void {
  const name = useStore((s) => s.plan?.project.name ?? null);
  const statusDate = useStore((s) => s.plan?.project.statusDate ?? '');
  const view = useStore((s) => s.view);
  const dirty = useStore((s) => s.dirty);
  const mode = useStore((s) => s.plan?.project.mode ?? 'Track');
  useEffect(() => {
    document.title = documentTitle({ name, statusDate, view, dirty, mode, today: todayISO() });
  }, [name, statusDate, view, dirty, mode]);
}
