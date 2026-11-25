export type Stat = 'STR' | 'DEX' | 'INT' | 'WIS' | 'CHA';

/*
  Sigils: before the throw the player can draw the stat's sign with the die, in one stroke, anywhere
  on the board, at any size and from either end. A clean sign adds to the roll, a rough one adds less.
  Pure functions: the dice stage feeds in the stroke and draws the result.

  Everything about the mechanic that is still open (the shapes, when a check offers a sigil, the size
  of the bonus) is set in this file.
*/

export interface Pt {
  x: number;
  y: number;
}

const wave = (n: number, f: (t: number) => [number, number]) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** Each sign is one stroke in a unit box, y down. */
export const SIGIL_SHAPES: Record<Stat, [number, number][]> = {
  // the strike: a hard V
  STR: [
    [0.12, 0.12],
    [0.5, 0.92],
    [0.88, 0.12],
  ],
  // the bolt
  DEX: [
    [0.2, 0.9],
    [0.2, 0.12],
    [0.8, 0.88],
    [0.8, 0.1],
  ],
  // the triangle
  INT: [
    [0.5, 0.1],
    [0.12, 0.88],
    [0.88, 0.88],
    [0.5, 0.1],
  ],
  // the circle, from the top
  WIS: wave(40, (t) => [0.5 + 0.4 * Math.sin(2 * Math.PI * t), 0.5 - 0.4 * Math.cos(2 * Math.PI * t)]),
  // the serpent
  CHA: wave(40, (t) => [0.5 - 0.34 * Math.sin(2 * Math.PI * t), 0.92 - 0.84 * t]),
};

export const SIGIL = {
  /** Added to the roll for a clean sign, and for a rough one. */
  clean: 2,
  rough: 1,
  /** Mean distance to the ideal shape, in units of the drawing's own size: under `cleanFit` is clean. */
  cleanFit: 0.09,
  roughFit: 0.138,
  /** One go: only the last few seconds of movement can form the sign. */
  seconds: 3,
  /** Holding still this long (s) starts the stroke over. */
  stillSeconds: 0.4,
  /** Points each stroke is reduced to before comparing. */
  points: 32,
};

export type SigilBonus = 0 | typeof SIGIL.rough | typeof SIGIL.clean;

/**
 * The sign a check offers, or null for a plain throw. Every check offers its stat's sign for now;
 * when a check does is still to be decided, and this is the place to decide it.
 */
export function sigilFor(check: { stat: Stat }): Stat | null {
  return check.stat;
}

/** `n` points evenly spaced along the stroke. */
export function resample(pts: Pt[], n: number): Pt[] {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  const out: Pt[] = [];
  let i = 0,
    acc = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (i < seg.length - 1 && acc + seg[i] < d) acc += seg[i++];
    const f = seg[i] ? Math.max(0, Math.min(1, (d - acc) / seg[i])) : 0;
    const next = pts[Math.min(i + 1, pts.length - 1)];
    out.push({ x: pts[i].x + (next.x - pts[i].x) * f, y: pts[i].y + (next.y - pts[i].y) * f });
  }
  return out;
}

/** Centres the stroke on its bounding box and scales it by the box's longer side. */
export function fitBox(pts: Pt[]): { cx: number; cy: number; size: number; pts: Pt[] } {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    size = Math.max(x1 - x0, y1 - y0) || 1;
  return { cx, cy, size, pts: pts.map((q) => ({ x: (q.x - cx) / size, y: (q.y - cy) / size })) };
}

export interface SigilTemplate {
  /** The ideal shape, fitted to its box. */
  base: Pt[];
  /** Every way of drawing it that counts: both directions, and a loop from any point on itself. */
  variants: Pt[][];
}

function buildTemplate(shape: [number, number][]): SigilTemplate {
  const N = SIGIL.points;
  const base = fitBox(
    resample(
      shape.map(([x, y]) => ({ x, y })),
      N,
    ),
  ).pts;
  const closed = Math.hypot(base[0].x - base[N - 1].x, base[0].y - base[N - 1].y) < 0.06;
  const variants: Pt[][] = [];
  const add = (q: Pt[]) => {
    variants.push(q, q.slice().reverse());
  };
  add(base);
  if (closed)
    for (let sh = 4; sh < N - 1; sh += 4) {
      const ring = base.slice(0, N - 1),
        q = ring.slice(sh).concat(ring.slice(0, sh));
      q.push(q[0]);
      add(q);
    }
  return { base, variants };
}

const templates = new Map<Stat, SigilTemplate>();
export function sigilTemplate(stat: Stat): SigilTemplate {
  let t = templates.get(stat);
  if (!t) {
    t = buildTemplate(SIGIL_SHAPES[stat]);
    templates.set(stat, t);
  }
  return t;
}

/** Where a stroke sits and how far it is from the sign (0 is perfect). */
export interface SigilFit {
  score: number;
  cx: number;
  cy: number;
  size: number;
}

export function scoreSigil(path: Pt[], template: SigilTemplate): SigilFit {
  const N = SIGIL.points;
  const f = fitBox(resample(path, N));
  let best = Infinity;
  for (const v of template.variants) {
    let d = 0;
    for (let i = 0; i < N; i++) d += Math.hypot(f.pts[i].x - v[i].x, f.pts[i].y - v[i].y);
    best = Math.min(best, d / N);
  }
  return { score: best, cx: f.cx, cy: f.cy, size: f.size };
}

export const bonusForScore = (score: number): SigilBonus =>
  score < SIGIL.cleanFit ? SIGIL.clean : score < SIGIL.roughFit ? SIGIL.rough : 0;

/**
 * Looks for the sign in what has been drawn: the whole trail, and the trail with its beginning cut
 * off (a wander before the stroke doesn't count against the player). Drawings smaller than
 * `minSize` are too small to be meant. Returns the best bonus found, with where the sign sits.
 */
export function readSigil(trail: Pt[], stat: Stat, minSize: number): { bonus: SigilBonus; fit: SigilFit | null } {
  const m = trail.length;
  let bonus: SigilBonus = 0,
    fit: SigilFit | null = null;
  if (m < 8) return { bonus, fit };
  const template = sigilTemplate(stat);
  for (let k = 0; k < 8 && bonus < SIGIL.clean; k++) {
    const sub = trail.slice(Math.floor((m * k) / 11));
    if (sub.length < 8) break;
    const r = scoreSigil(sub, template);
    if (r.size < minSize) continue;
    const b = bonusForScore(r.score);
    if (b > bonus) {
      bonus = b;
      fit = r;
    }
  }
  return { bonus, fit };
}
