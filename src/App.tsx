import { Upload } from 'lucide-react';
import { useEffect } from 'react';
import { init } from './store/files';
import { syncView, useStore, viewOfHash } from './store/store';
import { BusyOverlay } from './ui/common/BusyOverlay';
import { Dialogs } from './ui/common/Dialogs';
import { ToastHost } from './ui/common/Toast';
import { useDocumentTitle } from './ui/common/documentTitle';
import { useDropToOpen, useShortcuts, useUnsavedGuard } from './ui/common/windowEvents';
import { EmptyState } from './ui/empty/EmptyState';
import { MainView } from './ui/main/MainView';
import { GanttPrint } from './ui/print/GanttPrint';
import { Report } from './ui/report/Report';

export function App() {
  const hasPlan = useStore((s) => s.plan !== null);
  const view = useStore((s) => s.view);
  const dragging = useDropToOpen();
  useShortcuts();
  useUnsavedGuard();
  useDocumentTitle();
  useEffect(() => {
    void init();
    // A reload on #report or #print has no plan to show: start from the main view.
    if (viewOfHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  return (
    <>
      {!hasPlan ? (
        <EmptyState />
      ) : (
        // The main view stays mounted under the report and Print Gantt, so Back finds the grid and Gantt as they were (§9.1).
        <>
          <MainView hidden={view !== 'main'} />
          {view === 'report' && <Report />}
          {view === 'print' && <GanttPrint />}
        </>
      )}
      <BusyOverlay />
      {dragging && (
        <div className="drop-overlay">
          <Upload size={24} aria-hidden="true" />
          Drop the .xlsx file to open it
        </div>
      )}
      <Dialogs />
      <ToastHost />
    </>
  );
}
