// The Problems list for the header badge and the Issues panel: both read it here, so their counts agree (§7.4, §7.11).
import { useMemo } from 'react';
import type { Issue } from '../../engine/types';
import { problems, type Problems } from '../../store/selectors';
import { useStore } from '../../store/store';
import { plural } from '../common/format';

export function useProblems(): Problems {
  const readIssues = useStore((s) => s.readIssues);
  const plan = useStore((s) => s.plan);
  const result = useStore((s) => s.result);
  const file = useStore((s) => s.file);
  const savedAt = useStore((s) => s.savedAt);
  return useMemo(() => problems({ readIssues, plan, result, file, savedAt }), [readIssues, plan, result, file, savedAt]);
}

/** "2 errors, 1 warning": the badge shows severity by colour, so its name and tooltip say it in words (§10). */
export function severityText(list: readonly Issue[]): string {
  const errors = list.filter((i) => i.severity === 'error').length;
  const warnings = list.filter((i) => i.severity === 'warning').length;
  return [errors > 0 ? plural(errors, 'error') : '', warnings > 0 ? plural(warnings, 'warning') : ''].filter(Boolean).join(', ');
}
