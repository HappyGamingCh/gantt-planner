// Content ExcelJS drops when it writes a workbook (SPEC §3.5). Most is found by part name: zip entry names are
// stored uncompressed, so a byte search over the file is enough. The rest sits inside compressed XML parts, which
// are found through the zip's central directory and inflated with DecompressionStream (browser and Node alike).
import { SHEETS } from './schema';

const PARTS: readonly (readonly [prefix: string, label: string])[] = [
  ['xl/charts/', 'charts'],
  ['xl/chartsheets/', 'charts'],
  ['xl/pivotTables/', 'pivot tables'],
  ['xl/slicers/', 'slicers'],
  ['xl/timelines/', 'timelines'],
  ['xl/threadedComments/', 'threaded comments'],
  ['xl/ctrlProps/', 'form controls'],
  ['xl/activeX/', 'form controls'],
  ['xl/model/', 'a data model'],
  ['xl/externalLinks/', 'links to other workbooks'],
  ['xl/connections.xml', 'data connections'],
  ['xl/queryTables/', 'data connections'],
  ['xl/richData/', 'pictures in cells and data types'],
  ['xl/embeddings/', 'embedded objects'],
  ['docMetadata/', 'a sensitivity label'],
];

export interface FileScan {
  /** Labels of the content Save would remove, e.g. ['charts', 'pivot tables']. */
  unsupported: string[];
  /** Sheets Excel saved with a filter applied, on the sheet or in an Excel table: their hidden rows were hidden by the
   * filter. One on a sheet other than Tasks is also in `unsupported`. */
  filtered: string[];
}

/** What Save can't keep, from the file's bytes. Never throws: if a part can't be read, the part names still count. */
export async function scanFile(bytes: Uint8Array): Promise<FileScan> {
  const text = new TextDecoder('latin1').decode(bytes);
  const labels = PARTS.filter(([prefix]) => text.includes(prefix)).map(([, label]) => label);
  const filtered: string[] = [];
  try {
    const entries = zipEntries(bytes);
    const read = (name: string) => {
      const entry = entries.get(name);
      return entry ? entryText(bytes, entry) : Promise.resolve('');
    };
    for (const name of entries.keys()) {
      // Pictures (xdr:pic) survive; shapes, text boxes and connectors don't.
      if (/^xl\/drawings\/drawing\d+\.xml$/.test(name) && /<xdr:(sp|grpSp|cxnSp)[\s>]/.test(await read(name))) labels.push('text boxes and shapes');
    }
    /** A part's relationships (its `_rels/<name>.rels`), each target as a zip entry name. */
    const relationships = async (part: string) =>
      [...(await read(part.replace(/[^/]*$/, '_rels/$&.rels'))).matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
        const { Id = '', Type = '', Target = '' } = attributes(m[0]);
        return { id: Id, type: Type, target: partName(part, Target) };
      });
    const workbook = await read('xl/workbook.xml');
    const targets = new Map((await relationships('xl/workbook.xml')).map((r) => [r.id, r.target]));
    for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const a = attributes(tag);
      const target = targets.get(Object.entries(a).find(([key]) => key.endsWith(':id'))?.[1] ?? '');
      const xml = target ? await read(target) : '';
      // A filtered Excel table keeps its criteria in its own part (xl/tables/), not in the sheet's XML.
      const tableParts = target ? (await relationships(target)).filter((r) => r.type.endsWith('/table')) : [];
      const tables = await Promise.all(tableParts.map((r) => read(r.target)));
      if (/<x14:dataValidation[\s>]/.test(xml)) labels.push('drop-down lists that use another sheet');
      if (xml.includes('<x14:sparklineGroup')) labels.push('sparklines');
      // ISO date cells (t="d", written by some tools, never by Excel): ExcelJS reads 2026-10-30 as the number 2026.
      if (/<c\b[^>]*\bt=["']d["']/.test(xml)) labels.push('date cells in ISO format (written by another program)');
      if ((xml.match(/<hyperlink\b[^>]*>/g) ?? []).some((link) => !/\br:id=/.test(link))) labels.push('links to places in this workbook');
      if (xml.includes('<filterColumn') || /<sheetPr\b[^>]*\bfilterMode="(1|true)"/.test(xml) || tables.some((t) => t.includes('<filterColumn'))) {
        const name = a.name ?? '';
        filtered.push(name);
        // Save shows the rows a filter hid on Tasks (§4.8); on other sheets they stay hidden, with no filter to clear.
        if (name.toLowerCase() !== SHEETS.tasks.toLowerCase()) labels.push(`the filter on sheet "${name}" (rows it hid stay hidden)`);
      }
    }
    const names = changedNames(workbook);
    if (names.length > 0) labels.push(`named ranges (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})`);
    if ((await read('docProps/custom.xml')).includes('MSIP_Label')) labels.push('a sensitivity label');
  } catch {
    // Not a zip we can read: the part names found above still count.
  }
  return { unsupported: [...new Set(labels)], filtered };
}

/** `Sheet!$A$1` or `'My sheet'!$A$1:$B$9`: the only kind of defined name ExcelJS keeps as it is. */
const PLAIN_RANGE = /^('([^']|'')+'|[^'!()+\-*/&^=<>,\s]+)!\$[A-Z]{1,3}\$\d+(:\$[A-Z]{1,3}\$\d+)?$/i;

/**
 * Defined names ExcelJS drops or changes: formulas, constants, whole rows or columns, sheet scope. Excel's own
 * names (_xlnm.Print_Area, _xlnm._FilterDatabase, _xlfn.…), hidden names and broken (#REF!) ones are left out.
 */
function changedNames(workbook: string): string[] {
  const names: string[] = [];
  for (const [, tag, body] of workbook.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)) {
    const a = attributes(tag);
    const name = a.name ?? '';
    const value = unescapeXml(body);
    if (name.startsWith('_xl') || a.hidden === '1' || a.hidden === 'true' || value.includes('#REF!')) continue;
    const refs = value.match(/('([^']|'')*'|[^,'])+/g) ?? [];
    if (a.localSheetId !== undefined || refs.length === 0 || !refs.every((ref) => PLAIN_RANGE.test(ref))) names.push(name);
  }
  return names;
}

/** A relationship's target as a zip entry name: relative to the folder of `part`, or from the root. */
function partName(part: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const path = part.split('/').slice(0, -1);
  for (const step of target.split('/')) {
    if (step === '..') path.pop();
    else if (step !== '.') path.push(step);
  }
  return path.join('/');
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], unescapeXml(m[2] ?? m[3] ?? '')]));
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ENTITIES[e] ?? '');
}

interface ZipEntry {
  method: number; // 0 stored, 8 deflated
  size: number; // compressed
  local: number; // offset of the local header
}

/** The zip's central directory, which holds every entry's real size (local headers may leave it to a trailer). */
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  const entries = new Map<string, ZipEntry>();
  if (end < Math.max(0, bytes.length - 65557)) return entries;
  let p = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0 && view.getUint32(p, true) === 0x02014b50; n--) {
    const nameLength = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { method: view.getUint16(p + 10, true), size: view.getUint32(p + 20, true), local: view.getUint32(p + 42, true) });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

async function entryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const data = bytes.slice(start, start + entry.size);
  if (entry.method === 0) return new TextDecoder().decode(data);
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

/** 'charts', 'charts and slicers', 'charts, slicers and timelines'. */
export function listText(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
