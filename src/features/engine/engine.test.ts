import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  battleTier,
  createRng,
  dieDamage,
  findGroups,
  forgeFor,
  hasMoves,
  key,
  newBoard,
  rollD20,
  rulesFor,
  type TypeGrid,
} from './index';

const empty = (): TypeGrid =>
  Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => (['ward', 'vial'] as const)[(r + c) % 2]),
  );

describe('board', () => {
  it('a fresh board has no match and at least one move, and the same seed makes the same board', () => {
    const a = newBoard(createRng(7)),
      b = newBoard(createRng(7));
    expect(findGroups(a)).toHaveLength(0);
    expect(hasMoves(a)).toBe(true);
    expect(a).toEqual(b);
  });
  it('finds a row of three and a column of four', () => {
    const g = empty();
    g[0][0] = g[0][1] = g[0][2] = 'blade';
    g[2][5] = g[3][5] = g[4][5] = g[5][5] = 'ember';
    const groups = findGroups(g);
    expect(groups.map((x) => [x.t, x.cells.length, forgeFor(x)]).sort()).toEqual([
      ['blade', 3, null],
      ['ember', 4, 'd20'],
    ]);
  });
  it('joins an L of five into one group that forges a golden die', () => {
    const g = empty();
    g[0][0] = g[0][1] = g[0][2] = 'ruby';
    g[1][0] = g[2][0] = 'ruby';
    const [grp] = findGroups(g);
    expect(grp.cells.sort((x, y) => x - y)).toEqual([key(0, 0), key(0, 1), key(0, 2), key(1, 0), key(2, 0)]);
    expect(forgeFor(grp)).toBe('d20a');
  });
  it('skulls and dice never match', () => {
    const g = empty();
    g[0][0] = g[0][1] = g[0][2] = 'skull';
    g[1][0] = g[1][1] = g[1][2] = 'd20';
    expect(findGroups(g)).toHaveLength(0);
  });
});

describe('dice', () => {
  it('names the tiers like the story game', () => {
    let crit = 0,
      fumble = 0;
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const r = rollD20(rng, { advantage: false, bonus: 2, dc: 12 });
      if (r.roll === 20) {
        expect(r.tier).toBe('crit');
        crit++;
      } else if (r.roll === 1) {
        expect(r.tier).toBe('fumble');
        fumble++;
      } else expect(r.tier).toBe(r.total >= 12 ? 'success' : 'fail');
    }
    expect(crit).toBeGreaterThan(50);
    expect(fumble).toBeGreaterThan(50);
  });
  it('advantage keeps the better die', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const r = rollD20(rng, { advantage: true, bonus: 0, dc: 10 });
      expect(r.roll).toBe(Math.max(r.a, r.b!));
    }
  });
  it('damage by tier', () => {
    const rules = { mult: 4, crit: 120, fumble: 8 };
    const base = { a: 15, b: null, roll: 15, total: 17 };
    expect(dieDamage({ ...base, tier: 'success' }, rules)).toBe(60);
    expect(dieDamage({ ...base, tier: 'fail' }, rules)).toBe(30);
    expect(dieDamage({ ...base, tier: 'crit' }, rules)).toBe(120);
    expect(dieDamage({ ...base, tier: 'fumble' }, rules)).toBe(0);
  });
});

describe('rules', () => {
  it('solo Vexa is tougher and curses on her own; difficulty scales the foes', () => {
    const warded = rulesFor(),
      solo = rulesFor({ wards: false }),
      hard = rulesFor({ difficulty: 'hard' });
    expect(solo.foes.vexa.hp).toBeGreaterThan(warded.foes.vexa.hp);
    expect(solo.foes.vexa.curse).toBe(3);
    expect(warded.foes.vexa.curse).toBe(0);
    expect(hard.foes.vexa.hp).toBe(1250);
    expect(hard.heroHp).toBe(warded.heroHp);
  });
  it('story tiers', () => {
    expect(battleTier(true, 0.8, 0)).toBe('critSuccess');
    expect(battleTier(true, 0.3, 0)).toBe('success');
    expect(battleTier(false, 0, 0.5)).toBe('fail');
    expect(battleTier(false, 0, 0.9)).toBe('critFail');
  });
});

describe('thrown die and lightning runes', () => {
  it('bands by the number, and a golden die keeps the better of two', async () => {
    const { fateBand, rollFate } = await import('./fate');
    expect([1, 2, 9, 10, 16, 17, 19, 20].map(fateBand)).toEqual([
      'backfire',
      'minor',
      'minor',
      'major',
      'major',
      'epic',
      'epic',
      'legend',
    ]);
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const f = rollFate(rng, true);
      expect(f.roll).toBe(Math.max(f.a, f.b!));
      expect(f.fate.band).toBe(fateBand(f.roll));
      if (f.fate.id === 'meteor') {
        const r = Math.floor(f.at / COLS),
          c = f.at % COLS;
        expect(r > 0 && r < ROWS - 1 && c > 0 && c < COLS - 1).toBe(true);
      }
    }
  });
  it('a bolt clears its column, a storm the 3x3 around it (cut at the edges)', async () => {
    const { blastCells } = await import('./fate');
    expect(blastCells('bolt', 2, 3)).toEqual([0, 1, 2, 3, 4, 5].map((r) => key(r, 3)));
    expect(blastCells('storm', 2, 3)).toHaveLength(9);
    expect(blastCells('storm', 0, 0).sort((a, b) => a - b)).toEqual([key(0, 0), key(0, 1), key(1, 0), key(1, 1)]);
  });
  it('never spawns more than the cap', async () => {
    const { spawnCharge, LIGHTNING } = await import('./fate');
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) expect(spawnCharge(rng, LIGHTNING.max)).toBeNull();
  });
});
