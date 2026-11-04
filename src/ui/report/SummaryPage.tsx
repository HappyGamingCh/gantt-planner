// Report page 1 (SPEC §9.3): KPI row, S-curve, status donut, key messages.
import { useMemo } from 'react';
import type { ComputeResult, Plan } from '../../engine/types';
import type { Row } from '../../store/selectors';
import { TrackCards } from '../kpi/KpiStrip';
import '../kpi/KpiStrip.css';
import { chartImage, donutConfig, sCurveConfig } from './charts';
import { donut, keyMessages } from './reportData';

export function SummaryPage({ plan, result, rows, days }: { plan: Plan; result: ComputeResult; rows: Row[]; days: number }) {
  const sd = plan.project.statusDate;
  const progressReported = rows.some((row) => row.r.progress > 0 || row.r.actualStart !== undefined);
  const sCurve = useMemo(() => chartImage(sCurveConfig(result.sCurve, sd, progressReported), 660, 380), [result.sCurve, sd, progressReported]);
  const counts = useMemo(() => donut(rows), [rows]);
  const donutImage = useMemo(() => chartImage(donutConfig(counts), 320, 170), [counts]);
  return (
    <>
      <h2>Summary</h2>
      <section className="kpis report-kpis" aria-label="Key figures">
        <TrackCards result={result} />
      </section>
      <div className="summary-body">
        <figure className="report-chart">
          <figcaption>S-curve</figcaption>
          <img src={sCurve} width={660} height={380} alt="S-curve: planned, actual and forecast progress" />
          {!progressReported && <p className="chart-note">No progress reported yet</p>}
        </figure>
        <div className="summary-side">
          <figure className="report-chart">
            <figcaption>Tasks by status</figcaption>
            <img src={donutImage} width={320} height={170} alt={`${counts.completed} completed, ${counts.inProgress} in progress, ${counts.notStarted} not started, ${counts.late} late`} />
          </figure>
          <section className="key-messages">
            <h3>Key messages</h3>
            <ul>
              {keyMessages(result, rows, sd, days).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
