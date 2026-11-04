// Dialogs (SPEC §3.5, §6, §7.10, §7.11, §8): file conflicts and errors, unsaved changes, the Plan-mode confirm,
// New plan, project settings, the confirmations of delete and renumber, and help.
import { confirmPlanMode, deleteTasks, renumber } from '../../store/edit';
import { discardChanges, downloadMyData, reload, save, saveAnyway, saveAs } from '../../store/files';
import { closeDialog, useStore } from '../../store/store';
import { NewPlanDialog } from '../empty/NewPlanDialog';
import { ProjectSettingsDialog } from '../header/ProjectSettingsDialog';
import { Dialog } from './Dialog';
import { AboutDialog, ShortcutsDialog } from './HelpDialogs';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const name = useStore((s) => s.file?.name ?? 'this file');
  const project = useStore((s) => s.plan?.project);
  const taskCount = useStore((s) => s.plan?.tasks.length ?? 0);
  if (!dialog) return null;
  const cancel = { label: 'Cancel', onClick: closeDialog };
  // Suggests "<name> (copy).xlsx"; if the open file is picked anyway, a toast says the plan was saved there (§3.5).
  const saveCopy = { label: 'Save a copy…', onClick: () => void saveAs({ copy: true }) };

  switch (dialog.kind) {
    case 'conflict':
      return (
        <Dialog
          title="File changed"
          onCancel={closeDialog}
          actions={[{ label: 'Reload file', onClick: () => void reload() }, { label: 'Overwrite', onClick: () => void save({ overwrite: true }) }, { ...cancel, primary: true }]}
        >
          <p>This file was changed outside Gantt Planner (for example in Excel) since you opened it.</p>
          <p>Reload file shows the file as it is now and drops your unsaved changes. Overwrite replaces it with your version.</p>
        </Dialog>
      );
    case 'failed':
      return (
        <Dialog title="Can't save" onCancel={closeDialog} actions={[{ label: 'Retry', onClick: () => void save(), primary: true }, saveCopy, cancel]}>
          <p>Can't save — the file is probably open in Excel. Close it in Excel, then click Retry.</p>
          <p className="dialog-detail">{dialog.detail}</p>
        </Dialog>
      );
    case 'missing':
      return (
        <Dialog title="Can't save" onCancel={closeDialog} actions={[{ ...saveCopy, primary: true }, cancel]}>
          <p>{name} was moved, renamed or deleted since you opened it. Save a copy to keep your changes.</p>
          <p className="dialog-detail">{dialog.detail}</p>
        </Dialog>
      );
    case 'unreadable':
      return (
        <Dialog title="Can't save" onCancel={closeDialog} actions={[{ label: 'Retry', onClick: () => void save(), primary: true }, saveCopy, cancel]}>
          <p>
            Couldn't read {name} to check for changes, so nothing was written. If the file is in OneDrive, check that it has synced and is
            available on this computer, then click Retry.
          </p>
          <p className="dialog-detail">{dialog.detail}</p>
        </Dialog>
      );
    case 'buildFailed':
      return (
        <Dialog
          title="Can't save"
          onCancel={closeDialog}
          actions={[
            {
              label: 'Download my data as .xlsx',
              onClick: () => {
                closeDialog();
                void downloadMyData();
              },
              primary: true,
            },
            cancel,
          ]}
        >
          <p>Gantt Planner couldn't prepare the workbook, so nothing was written to {name}. Download your data to keep your changes.</p>
          <p className="dialog-detail">{dialog.detail}</p>
        </Dialog>
      );
    case 'denied':
      return (
        <Dialog title="Can't save" onCancel={closeDialog} actions={[{ label: 'Try again', onClick: () => void save(), primary: true }, saveCopy, cancel]}>
          <p>Gantt Planner needs your permission to save changes to {name}.</p>
        </Dialog>
      );
    case 'unsupported':
      return (
        <Dialog
          title="Save over this file?"
          onCancel={closeDialog}
          actions={[{ ...saveCopy, primary: true }, { label: 'Save anyway', onClick: () => void saveAnyway() }, cancel]}
        >
          <p>
            Saving will remove {dialog.parts} from {name}. Gantt Planner can't keep them.
          </p>
        </Dialog>
      );
    case 'discard':
      return (
        <Dialog title="Discard unsaved changes?" onCancel={closeDialog} actions={[{ label: 'Discard changes', onClick: discardChanges }, { ...cancel, primary: true }]}>
          <p>Your changes to {name} haven't been saved.</p>
        </Dialog>
      );
    case 'planMode':
      return (
        <Dialog
          title="Switch to Plan mode?"
          onCancel={closeDialog}
          actions={[{ label: 'Switch to Plan', onClick: confirmPlanMode }, { label: 'Stay in Track', onClick: closeDialog, primary: true }]}
        >
          <p>Plan mode lets you change the baseline. The planned S-curve and variances will change.</p>
        </Dialog>
      );
    case 'newPlan':
      return <NewPlanDialog />;
    case 'projectSettings':
      return project ? <ProjectSettingsDialog project={project} /> : null;
    case 'delete': {
      const what = dialog.ids.length === 1 ? 'this task' : 'the selected tasks';
      const who = dialog.dependents === 1 ? '1 task depends' : `${dialog.dependents} tasks depend`;
      return (
        <Dialog title={dialog.ids.length === 1 ? 'Delete task?' : `Delete ${dialog.ids.length} tasks?`} onCancel={closeDialog} actions={[{ label: 'Delete', onClick: () => deleteTasks(dialog.ids, true) }, { ...cancel, primary: true }]}>
          <p>
            {who} on {what}. Their links will be removed.
          </p>
        </Dialog>
      );
    }
    case 'renumber':
      return (
        <Dialog title="Renumber IDs?" onCancel={closeDialog} actions={[{ label: 'Renumber', onClick: renumber, primary: true }, cancel]}>
          <p>Tasks get IDs 1 to {taskCount} in row order, and every predecessor reference is updated to match.</p>
        </Dialog>
      );
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'error': {
      const { action } = dialog;
      // An action (e.g. "Choose file…") runs inside this click, so it can open a file picker.
      const actions = action
        ? [
            {
              label: action.label,
              onClick: () => {
                closeDialog();
                action.run();
              },
              primary: true,
            },
            cancel,
          ]
        : [{ label: 'OK', onClick: closeDialog, primary: true }];
      return (
        <Dialog title={dialog.title} onCancel={closeDialog} actions={actions}>
          <p>{dialog.message}</p>
        </Dialog>
      );
    }
  }
}
