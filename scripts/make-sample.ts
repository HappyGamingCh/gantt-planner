// Writes samples/sample-project.xlsx and tests/fixtures/messy.xlsx (SPEC §13).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { workbookBytes } from '../src/excel/exceljs';
import { buildMessyWorkbook, sampleBytes } from './fixtures';

function write(path: string, bytes: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`Wrote ${path} (${bytes.length} bytes)`);
}

write('samples/sample-project.xlsx', await sampleBytes());
write('tests/fixtures/messy.xlsx', await workbookBytes(await buildMessyWorkbook()));
