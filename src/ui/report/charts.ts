// Report charts (SPEC §9.2): Chart.js with animation off, drawn once at 2× and kept as PNG images, so the report
// prints sharp and never blank. Colours come from the report palette in config.ts.
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type ChartConfiguration,
  type Plugin,
} from 'chart.js';
import { REPORT_PALETTE as C } from '../../config';
import type { AssigneeSummary, ISODate, SCurvePoint } from '../../engine/types';
import { formatDayMonth, pctInt } from '../common/format';
import { sCurveChartPoints, shortLabel, statusDateSlot } from './reportData';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, BarController, BarElement, DoughnutController, ArcElement, Legend);
Chart.defaults.font.family = '"IBM Plex Sans", "IBM Plex Sans Thai", "Leelawadee UI", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = C.text;

/** Draws a chart on a canvas outside the view and returns it as a PNG data URL. */
export function chartImage(config: ChartConfiguration, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  canvas.width = width;
  canvas.height = height;
  document.body.append(canvas);
  const chart = new Chart(canvas, { ...config, options: { ...config.options, animation: false, responsive: false, devicePixelRatio: 2, events: [] } });
  const url = chart.toBase64Image('image/png');
  chart.destroy();
  canvas.remove();
  return url;
}

const percentAxis = { min: 0, max: 100, ticks: { stepSize: 25, callback: (v: string | number) => `${v}%` }, grid: { color: C.grid } };

/**
 * Dashed vertical line and label at the status date (a small plugin, no extra dependency). A status date before
 * the first or after the last point gets only an arrowed label at that edge, in the corner the lines leave empty.
 */
function statusDateLine(slot: number | 'before' | 'after' | null, label: string): Plugin<'line'> {
  return {
    id: 'statusDate',
    afterDatasetsDraw(chart) {
      if (slot === null) return;
      const { left, right, top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = C.statusDate;
      ctx.font = `600 11px ${Chart.defaults.font.family}`;
      if (slot === 'before') {
        ctx.textAlign = 'left';
        ctx.fillText(`← ${label}`, left + 4, top + 10);
      } else if (slot === 'after') {
        ctx.textAlign = 'right';
        ctx.fillText(`${label} →`, right - 4, bottom - 6);
      } else {
        const x = chart.scales.x!.getPixelForValue(slot);
        ctx.strokeStyle = C.statusDate;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.textAlign = x > right - 60 ? 'right' : 'left';
        ctx.fillText(label, x + (ctx.textAlign === 'left' ? 4 : -4), top + 10);
      }
      ctx.restore();
    },
  };
}

/**
 * S-curve (§9.3): planned, actual up to the status date, forecast after it; y 0–100 %, rising from a 0 % point the
 * day before the first one. Actual and Forecast are drawn over Planned (a lower `order` is drawn later) so an
 * on-plan curve stays visible; a series with no values is left out, so the legend lists only what is drawn.
 */
export function sCurveConfig(points: readonly SCurvePoint[], statusDate: ISODate, withProgress: boolean): ChartConfiguration<'line'> {
  const line = { pointRadius: 0, tension: 0, fill: false, spanGaps: false };
  const pts = sCurveChartPoints(points, statusDate);
  const datasets = [
    { ...line, label: 'Planned', order: 2, data: pts.map((p) => p.planned), borderColor: C.planned, borderWidth: 2 },
    ...(withProgress
      ? [
          { ...line, label: 'Actual', order: 0, data: pts.map((p) => p.actual), borderColor: C.actual, borderWidth: 2.5 },
          { ...line, label: 'Forecast', order: 1, data: pts.map((p) => p.forecast), borderColor: C.actual, borderWidth: 2, borderDash: [6, 4] },
        ]
      : []),
  ].filter((d) => d.data.some((v) => v !== null));
  return {
    type: 'line',
    data: { labels: pts.map((p) => formatDayMonth(p.date)), datasets },
    options: {
      layout: { padding: { top: 6, right: 8 } },
      scales: { y: percentAxis, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } } },
      // The legend keeps the data order (Planned · Actual · Forecast), not the drawing order.
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 18, boxHeight: 2, sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) } } },
    },
    plugins: [statusDateLine(statusDateSlot(pts, statusDate), `Status · ${formatDayMonth(statusDate)}`)],
  };
}

/** Status donut (§9.3): completed, in progress, not started; the late count in the middle. */
export function donutConfig(counts: { completed: number; inProgress: number; notStarted: number; late: number }): ChartConfiguration<'doughnut'> {
  const center: Plugin<'doughnut'> = {
    id: 'lateCount',
    afterDraw(chart) {
      const { left, right, top, bottom } = chart.chartArea;
      const [x, y] = [(left + right) / 2, (top + bottom) / 2];
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = counts.late > 0 ? C.late : C.text;
      ctx.font = `600 22px ${Chart.defaults.font.family}`;
      ctx.fillText(String(counts.late), x, y + 4);
      ctx.font = `12px ${Chart.defaults.font.family}`;
      ctx.fillText('late', x, y + 20);
      ctx.restore();
    },
  };
  return {
    type: 'doughnut',
    data: {
      labels: [`Completed ${counts.completed}`, `In progress ${counts.inProgress}`, `Not started ${counts.notStarted}`],
      // 2 px white gaps keep the slices apart on paper (the pale Not started slice is only 1.48:1 against white).
      datasets: [
        { data: [counts.completed, counts.inProgress, counts.notStarted], backgroundColor: [C.completed, C.inProgress, C.notStarted], borderWidth: 2, borderColor: C.separator },
      ],
    },
    options: { cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } },
    plugins: [center],
  };
}

/**
 * Planned % vs actual % per assignee (§9.3), horizontal grouped bars. Long names are shortened (the table above
 * has them in full) and every name is shown.
 */
export function assigneeBarsConfig(list: readonly AssigneeSummary[]): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels: list.map((a) => shortLabel(a.name)),
      datasets: [
        { label: 'Planned %', data: list.map((a) => pctInt(a.plannedPct)), backgroundColor: C.planned, barPercentage: 0.8, categoryPercentage: 0.7 },
        { label: 'Actual %', data: list.map((a) => pctInt(a.actualPct)), backgroundColor: C.actual, barPercentage: 0.8, categoryPercentage: 0.7 },
      ],
    },
    options: {
      indexAxis: 'y',
      scales: { x: percentAxis, y: { grid: { display: false }, ticks: { autoSkip: false } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
    },
  };
}
