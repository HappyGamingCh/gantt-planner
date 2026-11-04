import { ArrowRight, CirclePlay, FileDown, FilePlus, FileSpreadsheet, FolderOpen, Upload } from 'lucide-react';
import { askNewPlan, downloadTemplate, openPicked, openRecent, openSample } from '../../store/files';
import { useStore } from '../../store/store';
import { AppMark } from '../common/AppMark';
import { StartArt } from './StartArt';
import './EmptyState.css';

/** The three ways in. Each tile's title is its first text, so its accessible name and QA's `startsWith` stay the label. */
const TILES = [
  { id: 'open', Icon: FolderOpen, title: 'Open Excel plan', desc: 'Continue a plan saved in an .xlsx file', run: openPicked, primary: true },
  { id: 'new', Icon: FilePlus, title: 'New plan', desc: 'Start a blank plan from the template', run: askNewPlan, primary: false },
  { id: 'sample', Icon: CirclePlay, title: 'Try with sample data', desc: 'Explore a furnace turnaround', run: openSample, primary: false },
] as const;

/** Start screen (SPEC §7.10). */
export function EmptyState() {
  const recent = useStore((s) => s.recent);
  const busy = useStore((s) => s.busy);
  const opening = useStore((s) => s.opening);
  const fallback = useStore((s) => s.fallback);
  return (
    <div className="empty start">
      {fallback && <p className="banner">Your browser can't save directly to the file. Saving will download a new copy.</p>}
      <main className="empty-main">
        <section className="empty-zone" aria-labelledby="empty-title">
          <div className="empty-card start-card card">
            <div className="start-hero">
              <div className="start-copy">
                <p className="start-brand">
                  <AppMark className="app-mark start-brand-mark" />
                  Gantt Planner
                </p>
                <h1 id="empty-title">Plan and track your project on a Gantt chart</h1>
                <p className="empty-sub">Your data stays in your Excel file. Works offline.</p>
              </div>
              <StartArt />
            </div>
            <div className="start-tiles">
              {TILES.map(({ id, Icon, title, desc, run, primary }) => (
                <button
                  key={id}
                  type="button"
                  className={primary ? 'start-tile start-tile-primary' : 'start-tile'}
                  onClick={() => run()}
                  disabled={!!busy}
                  aria-labelledby={`tile-${id}`}
                  aria-describedby={`tile-${id}-desc`}
                >
                  <span className="start-tile-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="start-tile-title" id={`tile-${id}`}>
                    {title}
                  </span>
                  <span className="start-tile-desc" id={`tile-${id}-desc`}>
                    {desc}
                  </span>
                </button>
              ))}
            </div>
            {recent && (
              <button type="button" className="start-recent" onClick={openRecent} disabled={!!busy} title={recent.name}>
                <FileSpreadsheet size={16} aria-hidden="true" />
                <span className="start-recent-name">
                  Reopen <b>{recent.name}</b>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
            {busy === 'opening' && (
              <p className="empty-status" role="status">
                {opening ? `Opening ${opening}…` : 'Opening…'}
              </p>
            )}
          </div>
          <div className="start-hints">
            <p className="empty-drop">
              <Upload size={16} aria-hidden="true" />
              or drop an .xlsx file here
            </p>
            <span aria-hidden="true">·</span>
            <button type="button" className="btn-link" onClick={() => void downloadTemplate()}>
              <FileDown size={14} aria-hidden="true" />
              Download blank template
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
