// Report view (SPEC §9): full screen, route #report. Back, Print / Save as PDF, Options. Every printed page gets the
// header band and footer from CSS @page margin boxes; on screen each page shows the band itself.
import { ArrowLeft, Printer, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ComputeResult, Plan } from '../../engine/types';
import { rowsOf } from '../../store/selectors';
import { closeView, setReportOptions, useStore } from '../../store/store';
import { formatDateLong } from '../common/format';
import { Popover } from '../common/Popover';
import { Segmented } from '../common/Segmented';
import { useFontsReady } from '../common/useFontsReady';
import { AssigneesPage } from './AssigneesPage';
import { AttentionPage } from './AttentionPage';
import { GanttAppendix } from './GanttAppendix';
import { reportEmptyNote } from './reportData';
import { Page, PrintChrome } from './ReportPage';
import { SummaryPage } from './SummaryPage';
import './Report.css';

export function Report() {
  const plan = useStore((s) => s.plan);
  const result = useStore((s) => s.result);
  const fileName = useStore((s) => s.file?.name ?? '');
  const session = useStore((s) => s.session);
  if (!plan || !result) return null;
  // Keyed by session: another plan starts the report over ("Prepared by" = its own Owner).
  return <ReportView key={session} plan={plan} result={result} fileName={fileName} />;
}

function ReportView({ plan, result, fileName }: { plan: Plan; result: ComputeResult; fileName: string }) {
  const options = useStore((s) => s.report);
  const [preparedBy, setPreparedBy] = useState(plan.project.owner);
  const fontsReady = useFontsReady();
  const rows = useMemo(() => rowsOf(plan, result), [plan, result]);
  // §9.3: major tasks are not tasks in the pages' tables and counts; the Gantt appendix shows them as rows.
  const tasks = useMemo(() => rows.filter((row) => !row.r.summary), [rows]);
  const band = { title: plan.project.name, meta: `Status date ${formatDateLong(plan.project.statusDate)}${preparedBy.trim() ? ` · Prepared by ${preparedBy.trim()}` : ''}` };
  const emptyNote = reportEmptyNote(tasks.length, options);

  return (
    <div className="report">
      <PrintChrome left={band.title} right={band.meta} footer={`Gantt Planner · ${fileName}`} />
      <div className="report-toolbar">
        <button type="button" className="btn btn-quiet" onClick={closeView}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h1>Report</h1>
        <span className="toolbar-spacer" />
        <Popover
          label="Report options"
          button={
            <>
              <SlidersHorizontal size={16} aria-hidden="true" /> Options
            </>
          }
        >
          <div className="filter-panel report-options">
            <h4>Sections</h4>
            {(
              [
                ['summary', 'Summary'],
                ['assignees', 'Progress by assignee'],
                ['attention', 'Needs attention'],
                ['gantt', 'Gantt appendix'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={options[key]} onChange={() => setReportOptions({ [key]: !options[key] })} /> {label}
              </label>
            ))}
            <h4>Look-ahead</h4>
            <Segmented
              label="Look-ahead window"
              options={[
                { value: '3', label: '3 days' },
                { value: '7', label: '7 days' },
                { value: '14', label: '14 days' },
              ]}
              value={String(options.lookAheadDays) as '3' | '7' | '14'}
              onChange={(v) => setReportOptions({ lookAheadDays: Number(v) as 3 | 7 | 14 })}
            />
            <h4>Prepared by</h4>
            <input className="drawer-input" aria-label="Prepared by" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
          </div>
        </Popover>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!fontsReady || emptyNote !== null} title={emptyNote ?? undefined}>
          <Printer size={16} aria-hidden="true" /> Print / Save as PDF
        </button>
      </div>
      <div className="report-pages">
        {emptyNote !== null ? (
          <p className="report-blank" role="status">
            {emptyNote}
          </p>
        ) : (
          <>
            {!fontsReady && <p className="report-wait">Preparing charts…</p>}
            {fontsReady && options.summary && (
              <Page band={band}>
                <SummaryPage plan={plan} result={result} rows={tasks} days={options.lookAheadDays} />
              </Page>
            )}
            {fontsReady && options.assignees && (
              <Page band={band}>
                <AssigneesPage plan={plan} result={result} rows={tasks} />
              </Page>
            )}
            {options.attention && (
              <Page band={band}>
                <AttentionPage rows={tasks} statusDate={plan.project.statusDate} days={options.lookAheadDays} />
              </Page>
            )}
            {options.gantt && <GanttAppendix plan={plan} rows={rows} band={band} />}
          </>
        )}
      </div>
    </div>
  );
}
