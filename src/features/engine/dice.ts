import { pick, type Rng } from './rng';
import type { Rune } from './board';

/** The four outcome tiers, as in the story game: a natural 20, a natural 1, success at or over the DC, fail. */
export type DieTier = 'crit' | 'success' | 'fail' | 'fumble';

export interface DieRoll {
  /** The first die, and the second when it rolls with advantage. */
  a: number;
  b: number | null;
  /** The die that counts. */
  roll: number;
  total: number;
  tier: DieTier;
}

/** d20 + bonus against the DC; the golden die rolls twice and keeps the best. Decided before it is thrown. */
export function rollD20(rng: Rng, opts: { advantage: boolean; bonus: number; dc: number }): DieRoll {
  const a = 1 + pick(rng, 20);
  const b = opts.advantage ? 1 + pick(rng, 20) : null;
  const roll = b == null ? a : Math.max(a, b);
  const total = roll + opts.bonus;
  const tier: DieTier = roll === 20 ? 'crit' : roll === 1 ? 'fumble' : total >= opts.dc ? 'success' : 'fail';
  return { a, b, roll, total, tier };
}

export interface DieRules {
  mult: number;
  crit: number;
  fumble: number;
}

/** The die's own hit: fail is a glancing roll x2, success roll x mult, a natural 20 a fixed big hit, a 1 nothing. */
export function dieDamage(roll: DieRoll, rules: DieRules): number {
  if (roll.tier === 'fumble') return 0;
  if (roll.tier === 'fail') return roll.roll * 2;
  if (roll.tier === 'success') return roll.roll * rules.mult;
  return rules.crit;
}

/** What a success (or a crit) adds, by the rune the die was forged from. */
export const DIE_POWER: Record<Rune, string> = {
  blade: 'Steel die: a second strike',
  ember: 'Fire die: burn',
  ruby: 'Ruby die: charge for the whole party',
  ward: 'Shield die: armor',
  vial: 'Vial die: healing',
};
