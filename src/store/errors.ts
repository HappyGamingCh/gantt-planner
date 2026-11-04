// How the file actions (open, save) report a failure: the error dialog (SPEC §3.5, §10).
import { useStore } from './store';

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Name and message for a details line, e.g. "NotFoundError: A requested file or directory could not be found…". */
export const errorDetail = (err: unknown) => (err instanceof Error && err.name !== 'Error' ? `${err.name}: ${err.message}` : errorText(err));

export const showError = (title: string, message: string, action?: { label: string; run: () => void }) =>
  useStore.setState({ busy: null, dialog: { kind: 'error', title, message, action } });
