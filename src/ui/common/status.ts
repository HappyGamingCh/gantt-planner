import type { Status } from '../../engine/types';

/** CSS suffix per status: bars, chips and mini bars share the status colours (SPEC §7.8). */
export const STATUS_SLUG: Record<Status, 'completed' | 'progress' | 'late' | 'idle'> = {
  Completed: 'completed',
  'In Progress': 'progress',
  Late: 'late',
  'Not Started': 'idle',
};

/** Labels in the grid and tooltips (SPEC §7.7). */
export const STATUS_LABEL: Record<Status, string> = {
  Completed: 'Completed',
  'In Progress': 'In progress',
  Late: 'Late',
  'Not Started': 'Not started',
};
