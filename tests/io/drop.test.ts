import { describe, expect, it } from 'vitest';
import { chooseDropped, droppedFile } from '../../src/io/fileAccess';

// Drag & drop (SPEC §3.5): which of the dropped items to open.
describe('chooseDropped', () => {
  it('the single .xlsx among the dropped items', () => {
    expect(chooseDropped(['plan.pdf', 'plan.xlsx'])).toEqual({ kind: 'one', index: 1 });
    expect(chooseDropped(['PLAN.XLSX'])).toEqual({ kind: 'one', index: 0 });
  });

  it('no workbook (other files, a folder, nothing) → none, with the names', () => {
    expect(chooseDropped(['report.pdf'])).toEqual({ kind: 'none', names: ['report.pdf'] });
    expect(chooseDropped(['Folder'])).toEqual({ kind: 'none', names: ['Folder'] });
    expect(chooseDropped(['old.xls', 'data.csv'])).toEqual({ kind: 'none', names: ['old.xls', 'data.csv'] });
    expect(chooseDropped([])).toEqual({ kind: 'none', names: [] });
  });

  it('several workbooks → many, with their names only', () => {
    expect(chooseDropped(['a.xlsx', 'notes.txt', 'b.XLSX'])).toEqual({ kind: 'many', names: ['a.xlsx', 'b.XLSX'] });
  });
});

/** A DataTransfer as a drop gives it: file items, no File System Access handles here. */
function transfer(files: File[]): DataTransfer {
  const items = files.map((file) => ({ kind: 'file', getAsFile: () => file }));
  return { items, files } as unknown as DataTransfer;
}

describe('droppedFile', () => {
  it('reads the workbook dropped together with its PDF report', async () => {
    const drop = droppedFile(transfer([new File(['pdf'], 'plan.pdf'), new File([new Uint8Array([1, 2])], 'plan.xlsx', { lastModified: 5 })]));
    expect(drop.kind).toBe('file');
    if (drop.kind !== 'file') return;
    expect(drop.name).toBe('plan.xlsx');
    const file = await drop.pending;
    expect(file).toMatchObject({ name: 'plan.xlsx', lastModified: 5 });
    expect([...new Uint8Array(file.bytes)]).toEqual([1, 2]);
    expect(file.handle).toBeUndefined();
  });

  it('nothing to open → says why without reading anything', () => {
    expect(droppedFile(transfer([new File(['x'], 'report.pdf')]))).toEqual({ kind: 'none', names: ['report.pdf'] });
    expect(droppedFile(transfer([new File(['x'], 'a.xlsx'), new File(['y'], 'b.xlsx')]))).toEqual({ kind: 'many', names: ['a.xlsx', 'b.xlsx'] });
  });
});
