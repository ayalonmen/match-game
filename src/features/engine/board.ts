import { pick, type Rng } from './rng';

export const COLS = 7;
export const ROWS = 6;

/** The five runes a match can be made of. */
export const RUNES = ['blade', 'ember', 'ward', 'vial', 'ruby'] as const;
export type Rune = (typeof RUNES)[number];
/** What can sit in a cell: a rune, a cursed skull, or a forged d20 (gold: rolls with advantage). */
export type CellType = Rune | 'skull' | 'd20' | 'd20a';
/** The board as types only: rows of columns, null for an empty cell. */
export type TypeGrid = (CellType | null)[][];

export const isRune = (t: CellType | null | undefined): t is Rune => !!t && (RUNES as readonly string[]).includes(t);
export const isDie = (t: CellType | null | undefined) => t === 'd20' || t === 'd20a';
export const key = (r: number, c: number) => r * COLS + c;
export const rc = (k: number): [number, number] => [Math.floor(k / COLS), k % COLS];

export interface Group {
  /** The rune of the match. */
  t: Rune;
  /** Every cell in it (keys); runs that cross (L and T shapes) join one group. */
  cells: number[];
  /** The longest straight run in it. */
  maxRun: number;
  longest: number[];
}

const at = (g: TypeGrid, r: number, c: number) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? g[r][c] : null);

/** Every match of three or more in a row or column. */
export function findGroups(g: TypeGrid): Group[] {
  const runs: { t: Rune; cells: number[] }[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS;) {
      const t = at(g, r, c);
      let e = c + 1;
      if (isRune(t)) while (e < COLS && at(g, r, e) === t) e++;
      if (isRune(t) && e - c >= 3) runs.push({ t, cells: Array.from({ length: e - c }, (_, i) => key(r, c + i)) });
      c = e;
    }
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS;) {
      const t = at(g, r, c);
      let e = r + 1;
      if (isRune(t)) while (e < ROWS && at(g, e, c) === t) e++;
      if (isRune(t) && e - r >= 3) runs.push({ t, cells: Array.from({ length: e - r }, (_, i) => key(r + i, c)) });
      r = e;
    }
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner: Record<number, number> = {};
  runs.forEach((run, i) =>
    run.cells.forEach((k) => {
      if (owner[k] != null) parent[find(i)] = find(owner[k]);
      else owner[k] = i;
    }),
  );
  const groups: Record<number, { t: Rune; cells: Set<number>; maxRun: number; longest: number[] }> = {};
  runs.forEach((run, i) => {
    const root = find(i);
    const gr = (groups[root] ??= { t: run.t, cells: new Set(), maxRun: 0, longest: [] });
    run.cells.forEach((k) => gr.cells.add(k));
    if (run.cells.length > gr.maxRun) {
      gr.maxRun = run.cells.length;
      gr.longest = run.cells;
    }
  });
  return Object.values(groups).map((x) => ({ ...x, cells: [...x.cells] }));
}

/** A 4 match forges a d20, a 5 match (or an L / T of five) a golden one; null for a plain match. */
export function forgeFor(group: Group): 'd20' | 'd20a' | null {
  if (group.maxRun >= 5 || group.cells.length >= 5) return 'd20a';
  if (group.maxRun >= 4) return 'd20';
  return null;
}

export function swapCells(g: TypeGrid, a: number, b: number) {
  const [r1, c1] = rc(a),
    [r2, c2] = rc(b);
  const t = g[r1][c1];
  g[r1][c1] = g[r2][c2];
  g[r2][c2] = t;
}

/** Is there a swap that makes a match (or a die to throw)? */
export function hasMoves(g: TypeGrid): boolean {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isDie(g[r][c])) return true;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const r2 = r + dr,
          c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        if (!isRune(g[r][c]) && !isRune(g[r2][c2])) continue;
        swapCells(g, key(r, c), key(r2, c2));
        const ok = findGroups(g).length > 0;
        swapCells(g, key(r, c), key(r2, c2));
        if (ok) return true;
      }
  return false;
}

/** A rune for this cell that doesn't finish a match with the two to its left or the two above. */
export function pickRune(g: TypeGrid, r: number, c: number, rng: Rng): Rune {
  for (let i = 0; i < 20; i++) {
    const t = RUNES[pick(rng, RUNES.length)];
    if (at(g, r, c - 1) === t && at(g, r, c - 2) === t) continue;
    if (at(g, r - 1, c) === t && at(g, r - 2, c) === t) continue;
    return t;
  }
  return RUNES[pick(rng, RUNES.length)];
}

/** A fresh board with no match on it and at least one move. */
export function newBoard(rng: Rng): TypeGrid {
  for (;;) {
    const g: TypeGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g[r][c] = pickRune(g, r, c, rng);
    if (hasMoves(g)) return g;
  }
}
