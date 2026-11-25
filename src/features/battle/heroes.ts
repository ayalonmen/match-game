import type { Rune } from '../engine';
import kaelFace from './assets/kael.webp';
import kaelCut from './assets/kael-cut.webp';
import garranFace from './assets/garran.webp';
import garranCut from './assets/garran-cut.webp';
import maraFace from './assets/mara.webp';
import maraCut from './assets/mara-cut.webp';
import elinFace from './assets/elin.webp';
import elinCut from './assets/elin-cut.webp';

/** The four powers. Each hero's id names the power it carries. */
export type HeroId = 'kael' | 'garran' | 'mara' | 'elin';

export interface HeroDef {
  id: HeroId;
  name: string;
  /** The rune that charges this hero (rubies charge everyone). */
  rune: Rune;
  power: string;
  /** Portrait for the party bar, and the cutout that slides through the cut-in. */
  face: string;
  cut: string;
  /** Cut-in colours: light, and the dark edge of the band. */
  c1: string;
  c2: string;
  text: string;
}

/** The party: each hero charges from one rune; rubies charge everyone. Tap a full portrait to use the power (free). */
export const HEROES: HeroDef[] = [
  {
    id: 'kael',
    name: 'Kael',
    rune: 'blade',
    power: 'Battle Focus',
    face: kaelFace,
    cut: kaelCut,
    c1: '#e9d9b8',
    c2: '#5a1420',
    text: 'Every blade on the board strikes ×1.5, then a crossing slash',
  },
  {
    id: 'garran',
    name: 'Garran',
    rune: 'ward',
    power: 'Shield Wall',
    face: garranFace,
    cut: garranCut,
    c1: '#79c0ff',
    c2: '#0f2b52',
    text: '+20 armor, every foe waits one more turn',
  },
  {
    id: 'mara',
    name: 'Mara',
    rune: 'ember',
    power: 'Fire Volley',
    face: maraFace,
    cut: maraCut,
    c1: '#ff7a2e',
    c2: '#5a0f08',
    text: '6 burning arrows, the last one hits double',
  },
  {
    id: 'elin',
    name: 'Elin',
    rune: 'vial',
    power: 'Mending Herbs',
    face: elinFace,
    cut: elinCut,
    c1: '#7fe08f',
    c2: '#0f3a1c',
    text: 'Heals 30 and turns every skull into a vial',
  },
];

/** A host's changes to a hero: another name or other pictures (the power stays). */
export type PartyOverrides = Partial<Record<HeroId, Partial<Pick<HeroDef, 'name' | 'face' | 'cut'>>>>;

export function partyFor(overrides: PartyOverrides = {}): HeroDef[] {
  return HEROES.map((h) => ({ ...h, ...overrides[h.id] }));
}
