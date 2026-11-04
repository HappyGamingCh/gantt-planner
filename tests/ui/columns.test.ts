import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, GRID_WIDTH } from '../../src/config';
import { autoGridWidth, columnsWidth, gridTemplate, OPTIONAL, visibleColumns } from '../../src/ui/grid/columns';

const plan = visibleColumns(DEFAULT_COLUMNS.Plan);
const track = visibleColumns(DEFAULT_COLUMNS.Track);

describe('grid columns — SPEC §6, §7.3, §7.7', () => {
  it('only the Task column takes spare width; its width is the minimum', () => {
    expect(gridTemplate(plan)).toBe('40px minmax(200px, 1fr) 116px 68px 96px 84px 96px');
  });

  it('the default columns of each mode fit a 1280–1440 px window', () => {
    expect(columnsWidth(plan)).toBe(700);
    expect(columnsWidth(track)).toBe(864);
    // 1280 px: every Plan column; Track through Variance (Status scrolls). 1440 px: every Track column.
    expect(autoGridWidth(columnsWidth(plan), 1280)).toBe(701);
    expect(autoGridWidth(columnsWidth(track), 1280)).toBe(768);
    expect(columnsWidth(track.filter((c) => c.key !== 'status'))).toBeLessThanOrEqual(768);
    expect(autoGridWidth(columnsWidth(track), 1440)).toBe(864);
  });

  it('a fitted grid stays within the splitter limits', () => {
    expect(autoGridWidth(84, 1280)).toBe(GRID_WIDTH.min);
    expect(autoGridWidth(2000, 2560)).toBe(GRID_WIDTH.max);
  });

  it('Remarks keep their line breaks: a multi-line editor', () => {
    expect(OPTIONAL.find((c) => c.key === 'remarks')?.editor).toBe('multiline');
  });
});
