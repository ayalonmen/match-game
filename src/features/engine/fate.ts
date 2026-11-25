import { pick, type Rng } from './rng';
import { COLS, ROWS, key } from './board';

/*
  The thrown die (2026-11-25, Ayalon: "have it with random effects"). A match of 4 forges a die, 5 a golden one that
  rolls twice and keeps the best. Thrown, its number picks a band and the band a random fate. Both are decided from
  the seeded RNG before the die leaves the hand.
*/

export type FateBand = 'backfire' | 'minor' | 'major' | 'epic' | 'legend';

export type FateId =
  | 'cracked'
  | 'hexEcho'
  | 'spark'
  | 'mend'
  | 'bulwark'
  | 'kindle'
  | 'rally'
  | 'chain'
  | 'firestorm'
  | 'transmute'
  | 'secondWind'
  | 'stagger'
  | 'meteor'
  | 'lance'
  | 'timeStop'
  | 'stormCall'
  | 'cataclysm';

export interface Fate {
  id: FateId;
  band: FateBand;
  name: string;
  /** What it does, for the banner. */
  text: string;
}

const F = (id: FateId, band: FateBand, name: string, text: string): Fate => ({ id, band, name, text });

/** Every fate by band. The numbers live in FATE below. */
export const FATES: Record<FateBand, Fate[]> = {
  backfire: [
    F('cracked', 'backfire', 'Cracked Die', 'The party takes 8 and two runes turn to skulls'),
    F('hexEcho', 'backfire', 'Hex Echo', 'Three runes turn to skulls'),
  ],
  minor: [
    F('spark', 'minor', 'Spark', 'A strike of three times the roll'),
    F('mend', 'minor', 'Mend', 'The party heals 15'),
    F('bulwark', 'minor', 'Bulwark', '+10 armor'),
    F('kindle', 'minor', 'Kindle', '2 burn on the foe'),
    F('rally', 'minor', 'Rally', '+20% charge to the whole party'),
  ],
  major: [
    F('chain', 'major', 'Chain Lightning', 'Lightning strikes five runes on the board'),
    F('firestorm', 'major', 'Firestorm', '4 burn and a strike of twice the roll'),
    F('transmute', 'major', 'Transmute', 'Six runes become the die’s rune'),
    F('secondWind', 'major', 'Second Wind', 'The party heals 35'),
    F('stagger', 'major', 'Stagger', 'The foe loses a turn, and a strike of three times the roll'),
  ],
  epic: [
    F('meteor', 'epic', 'Meteor', 'A 3×3 blast on the board and 60 damage'),
    F('lance', 'epic', 'Lightning Lance', 'A row and a column clear, and 50 damage'),
    F('timeStop', 'epic', 'Time Stop', 'Every foe waits two more turns, and 40 damage'),
    F('stormCall', 'epic', 'Storm Call', 'Three runes become lightning runes, and 40 damage'),
  ],
  legend: [F('cataclysm', 'legend', 'Cataclysm', 'Every rune of the commonest kind breaks, and 150 damage')],
};

/** The numbers of the fates. */
export const FATE = {
  crackedHurt: 8,
  crackedSkulls: 2,
  hexEchoSkulls: 3,
  sparkMult: 3,
  mend: 15,
  bulwark: 10,
  kindle: 2,
  rally: 20,
  chainRunes: 5,
  firestormBurn: 4,
  firestormMult: 2,
  transmuteRunes: 6,
  secondWind: 35,
  staggerMult: 3,
  meteor: 60,
  lance: 50,
  timeStopTurns: 2,
  timeStop: 40,
  stormCallRunes: 3,
  stormCall: 40,
  cataclysm: 150,
};

/** 1 backfires, 2-9 minor, 10-16 major, 17-19 epic, a natural 20 legendary. */
export function fateBand(roll: number): FateBand {
  return roll <= 1 ? 'backfire' : roll <= 9 ? 'minor' : roll <= 16 ? 'major' : roll <= 19 ? 'epic' : 'legend';
}

export interface FateRoll {
  /** The first die, and the second for a golden die. */
  a: number;
  b: number | null;
  /** The die that counts. */
  roll: number;
  fate: Fate;
  /** A cell on the board for a fate that aims somewhere (meteor, lance), else -1. */
  at: number;
}

/** Throws the die (golden: twice, keep the best) and picks its fate. All before anything moves. */
export function rollFate(rng: Rng, golden: boolean): FateRoll {
  const a = 1 + pick(rng, 20);
  const b = golden ? 1 + pick(rng, 20) : null;
  const roll = b == null ? a : Math.max(a, b);
  const pool = FATES[fateBand(roll)];
  const fate = pool[pick(rng, pool.length)];
  // meteors land away from the edges so the whole 3x3 is on the board
  const at =
    fate.id === 'meteor'
      ? key(1 + pick(rng, ROWS - 2), 1 + pick(rng, COLS - 2))
      : fate.id === 'lance'
        ? key(pick(rng, ROWS), pick(rng, COLS))
        : -1;
  return { a, b, roll, fate, at };
}

/* ---------- lightning runes ---------- */

/** A rune can spawn charged: a bolt clears its column, a storm the 3x3 around it, when it is matched. */
export type Charge = 'bolt' | 'storm';

export const LIGHTNING = {
  /** The chance a new rune falls in charged. */
  chance: 0.05,
  /** Most charged runes on the board at once. */
  max: 3,
};

/** The cells a charged rune clears (its own included). */
export function blastCells(charge: Charge, r: number, c: number): number[] {
  const out: number[] = [];
  if (charge === 'bolt') for (let rr = 0; rr < ROWS; rr++) out.push(key(rr, c));
  else
    for (let rr = r - 1; rr <= r + 1; rr++)
      for (let cc = c - 1; cc <= c + 1; cc++) if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) out.push(key(rr, cc));
  return out;
}

/** The row and the column through a cell (the lightning lance). */
export function crossCells(r: number, c: number): number[] {
  const out = new Set<number>();
  for (let cc = 0; cc < COLS; cc++) out.add(key(r, cc));
  for (let rr = 0; rr < ROWS; rr++) out.add(key(rr, c));
  return [...out];
}

/** A new rune's charge, if any, given how many charged runes are on the board already. */
export function spawnCharge(rng: Rng, onBoard: number): Charge | null {
  if (onBoard >= LIGHTNING.max) return null;
  if (rng() >= LIGHTNING.chance) return null;
  return rng() < 0.5 ? 'bolt' : 'storm';
}
