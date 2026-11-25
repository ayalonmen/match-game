/** Every number in a fight. The prototype's (approved 2026-11-25); difficulty scales the foes. */
export interface FoeRules {
  name: string;
  hp: number;
  /** Turns between her moves. */
  every: number;
  /** Damage of an attack. */
  dmg: number;
  /** Runes a Hex curses into skulls. */
  curse: number;
  /** Enraged at half health (Vexa only): her clock and her numbers then. */
  rageEvery: number;
  rageDmg: number;
  rageCurse: number;
}

export interface Rules {
  heroHp: number;
  blade: number;
  ember: number;
  ruby: number;
  ward: number;
  vial: number;
  armorCap: number;
  charge: number;
  rubyCharge: number;
  wallArmor: number;
  volley: number;
  volleyDmg: number;
  herbs: number;
  burnPerStack: number;
  comboStep: number;
  wardShield: number;
  focusMult: number;
  dieMult: number;
  dieCrit: number;
  dieFumble: number;
  dieBonus: number;
  dieDC: number;
  /** Vexa's two wards: the Ash Ward hits the party, the Hex Ward curses runes. */
  wards: boolean;
  foes: { left: FoeRules; vexa: FoeRules; right: FoeRules };
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';
/** Difficulty scales the foes' health and damage. */
export const DIFFICULTY: Record<Difficulty, { hp: number; dmg: number }> = {
  easy: { hp: 0.75, dmg: 0.8 },
  normal: { hp: 1, dmg: 1 },
  hard: { hp: 1.25, dmg: 1.15 },
  brutal: { hp: 1.5, dmg: 1.3 },
};

const foe = (f: Partial<FoeRules> & { name: string; hp: number; every: number }): FoeRules => ({
  dmg: 0,
  curse: 0,
  rageEvery: f.every,
  rageDmg: f.dmg ?? 0,
  rageCurse: f.curse ?? 0,
  ...f,
});

export interface RulesOptions {
  wards?: boolean;
  difficulty?: Difficulty;
  /** The enemy's name (default Vexa). */
  enemyName?: string;
}

export function rulesFor(opts: RulesOptions = {}): Rules {
  const wards = opts.wards ?? true;
  const d = DIFFICULTY[opts.difficulty ?? 'normal'];
  const name = opts.enemyName ?? 'Vexa';
  // With her wards she hits every 3 turns; alone she acts every 2, switching Soul Lash and Hex, and every turn enraged.
  const vexa = wards
    ? foe({ name, hp: 1000, every: 3, dmg: 18, rageEvery: 2, rageDmg: 22 })
    : foe({ name, hp: 1700, every: 2, dmg: 32, rageEvery: 1, rageDmg: 40, curse: 3, rageCurse: 4 });
  const scale = (f: FoeRules): FoeRules => ({
    ...f,
    hp: Math.round(f.hp * d.hp),
    dmg: Math.round(f.dmg * d.dmg),
    rageDmg: Math.round(f.rageDmg * d.dmg),
  });
  return {
    heroHp: 140,
    blade: 9,
    ember: 6,
    ruby: 4,
    ward: 2,
    vial: 2,
    armorCap: 20,
    charge: 7,
    rubyCharge: 4,
    wallArmor: 20,
    volley: 6,
    volleyDmg: 14,
    herbs: 30,
    burnPerStack: 4,
    comboStep: 0.25,
    wardShield: 0.25,
    focusMult: 1.5,
    dieMult: 4,
    dieCrit: 120,
    dieFumble: 8,
    dieBonus: 2,
    dieDC: 12,
    wards,
    foes: {
      left: scale(foe({ name: 'Ash Ward', hp: 140, every: 3, dmg: 14 })),
      vexa: scale(vexa),
      right: scale(foe({ name: 'Hex Ward', hp: 140, every: 3, curse: 3 })),
    },
  };
}

/** The story tier: a win with 60% of the party's health left is flawless; a loss with her over 75% is crushing. */
export type BattleTier = 'critSuccess' | 'success' | 'fail' | 'critFail';
export function battleTier(won: boolean, partyHpFrac: number, enemyHpFrac: number): BattleTier {
  if (won) return partyHpFrac >= 0.6 ? 'critSuccess' : 'success';
  return enemyHpFrac > 0.75 ? 'critFail' : 'fail';
}
