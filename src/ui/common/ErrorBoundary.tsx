// Top-level error boundary (SPEC §10): "Something went wrong" with Download my data as .xlsx, which writes the
// plan in memory to a new file. Nothing here writes to the open file.
import { TriangleAlert } from 'lucide-react';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { downloadMyData } from '../../store/files';
import { useStore } from '../../store/store';
import { useUnsavedGuard } from './windowEvents';
import '../empty/EmptyState.css';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Gantt Planner stopped', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error ? <Crashed error={error} onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}

function Crashed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const hasPlan = useStore((s) => s.plan !== null);
  const [failed, setFailed] = useState<string | null>(null);
  useUnsavedGuard();
  const download = () => {
    setFailed(null);
    downloadMyData().catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="empty">
      <main className="empty-main">
        <section className="empty-card card" role="alert" aria-labelledby="crash-title">
          <span className="crash-icon">
            <TriangleAlert size={20} aria-hidden="true" />
          </span>
          <h1 id="crash-title">Something went wrong</h1>
          <p className="empty-sub">
            {hasPlan ? 'Your plan is still here. Download it as a new Excel file before you reload; the file you opened is not changed.' : 'Reload the page to start again.'}
          </p>
          <div className="empty-actions">
            {hasPlan && (
              <button type="button" className="btn btn-primary" onClick={download}>
                Download my data as .xlsx
              </button>
            )}
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
          {failed && <p className="crash-failed">Couldn't create the file: {failed}</p>}
          <details className="crash-details">
            <summary>Error details</summary>
            <pre>{error.message}</pre>
          </details>
        </section>
      </main>
    </div>
  );
}
