import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// CLAUDE.md non-negotiable #2: src/engine is pure — no DOM, no React, no store, no local-time Date math.
const dir = join(import.meta.dirname, '../../src/engine');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

describe('engine purity', () => {
  it.each(files)('%s has no DOM, React or app-layer dependencies', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    expect(source).not.toMatch(/from ['"](react|react-dom)['"]/);
    expect(source).not.toMatch(/from ['"]\.\.\/(store|ui|io|excel)/);
    expect(source).not.toMatch(/\b(document|window|localStorage|indexedDB)\./);
    if (file !== 'dates.ts') expect(source).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
