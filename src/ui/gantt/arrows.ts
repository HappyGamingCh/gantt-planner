// Dependency arrows (SPEC §7.8): elbow paths with rounded corners. Pure functions.
export interface Point {
  x: number;
  y: number;
}

export const LINK_GAP = 8; // horizontal run before turning (SPEC §7.8)
const RADIUS = 3;

/**
 * Path from a predecessor to a successor's start. FS leaves the bar end to the right, SS leaves the bar start to
 * the left; when the successor starts too early for a straight elbow, the line detours between the rows.
 */
export function linkPath(type: 'FS' | 'SS', from: Point, to: Point, rowHeight: number): string {
  let points: Point[];
  if (type === 'SS') {
    const x = Math.min(from.x, to.x) - LINK_GAP;
    points = [from, { x, y: from.y }, { x, y: to.y }, to];
  } else if (to.x >= from.x + 2 * LINK_GAP) {
    const x = from.x + LINK_GAP;
    points = [from, { x, y: from.y }, { x, y: to.y }, to];
  } else {
    const x1 = from.x + LINK_GAP;
    const x2 = to.x - LINK_GAP;
    const y = from.y + (to.y > from.y ? rowHeight / 2 : -rowHeight / 2);
    points = [from, { x: x1, y: from.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: to.y }, to];
  }
  return rounded(points);
}

/** Arrowhead pointing right, its tip at `to`. */
export function arrowHead(to: Point): string {
  return `M${r(to.x)},${r(to.y)} l-4,-3 v6 z`;
}

const r = (n: number) => Math.round(n * 10) / 10;

function rounded(points: Point[]): string {
  let d = `M${r(points[0]!.x)},${r(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, p, next] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const a = toward(p, prev, Math.min(RADIUS, dist(prev, p) / 2));
    const b = toward(p, next, Math.min(RADIUS, dist(p, next) / 2));
    d += ` L${r(a.x)},${r(a.y)} Q${r(p.x)},${r(p.y)} ${r(b.x)},${r(b.y)}`;
  }
  const last = points.at(-1)!;
  return `${d} L${r(last.x)},${r(last.y)}`;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function toward(from: Point, to: Point, length: number): Point {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * length) / d, y: from.y + ((to.y - from.y) * length) / d };
}
