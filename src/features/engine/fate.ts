import { pick, type Rng } from './rng';
import { COLS, ROWS, key } from './board';

/*
  The dice (2026-11-26, Ayalon: "change the dice we roll to d10 and have it only with DMG ... the d20 should still
  have effects but lets have 3 effects for now that are more impactful").
  - A match of 4 forges a silver d10: tapped, it rolls 1-10 and strikes for that many times D10.mult (a 10 doubles).
  - A match of 5 forges the gold d20: thrown in 3D, every face carries one of three big fates, shown as its icon.
  Both are decided from the seeded RNG before anything moves.
*/

export const D10 = {
  /** Damage per pip. */
  mult: 8,
  /** A 10 strikes this many times harder. */
  crit: 2,
};

/** The d10's roll and its damage (`mult` per pip, default D10.mult). */
export function rollD10(rng: Rng, mult: number = D10.mult): { roll: number; dmg: number } {
  const roll = 1 + pick(rng, 10);
  return { roll, dmg: roll * mult * (roll === 10 ? D10.crit : 1) };
}

export type FateId = 'bladeStorm' | 'heroSurge' | 'tempest';

export interface Fate {
  id: FateId;
  name: string;
  /** What it does, for the banner. */
  text: string;
}

export const FATE = {
  /** Runes the tempest charges and sets off. */
  tempestRunes: 4,
};

export const FATES: Record<FateId, Fate> = {
  bladeStorm: { id: 'bladeStorm', name: 'Blade Storm', text: 'Every rune on the board turns to blades' },
  heroSurge: { id: 'heroSurge', name: 'Hero Surge', text: 'A random hero unleashes their power' },
  tempest: { id: 'tempest', name: 'Tempest', text: `${FATE.tempestRunes} runes charge with lightning and go off` },
};

export const FATE_IDS: FateId[] = ['bladeStorm', 'heroSurge', 'tempest'];

/** The fate on each face, 1 to 20, the given fates taking turns (all three: seven, seven and six faces). */
export function facesFor(fates: readonly FateId[] = FATE_IDS): FateId[] {
  const use = fates.length ? fates : FATE_IDS;
  return Array.from({ length: 20 }, (_, i) => use[i % use.length]);
}

/** The faces with all three fates. */
export const FACES: FateId[] = facesFor();

export interface FateRoll {
  /** The face that came up. */
  roll: number;
  fate: Fate;
  /** For Hero Surge: which hero (an index into the party), decided with the roll. */
  hero: number;
}

/** Throws the gold d20 (these faces) and reads its fate. All before anything moves. */
export function rollFate(rng: Rng, party = 4, faces: readonly FateId[] = FACES): FateRoll {
  const roll = 1 + pick(rng, 20);
  return { roll, fate: FATES[faces[roll - 1]], hero: pick(rng, party) };
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
export function spawnCharge(rng: Rng, onBoard: number, chance: number = LIGHTNING.chance): Charge | null {
  if (onBoard >= LIGHTNING.max) return null;
  if (rng() >= chance) return null;
  return rng() < 0.5 ? 'bolt' : 'storm';
}
