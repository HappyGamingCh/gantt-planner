// Tooltips that explain the KPI figures (SPEC §7.5): the inputs with two decimals, so the rounded numbers on the
// cards add up, and the schedule-state bands from config.
import { SCHEDULE_STATE_BANDS as BANDS } from '../../config';
import type { ProjectSummary } from '../../engine/types';
import { formatDateLong, formatPts, formatSigned } from '../common/format';

export interface TrackHints {
  progress: string;
  schedule: string;
  finish: string;
  tasks: string;
  time: string;
}

const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`;
const pts = (n: number) => `${formatSigned(n)} pts`;
/** Two decimals with a true minus sign: −3.45, +0.20, 0.00. */
const signed2 = (n: number) => {
  const text = Math.abs(n).toFixed(2);
  return text === '0.00' ? text : `${n > 0 ? '+' : '−'}${text}`;
};

/** One hint per Track-mode card. */
export function trackHints(s: ProjectSummary): TrackHints {
  const { completed, inProgress, notStarted, late } = s.counts;
  const [actual, planned] = [s.actualPct.toFixed(2), s.plannedPct.toFixed(2)];
  const finish = s.finishVariance === 0 ? 'on time' : `${days(Math.abs(s.finishVariance))} ${s.finishVariance > 0 ? 'late' : 'early'}`;
  return {
    progress: `Actual ${actual}% vs planned ${planned}% at the end of the status date. Every task counts equally; milestones are not counted.`,
    schedule: [
      `Variance = actual − planned = ${actual} − ${planned} = ${signed2(Number(actual) - Number(planned))}, shown as ${formatPts(s.variancePts)} (percentage points).`,
      `Ahead ≥ ${pts(BANDS.ahead)} · On track > ${pts(BANDS.onTrack)} · Slightly behind > ${pts(BANDS.slightlyBehind)} · otherwise Behind.`,
      `SPI (schedule performance index) = actual ÷ planned${s.spi === null ? '' : ` = ${s.spi.toFixed(2)}`}; below 1 means behind plan.`,
    ].join('\n'),
    finish: `Forecast finish ${formatDateLong(s.forecastFinish)} vs planned finish ${formatDateLong(s.plannedFinish)}: ${finish}.`,
    tasks: `${completed} completed · ${inProgress} in progress · ${late} late · ${notStarted} not started (milestones are not counted).`,
    time: `Working days from the planned start (${formatDateLong(s.plannedStart)}) to the status date, out of ${days(s.durationDays)} planned. Days in the Holidays sheet are skipped.`,
  };
}

export const PLAN_DURATION_HINT = 'Working days from the planned start to the planned finish. Days in the Holidays sheet are skipped.';
