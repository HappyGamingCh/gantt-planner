// Help (SPEC §7.4, §7.12): the keyboard shortcuts overlay (`?` or More › Keyboard shortcuts) and About.
import { APP_VERSION } from '../../config';
import { closeDialog, useStore } from '../../store/store';
import { AppMark } from './AppMark';
import { Dialog } from './Dialog';

const KEYS: readonly [string[], string][] = [
  [['Ctrl+S'], 'Save'],
  [['Ctrl+Shift+S'], 'Save as…'],
  [['Ctrl+O'], 'Open'],
  [['Ctrl+P'], 'Print Gantt: the grid and Gantt as shown, to print or save as PDF'],
  [['Ctrl+Z'], 'Undo'],
  [['Ctrl+Y', 'Ctrl+Shift+Z'], 'Redo'],
  [['Ctrl+Enter'], 'Add a task below the selection'],
  [['Delete', 'Backspace'], 'Clear the cell'],
  [['Ctrl+Delete'], 'Delete the selected tasks (Delete does too on the ID cell or with several rows selected)'],
  [['Alt+↑', 'Alt+↓'], 'Move the selected task up or down (within its major task)'],
  [['Alt+Shift+→', 'Alt+Shift+←'], 'Indent / outdent the selected rows'],
  [['Alt+Shift+−', 'Alt+Shift+='], "Collapse / expand the selected row's major task"],
  [['Shift+↑', 'Shift+↓'], 'Select several tasks (for Link, Unlink, Delete)'],
  [['Enter', 'F2'], 'Edit the cell (on the ID or a calculated cell: open the task details); Enter again saves and moves down'],
  [['Shift+F2'], 'Open the task details'],
  [['Tab', 'Shift+Tab'], 'Move right or left (saves an edit); at the end of a row, leave the grid'],
  [['Ctrl+L'], 'Link the selected tasks (Plan mode)'],
  [['/'], 'Search'],
  [['Esc'], 'Close the drawer or popover, cancel an edit, or clear the active cell'],
  [['?'], 'Show these shortcuts'],
];

const MOUSE: readonly [string, string][] = [
  ['Ctrl+click, Shift+click', 'Select several tasks'],
  ['Double-click the ID, a calculated cell or a bar', 'Open the task details'],
  ['Drag a bar (Plan mode)', 'Move a task that has no predecessors'],
  ["Drag a bar's right end (Plan mode)", 'Change its duration'],
  ['Drag the divider between grid and chart', 'Resize the grid; double-click fits the columns'],
  ['Hold a row (or drag its grip) and drag up or down', 'Move it; left or right picks its level'],
  ['Click ▸ / ▾ before a major task', 'Collapse or expand it'],
];

/**
 * Keys, then Mouse, flowed into two balanced columns, so the list fits a 1280×720 laptop whatever the wording; past
 * that, only the list scrolls (title and Close stay).
 */
export function ShortcutsDialog() {
  return (
    <Dialog title="Keyboard shortcuts" className="dialog dialog-wide dialog-help" onCancel={closeDialog} actions={[{ label: 'Close', onClick: closeDialog, primary: true }]}>
      <div className="shortcuts-cols">
        <table className="shortcuts">
          <tbody>
            {KEYS.map(([keys, action]) => (
              <tr key={action}>
                <td>
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ' / '}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="shortcuts-head">Mouse</h3>
        <table className="shortcuts shortcuts-mouse">
          <tbody>
            {MOUSE.map(([gesture, action]) => (
              <tr key={gesture}>
                <td>{gesture}</td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog
      title="About Gantt Planner"
      onCancel={closeDialog}
      actions={[{ label: 'Keyboard shortcuts', onClick: () => useStore.setState({ dialog: { kind: 'shortcuts' } }) }, { label: 'Close', onClick: closeDialog, primary: true }]}
    >
      <p className="about-name">
        <AppMark /> Gantt Planner <span className="about-version">{APP_VERSION}</span>
      </p>
      <p>Plan and track a project on a Gantt chart. Your data stays in your Excel file: the app fills in the calculated values and writes to the file only when you save.</p>
      <p>Works offline. Nothing is sent anywhere: no network requests, no tracking.</p>
      <p className="about-credits">
        Built with React, ExcelJS, Chart.js, Zustand and Lucide icons (MIT and ISC licences). Fonts: IBM Plex Sans and IBM Plex Sans Thai (SIL Open Font
        License 1.1).
      </p>
    </Dialog>
  );
}
