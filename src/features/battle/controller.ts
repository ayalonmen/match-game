// The fight itself: DOM tiles moved by GSAP, a canvas for the glow, and an async flow (swap -> matches and cascades ->
// the foes' turn). Ported from the approved prototype (docs/reference/ember-runes.src.html) with its numbers and timings.
// Game decisions (the board, new runes, curses, dice) come from the seeded RNG before anything animates; Math.random
// only places particles.
import gsap from 'gsap';
import {
  COLS,
  ROWS,
  RUNES,
  battleTier,
  createRng,
  findGroups as findTypeGroups,
  hasMoves as typeHasMoves,
  isRune,
  key,
  newBoard,
  pick,
  pickRune,
  rc,
  rollFate,
  rollD10,
  facesFor,
  type FateId,
  blastCells,
  spawnCharge,
  FATE,
  type BattleTier,
  type CellType,
  type Charge,
  type FateRoll,
  type FoeRules,
  type Group,
  type Rune,
  type Rules,
  type TypeGrid,
} from '../engine';
import type { HeroDef, HeroId } from './heroes';
import { DiceStage, synthSounds } from '../dice';
import { FATE_ICON, fateIconSvg } from './fate-icons';
import bladeImg from './assets/blade.webp';
import emberImg from './assets/ember.webp';
import wardImg from './assets/ward.webp';
import vialImg from './assets/vial.webp';
import rubyImg from './assets/ruby.webp';
import skullImg from './assets/skull.webp';
import hpFrameImg from './assets/ui/hp-frame.webp';
import hpFillImg from './assets/ui/hp-fill.webp';
import barFrameImg from './assets/ui/bar-frame.webp';
import boardFrameImg from './assets/ui/board-frame.webp';
import cardFrameImg from './assets/ui/card-frame.webp';
import cardOrbImg from './assets/ui/card-orb.webp';
import intentFrameImg from './assets/ui/intent-frame.webp';
import dieSilverImg from './assets/ui/die-silver.webp';
import dieGoldImg from './assets/ui/die-gold.webp';

const IMG: Record<Rune | 'skull', string> = {
  blade: bladeImg,
  ember: emberImg,
  ward: wardImg,
  vial: vialImg,
  ruby: rubyImg,
  skull: skullImg,
};

export interface BattleResult {
  outcome: 'win' | 'loss';
  tier: BattleTier;
  hpLeft: number;
  maxHp: number;
  moves: number;
  enemyHpLeft: number;
  enemyMaxHp: number;
}

export interface ControllerOptions {
  rules: Rules;
  heroes: HeroDef[];
  enemyName: string;
  enemyImage: string;
  /** A cutout of the whole enemy: she stands on the stage in place of the painting, scaled to fit. */
  enemyFigure?: string;
  /** The same cutout in her hurt mood, shown for a moment on each hit. */
  enemyFigureHurt?: string;
  /** The scene behind the figure, blurred and darkened (default: her painting). */
  stageImage?: string;
  /** The enemy card's picture (default: the figure, else her painting). The host's own art goes here. */
  cardImage?: string;
  /** Full body, or closer (cropped at the legs); auto picks closer when the stage is short. */
  figureFraming?: FigureFraming;
  seed: number;
  /** Show the how-to-play card with a Fight button first; otherwise the board deals in at once. */
  intro: boolean;
  introTitle: string;
  introSub: string;
  /** No sound (the host's own sound setting). */
  muted?: boolean;
  /** A buzz on phones (the host's haptics, or navigator.vibrate). */
  haptic: (pattern: number | number[]) => void;
  /** The silver d10's damage per pip (default D10.mult). */
  d10Damage?: number;
  /** The fates on the gold d20's faces (default all three). */
  d20Fates?: FateId[];
  /** The chance a new rune falls in charged with lightning, 0 to 1 (default LIGHTNING.chance; 0 is none). */
  lightningChance?: number;
  /** The test buttons: charge the whole party, restart. */
  devTools: boolean;
  allowRetry: boolean;
  mustWin: boolean;
  /** When set, the end card offers Continue. */
  hasContinue: boolean;
  onEnd: (r: BattleResult) => void;
  onContinue: (r: BattleResult) => void;
  /** The player closed the how-to-play card. */
  onTutorialEnd: () => void;
  /** A `performance.now()` time: the board waits for it before dealing in (the host's entrance plays first). */
  startAt?: number;
  /** Open on the enemy card (her art, name, health, clock, moves) before the fight, as Ember Wheels did. */
  introCard?: boolean;
  /** The line under her name on the card. */
  enemyTitle?: string;
  /** The card's speed (the host's entrance pace; 1 is as designed). */
  introPace?: number;
}

export interface BattleHandle {
  destroy(): void;
  /** For tests and the demo. */
  debug: {
    readonly state: State;
    readonly types: TypeGrid;
    playSwap(a: number, b: number): Promise<void>;
    rollDie(r: number, c: number, target?: Zone): Promise<void>;
    power(id: HeroId): Promise<void>;
    /** Puts a die (`d20`, `d20a`) or a charged rune (`bolt`, `storm`) on a cell. */
    place(r: number, c: number, what: Die | Charge): void;
  };
}

export type Zone = 'left' | 'vexa' | 'right';
export type FigureFraming = 'auto' | 'full' | 'close';
type Die = 'd20' | 'd20a';
interface Tile {
  id: number;
  type: CellType;
  el: HTMLDivElement;
  rune: Rune;
  /** A lightning rune: clears its column (bolt) or the 3x3 around it (storm) when matched. */
  charge?: Charge;
}
export interface Foe extends FoeRules {
  max: number;
  cd: number;
  burn: number;
  alive: boolean;
  enraged: boolean;
  next: 'lash' | 'hex';
}
export interface State {
  hp: number;
  maxHp: number;
  armor: number;
  charge: Record<HeroId, number>;
  moves: number;
  lock: Zone | null;
  busy: boolean;
  over: boolean;
  queue: [string, string][];
  foes: Record<Zone, Foe>;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  col: string;
  drag: number;
  grav: number;
  grow: number;
  ring?: boolean;
}
interface Slash {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bow: number;
  t: number;
  life: number;
  scale: number;
  glow: string;
}
/** A lightning bolt: a jagged path that re-forks every few frames while it fades. */
interface Bolt {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How far the path wanders, as a share of its length. */
  jag: number;
  /** Width of the strokes. */
  w: number;
  life: number;
  decay: number;
  forks: number;
  paths: [number, number][][];
  n: number;
}
/** A soft wash of light over part of the board (the column or the 3x3 a charged rune clears). */
interface Wash {
  x: number;
  y: number;
  w: number;
  h: number;
  life: number;
  decay: number;
}
interface Wall {
  t: number;
  life: number;
  y: number;
  fade?: boolean;
}
interface Orb {
  x: number;
  y: number;
  r: number;
  col: string;
  seed: number;
}
interface Arrow {
  t: number;
  big: boolean;
  trail: [number, number][];
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}
type Spawn = [number, Die, Rune];

const ZONES: Zone[] = ['left', 'vexa', 'right'];
const FIRE = ['rgba(255,170,60,1)', 'rgba(255,110,30,1)', 'rgba(255,220,120,1)', 'rgba(255,70,20,1)'];
const STEEL = ['rgba(220,235,255,1)', 'rgba(140,185,255,1)', 'rgba(255,230,170,1)'];
const COL: Record<Rune | 'skull', string[]> = {
  blade: STEEL,
  ember: FIRE,
  ruby: ['rgba(255,60,80,1)', 'rgba(255,150,170,1)', 'rgba(200,20,50,1)'],
  ward: ['rgba(120,190,255,1)', 'rgba(255,220,140,1)', 'rgba(200,230,255,1)'],
  vial: ['rgba(110,230,120,1)', 'rgba(200,255,160,1)', 'rgba(60,200,90,1)'],
  skull: ['rgba(170,90,255,1)', 'rgba(120,60,200,1)', 'rgba(220,170,255,1)'],
};
// a small lightning mark on a charged rune: a bolt between two arrows (column) or a bolt in a ring (area)
const RUNE_PLURAL: Record<Rune, string> = {
  blade: 'blades',
  ward: 'shields',
  ember: 'embers',
  vial: 'vials',
  ruby: 'rubies',
};
const CHARGE_BADGE: Record<Charge, string> = {
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l-3 4h2v3l-3 5h3l-2 6 6-8h-3l2-4h-2V5h2z" fill="#fff"/><path d="M12 23l-3-3h6z" fill="#cfefff"/></svg>',
  storm:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#cfefff" stroke-width="2"/><path d="M13 4l-5 9h3l-1 7 5-9h-3z" fill="#fff"/></svg>',
};
const esc = (t: string) =>
  t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
const isDie = (t: CellType | null): t is Die => t === 'd20' || t === 'd20a';
const strikes = (t: CellType): t is 'blade' | 'ember' | 'ruby' => t === 'blade' || t === 'ember' || t === 'ruby';
const num = (v: string | number) => Number(v);

function markup(o: ControllerOptions) {
  const E = esc(o.enemyName),
    F = o.rules.foes;
  const fig = o.enemyFigure;
  const figure = fig
    ? `<img class="er-backdrop" src="${esc(o.stageImage ?? o.enemyImage)}" alt="">
    <div class="er-floor"></div>
    <div class="er-aura"></div>
    <div class="er-fig"><div class="er-fig-body"><img class="er-fig-img" src="${esc(fig)}" alt="${E}">${
      o.enemyFigureHurt ? `<img class="er-fig-hurt" src="${esc(o.enemyFigureHurt)}" alt="">` : ''
    }<img class="er-fig-flash" src="${esc(fig)}" alt=""></div></div>`
    : `<img class="er-boss" src="${esc(o.enemyImage)}" alt="${E}">
    <div class="er-boss-flash"></div>`;
  return `<div class="er-app">
  <div class="er-stage${fig ? ' er-has-fig' : ''}">
    ${figure}
    <div class="er-shade"></div>
    <div class="er-bossbar${o.devTools ? '' : ' er-few-tools'}">
      <div class="er-hpbar er-vexa-bar" role="meter" aria-label="${E}'s health"><div class="er-hpch"><b></b><i style="background-image:url('${hpFillImg}')"></i></div><img class="er-hpfr" src="${hpFrameImg}" alt=""><span class="er-num"></span></div>
      <div class="er-row er-intent-row"><div class="er-next"><img class="er-next-fr" src="${intentFrameImg}" alt=""><span class="er-cd er-vexa-cd">3</span><div class="er-next-txt"><b class="er-next-name"></b><span class="er-intent"></span></div></div><span class="er-chip er-warded">Warded</span><span class="er-chip er-enraged" hidden>Enraged</span><span class="er-chip er-burn er-vexa-burn" hidden></span></div>
    </div>
    ${o.devTools ? '<div class="er-tools"><button class="er-charge-btn" aria-label="Charge the whole party (test)" title="Charge the party (test)">⚡</button><button class="er-restart-btn" aria-label="Restart fight">↻</button></div>' : ''}
    <div class="er-lockhint">Tap a ward or ${E} to aim every rune at it</div>
    <div class="er-lanes">
      <div class="er-vexa-mark" aria-label="Aim at ${E}"><div class="er-reticle"></div></div>
      <div class="er-pod" data-foe="left" aria-label="${esc(F.left.name)}"><div class="er-stone">ᚦ<span class="er-cd">3</span><span class="er-burnb"></span></div><div class="er-bar"><b></b><i></i></div><div class="er-label">${esc(F.left.name)}</div></div>
      <div class="er-pod" data-foe="right" aria-label="${esc(F.right.name)}"><div class="er-stone">ᛉ<span class="er-cd">4</span><span class="er-burnb"></span></div><div class="er-bar"><b></b><i></i></div><div class="er-label">${esc(F.right.name)}</div></div>
    </div>
  </div>
  <div class="er-combo-wrap"><div class="er-combo"></div></div>
  <div class="er-board-wrap"><img class="er-board-frame" src="${boardFrameImg}" alt=""><div class="er-board"><div class="er-slots"></div></div></div>
  <div class="er-hero">
    <div class="er-party-top"><span class="er-hero-name">Party</span><div class="er-bar er-hero-bar"><img class="er-barfr" src="${barFrameImg}" alt=""><div class="er-barch"><b></b><i></i></div><span class="er-num"></span></div><span class="er-armor"></span></div>
    <div class="er-party"></div>
  </div>
  <div class="er-dice"></div>
  <div class="er-throw-hint"></div>
  <div class="er-red-flash"></div>
  <div class="er-fx"></div>
  <canvas class="er-pfx"></canvas>
  <div class="er-aim"></div>
  <div class="er-cutin"><div class="er-dim"></div><div class="er-band"><div class="er-lines"></div></div><img class="er-cut-hero" alt=""><div class="er-title"></div><div class="er-who"></div><div class="er-flash"></div></div>
  <div class="er-banner"></div>
  <div class="er-overlay" hidden></div>
  <div class="er-foe" hidden>
    <div class="er-foe-art"><img class="er-foe-img" alt=""></div>
    <div class="er-foe-plate">
      <div class="er-f-eye">BLOCKS YOUR PATH</div>
      <div class="er-f-name"></div>
      <div class="er-f-title"></div>
      <div class="er-f-hp"><i></i><span></span></div>
      <div class="er-f-row">
        <div class="er-f-stat"><small class="er-f-s1"></small><b class="er-f-v1"></b></div>
        <div class="er-f-stat"><small>ACTS EVERY</small><b class="er-f-every"></b></div>
      </div>
      <div class="er-f-moves"></div>
      <div class="er-f-rage"></div>
    </div>
    <div class="er-f-skip">TAP TO SKIP</div>
  </div>
</div>`;
}

export function mountBattle(root: HTMLElement, o: ControllerOptions): BattleHandle {
  const N = o.rules,
    WARDS = N.wards,
    HEROES = o.heroes,
    E = esc(o.enemyName);
  const rng = createRng(o.seed);
  const rand = (n: number) => pick(rng, n); // game decisions
  const rnd = (n: number) => Math.floor(Math.random() * n); // looks only
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prevScale = gsap.globalTimeline.timeScale();
  if (reduce) gsap.globalTimeline.timeScale(3);

  root.classList.add('er-root');
  root.innerHTML = markup(o);
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T;
  const app = $('.er-app'),
    stage = $('.er-stage'),
    FIG = !!o.enemyFigure,
    boss = FIG ? $('.er-fig') : $('.er-boss'),
    bossFlash = FIG ? $('.er-fig-flash') : $('.er-boss-flash'),
    figImg = FIG ? $<HTMLImageElement>('.er-fig-img') : null,
    figHurt = root.querySelector<HTMLElement>('.er-fig-hurt'),
    bossbar = $('.er-bossbar'),
    boardWrap = $('.er-board-wrap'),
    boardFrame = $('.er-board-frame'),
    redFlash = $('.er-red-flash'),
    board = $('.er-board'),
    slots = $('.er-slots'),
    fx = $('.er-fx'),
    heroBox = $('.er-hero'),
    heroBar = $('.er-hero-bar'),
    aim = $('.er-aim'),
    overlay = $('.er-overlay'),
    lockhint = $('.er-lockhint');
  const pods: Record<Zone, HTMLElement> = {
    left: $('.er-pod[data-foe=left]'),
    right: $('.er-pod[data-foe=right]'),
    vexa: $('.er-vexa-mark'),
  };
  const muted = !!o.muted;
  let S!: State;
  let grid: (Tile | null)[][] = [];
  let s = 56,
    uid = 0,
    sel: number | null = null,
    dead = false;

  /* ---------- timers that stop with the fight ---------- */
  const timers = new Set<number>();
  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!dead) fn();
    }, ms);
    timers.add(id);
  }
  const wait = (ms: number) => new Promise<void>((r) => later(r, ms / (reduce ? 3 : 1)));
  const tw = (t: gsap.TweenTarget, v: gsap.TweenVars) =>
    new Promise<void>((r) => {
      gsap.to(t, {
        ...v,
        onComplete: () => {
          if (!dead) r();
        },
      });
    });

  /* ---------- sound (tiny synth) ---------- */
  let ac: AudioContext | null = null;
  function audio() {
    if (!ac) {
      try {
        const Ctx =
          window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) ac = new Ctx();
      } catch {
        ac = null;
      }
    }
    if (ac && ac.state === 'suspended') void ac.resume();
  }
  function tone(f: number, d = 0.12, type: OscillatorType = 'triangle', v = 0.12, slide = 0) {
    if (muted || !ac) return;
    const t = ac.currentTime,
      osc = ac.createOscillator(),
      g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + d);
  }
  /** A buzz; quick repeats (a combo's hits) fold into one so the phone doesn't rattle. */
  let lastBuzz = 0;
  function buzz(pattern: number | number[], force = false) {
    const now = performance.now();
    if (!force && now - lastBuzz < 90) return;
    lastBuzz = now;
    o.haptic(pattern);
  }
  function thud(v = 0.25) {
    if (muted || !ac) return;
    const t = ac.currentTime,
      len = 0.18,
      b = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate),
      d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ac.createBufferSource(),
      g = ac.createGain(),
      f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    src.buffer = b;
    g.gain.value = v;
    src.connect(f).connect(g).connect(ac.destination);
    src.start(t);
    tone(70, 0.2, 'sine', v * 0.8, 0.5);
  }

  /* ---------- helpers ---------- */
  const type = (r: number, c: number): CellType | null =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] ? grid[r][c]!.type : null;
  const tile = (r: number, c: number) => grid[r][c] as Tile;
  const types = (): TypeGrid => grid.map((row) => row.map((t) => (t ? t.type : null)));
  const findGroups = () => findTypeGroups(types());
  const hasMoves = () => typeHasMoves(types());
  /** The hero a rune charges, if they're in this fight. */
  const heroOf = (t: Rune) => HEROES.find((h) => h.rune === t);
  function appXY(el: Element): [number, number] {
    const a = app.getBoundingClientRect(),
      b = el.getBoundingClientRect();
    return [b.left - a.left + b.width / 2, b.top - a.top + b.height / 2];
  }
  function cellXY(r: number, c: number): [number, number] {
    const a = app.getBoundingClientRect(),
      b = board.getBoundingClientRect();
    return [b.left - a.left + (c + 0.5) * s, b.top - a.top + (r + 0.5) * s];
  }

  /* ---------- board ---------- */
  function dieHTML(t: Die, rune: Rune, size: number) {
    // Ayalon's die art (2026-11-26): silver for a match of 4, gold for the golden die of a match of 5
    return `<div class="er-die ${t === 'd20a' ? 'er-adv' : ''}" style="--s:${size}"><img class="er-die-img" src="${t === 'd20a' ? dieGoldImg : dieSilverImg}" alt=""><span class="er-dn">${t === 'd20a' ? '' : '10'}</span></div><img class="er-dr" src="${IMG[rune]}" alt="">`;
  }
  function makeTile(t: CellType, r: number, c: number, rune: Rune = 'ruby', charge?: Charge): Tile {
    const el = document.createElement('div');
    el.className = 'er-tile er-t-' + t + (charge ? ' er-charged er-ch-' + charge : '');
    el.style.width = el.style.height = s + 'px';
    if (isDie(t))
      el.innerHTML =
        // the silver d10 stays plain (Ayalon: "more simpler"); the gold d20 keeps its rays and halo
        (t === 'd20a' ? '<div class="er-rays"></div><div class="er-halo"></div>' : '') + dieHTML(t, rune, s);
    else
      el.innerHTML =
        (charge ? '<span class="er-zap"></span>' : '') +
        `<img src="${IMG[t]}" alt="">` +
        (charge ? `<span class="er-chg">${CHARGE_BADGE[charge]}</span>` : '');
    board.appendChild(el);
    gsap.set(el, { x: c * s, y: r * s });
    return { id: ++uid, type: t, el, rune, charge };
  }
  const chargedOnBoard = () => grid.reduce((n, row) => n + row.filter((t) => t?.charge).length, 0);
  /** Turns a rune on the board into a lightning rune (Storm Call). */
  function charge(r: number, c: number, ch: Charge) {
    const t = tile(r, c);
    t.el.remove();
    grid[r][c] = makeTile(t.type, r, c, t.rune, ch);
    gsap.from(grid[r][c]!.el, { scale: 1.6, opacity: 0, duration: 0.3 });
  }
  function buildBoard() {
    board.querySelectorAll('.er-tile').forEach((e) => e.remove());
    const g = newBoard(rng);
    grid = g.map((row, r) => row.map((t, c) => makeTile(t!, r, c)));
    gsap.set(board.querySelectorAll('.er-tile'), { opacity: 0 });
  }
  // rune landing: squash from the bottom, spring back, a puff of its colour after a long fall
  function land(el: HTMLElement, dist: number, t: CellType, r: number, c: number) {
    gsap
      .timeline()
      .set(el, { transformOrigin: '50% 100%' })
      .to(el, { scaleY: 0.78, scaleX: 1.16, duration: 0.07, ease: 'power1.out' })
      .to(el, { scaleY: 1, scaleX: 1, duration: 0.45, ease: 'elastic.out(1,0.35)' })
      .set(el, { transformOrigin: '50% 50%' });
    const C = t in COL ? COL[t as Rune | 'skull'] : null;
    if (dist >= 1.5 && C) {
      const [x, y] = cellXY(r, c);
      for (let i = 0; i < 4; i++)
        emit({
          x: x + (Math.random() - 0.5) * s * 0.7,
          y: y + s * 0.4,
          vx: (Math.random() - 0.5) * 2.2,
          vy: -0.6 - Math.random() * 0.8,
          drag: 0.9,
          decay: 0.06,
          size: 1.5 + Math.random() * 2,
          col: C[i % C.length],
        });
    }
  }
  // a falling rune: gravity (slow start, fast end), stretched while it falls
  function fall(el: HTMLElement, toY: number, dist: number, delay: number) {
    const dur = 0.13 + Math.sqrt(Math.max(0.2, dist)) * 0.12;
    gsap.fromTo(
      el,
      { scaleY: 1, scaleX: 1 },
      { scaleY: 1.08, scaleX: 0.95, duration: dur * 0.6, delay, ease: 'power1.in' },
    );
    return tw(el, { y: toY, duration: dur, delay, ease: 'power2.in' });
  }
  // the board deals in: slots light up from the middle, a gold line runs over the top, then the runes rain in column by column
  async function dealBoard() {
    const slotEls = [...slots.children];
    gsap.fromTo(
      slotEls,
      { opacity: 0, scale: 0.4 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.35,
        ease: 'back.out(2)',
        stagger: { each: 0.012, grid: [ROWS, COLS], from: 'center' },
      },
    );
    const b = board.getBoundingClientRect(),
      a = app.getBoundingClientRect();
    later(
      () =>
        slash(
          b.left - a.left,
          b.top - a.top + 2,
          b.right - a.left,
          b.top - a.top + 2,
          0,
          0.45,
          0.35,
          'rgba(255,190,90,0.55)',
          true,
        ),
      150,
    );
    tone(196, 0.5, 'triangle', 0.06, 2);
    await wait(320);
    const jobs: Promise<void>[] = [];
    for (let c = 0; c < COLS; c++)
      for (let r = ROWS - 1; r >= 0; r--) {
        const t = tile(r, c),
          start = -s * (1.2 + (ROWS - 1 - r) * 1.15),
          delay = c * 0.06 + (ROWS - 1 - r) * 0.05;
        gsap.set(t.el, { y: start, opacity: 1 });
        jobs.push(
          fall(t.el, r * s, (r * s - start) / s, delay).then(() => {
            land(t.el, 2, t.type, r, c);
            if (r === 0) tone(330 + c * 40, 0.05, 'sine', 0.05);
          }),
        );
      }
    await Promise.all(jobs);
  }
  function layout() {
    // The board frame art: the grid's place in it, and how far the visible frame reaches past the grid (in cells).
    const FR = { left: 89 / 1312, top: 119 / 1199, w: 1133 / 1312, h: 969 / 1199 };
    const visW = (1226 / 1133) * COLS,
      above = (59 / 969) * ROWS,
      below = (87 / 969) * ROWS;
    s = Math.floor(Math.min(app.clientWidth - 8, 480) / visW);
    // the stage keeps at least 30% of the screen (170px minimum) so the enemy stays in view
    const room = app.clientHeight - heroBox.offsetHeight - Math.max(170, app.clientHeight * 0.33);
    if (room < s * (ROWS + above + below)) s = Math.max(34, Math.floor(room / (ROWS + above + below)));
    board.style.width = s * COLS + 'px';
    board.style.height = s * ROWS + 'px';
    // the board sits low: its frame's top reaches into the stage's floor, and the party follows right under it
    boardWrap.style.paddingBottom = Math.round(s * below - 12) + 'px';
    boardWrap.style.marginTop = '0px';
    const fw = (s * COLS) / FR.w;
    boardFrame.style.width = fw + 'px';
    boardFrame.style.left = board.offsetLeft - FR.left * fw + 'px';
    boardFrame.style.top = board.offsetTop - FR.top * (fw * (1199 / 1312)) + 'px';
    slots.style.gridTemplateColumns = `repeat(${COLS},1fr)`;
    if (!slots.children.length) for (let i = 0; i < COLS * ROWS; i++) slots.appendChild(document.createElement('div'));
    const lanes = $('.er-lanes');
    lanes.style.width = s * COLS + 'px';
    lanes.style.marginLeft = -(s * COLS) / 2 + 'px';
    pods.left.style.left = s * 1 + 'px';
    pods.right.style.left = s * 6 + 'px';
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (t) {
          t.el.style.width = t.el.style.height = s + 'px';
          gsap.set(t.el, { x: c * s, y: r * s });
          const d = t.el.querySelector<HTMLElement>('.er-die');
          if (d) d.style.setProperty('--s', String(s));
        }
      }
    if (FIG) placeFigure();
  }
  // The figure stands under the enemy's bars: full body when the stage has room, else cropped at the legs.
  function placeFigure() {
    const hud = bossbar.offsetTop + bossbar.offsetHeight;
    const room = stage.clientHeight - hud;
    const close = o.figureFraming === 'close' || (o.figureFraming !== 'full' && room < 140);
    stage.classList.toggle('er-close', close);
    stage.style.setProperty('--hud', hud + 'px');
    if (!figImg || !figImg.naturalWidth) return;
    // Aim at her body: the tap target covers the visible part of the figure.
    const lanes = $('.er-lanes').getBoundingClientRect(),
      st = stage.getBoundingClientRect(),
      im = figImg.getBoundingClientRect();
    const top = Math.max(im.top, st.top + hud - 20),
      bottom = Math.min(im.bottom, st.bottom - 40);
    const h = Math.max(80, bottom - top),
      w = Math.max(110, Math.min(im.width * 0.8, 220));
    Object.assign(pods.vexa.style, {
      top: top - lanes.top + 'px',
      height: h + 'px',
      width: w + 'px',
      marginLeft: -w / 2 + 'px',
    });
  }
  figImg?.addEventListener('load', () => {
    if (!dead) layout();
  });
  function swapData(a: number, b: number) {
    const [r1, c1] = rc(a),
      [r2, c2] = rc(b);
    const t = grid[r1][c1];
    grid[r1][c1] = grid[r2][c2];
    grid[r2][c2] = t;
  }
  async function reshuffle() {
    banner('No moves', 'The runes reshape');
    await wait(600);
    do {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const t = grid[r][c];
          if (t && isRune(t.type)) {
            const nt = pickRune(types(), r, c, rng);
            if (nt !== t.type) {
              t.el.remove();
              grid[r][c] = makeTile(nt, r, c);
              gsap.from(tile(r, c).el, { scale: 0, duration: 0.3, delay: Math.random() * 0.2 });
            }
          }
        }
    } while (!hasMoves() || findGroups().length);
    await wait(400);
  }
  async function collapse() {
    const jobs: { t: Tile; r: number; c: number; dist: number; order: number }[] = [];
    for (let c = 0; c < COLS; c++) {
      let w = ROWS - 1,
        order = 0;
      for (let r = ROWS - 1; r >= 0; r--)
        if (grid[r][c]) {
          if (w !== r) {
            const t = tile(r, c);
            grid[w][c] = t;
            grid[r][c] = null;
            jobs.push({ t, r: w, c, dist: w - r, order: order++ });
          }
          w--;
        }
      for (let r = w; r >= 0; r--) {
        // new runes wait just above the board (it clips them) in a loose stack
        const t = makeTile(
            RUNES[rand(RUNES.length)],
            r,
            c,
            'ruby',
            spawnCharge(rng, chargedOnBoard(), o.lightningChance) ?? undefined,
          ),
          startY = (r - w - 1) * s * 1.12 - s * 0.15;
        gsap.set(t.el, { y: startY });
        grid[r][c] = t;
        jobs.push({ t, r, c, dist: (r * s - startY) / s, order: order++ });
      }
    }
    if (!jobs.length) return;
    const landed = new Set<number>();
    await Promise.all(
      jobs.map((j) =>
        fall(j.t.el, j.r * s, j.dist, j.order * 0.035 + j.c * 0.012).then(() => {
          land(j.t.el, j.dist, j.t.type, j.r, j.c);
          if (!landed.has(j.c)) {
            landed.add(j.c);
            tone(200 + j.c * 25, 0.05, 'sine', 0.04);
          }
        }),
      ),
    );
    await wait(90);
  }

  /* ---------- targets ---------- */
  function zone(c: number): Zone {
    if (S.lock && S.foes[S.lock].alive) return S.lock;
    const z: Zone = c <= 1 ? 'left' : c >= 5 ? 'right' : 'vexa';
    return S.foes[z].alive ? z : 'vexa';
  }
  const wardsUp = () => (S.foes.left.alive ? 1 : 0) + (S.foes.right.alive ? 1 : 0);
  const foeXY = (k: Zone) => (k === 'vexa' ? appXY(pods.vexa) : appXY(pods[k].querySelector('.er-stone')!));
  const liveFoe = (k: Zone) => S.foes[S.foes[k].alive ? k : 'vexa'];
  function float(text: string | number, cls: string, x: number, y: number) {
    const el = document.createElement('div');
    el.className = 'er-float er-f-' + cls;
    el.textContent = String(text);
    fx.appendChild(el);
    gsap.set(el, { x: x + (Math.random() * 30 - 15), y });
    gsap.fromTo(el, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, ease: 'back.out(2)' });
    gsap.to(el, {
      y: y - 46,
      opacity: 0,
      duration: 0.7,
      delay: 0.45,
      ease: 'power1.in',
      onComplete: () => el.remove(),
    });
  }
  function hit(k: Zone, amt: number, cls = 'dmg') {
    let f = S.foes[k];
    if (!f.alive) {
      k = 'vexa';
      f = S.foes.vexa;
    }
    if (k === 'vexa') amt *= 1 - N.wardShield * wardsUp();
    amt = Math.max(1, Math.round(amt));
    f.hp = Math.max(0, f.hp - amt);
    const [x, y] = foeXY(k);
    float(amt, cls, x, y - 10);
    const tgt = k === 'vexa' ? boss : pods[k].querySelector('.er-stone')!;
    if (k === 'vexa' && FIG) {
      // A figure recoils with her whole body, flashes red and shows her hurt face for a moment.
      gsap.fromTo(boss, { x: 9, rotation: 2.5 }, { x: 0, rotation: 0, duration: 0.55, ease: 'elastic.out(1,.4)' });
      gsap.fromTo(bossFlash, { opacity: 0.8 }, { opacity: 0, duration: 0.35 });
      if (figHurt) gsap.fromTo(figHurt, { opacity: 1 }, { opacity: 0, duration: 0.25, delay: 0.45 });
    } else gsap.fromTo(tgt, { x: -5 }, { x: 0, duration: 0.25, ease: 'elastic.out(1,.3)' });
    if (k === 'vexa' && !FIG) gsap.fromTo(bossFlash, { opacity: 0.55 }, { opacity: 0, duration: 0.3 });
    thud(cls === 'crit' ? 0.4 : 0.18);
    buzz(cls === 'crit' ? 28 : 10);
    if (f.hp <= 0 && k !== 'vexa') breakWard(k);
    if (k === 'vexa' && !f.enraged && f.hp > 0 && f.hp <= f.max / 2) {
      f.enraged = true;
      f.every = N.foes.vexa.rageEvery;
      f.cd = Math.min(f.cd, f.every);
      S.queue.push([`${E} enraged`, f.every === 1 ? 'She strikes every turn' : `She strikes every ${f.every} turns`]);
    }
    render();
  }
  function breakWard(k: Zone) {
    const f = S.foes[k];
    f.alive = false;
    f.burn = 0;
    if (S.lock === k) S.lock = null;
    S.foes.vexa.cd += 1;
    gsap.fromTo(pods[k].querySelector('.er-stone'), { scale: 1.4 }, { scale: 1, duration: 0.5, ease: 'power2.out' });
    pods[k].classList.add('er-broken');
    S.queue.push([esc(f.name) + ' shattered', `${E} is exposed · her next attack is delayed`]);
    tone(880, 0.4, 'sawtooth', 0.08, 0.3);
    buzz([20, 40, 45], true);
  }
  async function flushBanners() {
    while (S.queue.length) {
      const [a, b] = S.queue.shift()!;
      banner(a, b);
      await wait(1100);
    }
  }
  function banner(a: string, b = '') {
    const el = $('.er-banner');
    el.innerHTML = a + (b ? `<small>${b}</small>` : '');
    gsap.killTweensOf(el);
    gsap.fromTo(el, { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2)' });
    gsap.to(el, { opacity: 0, duration: 0.3, delay: 1 });
  }
  function showCombo(n: number, m: number) {
    const el = $('.er-combo');
    el.textContent = `Combo ${n} · ×${m.toFixed(2).replace(/0$/, '')}`;
    gsap.killTweensOf(el);
    gsap.fromTo(el, { opacity: 1, scale: 1.5 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' });
    gsap.to(el, { opacity: 0, duration: 0.4, delay: 0.9 });
    tone(440 * Math.pow(1.12, n), 0.15, 'triangle', 0.1);
  }
  function addCharge(t: Rune, n: number) {
    if (t === 'ruby') HEROES.forEach((h) => (S.charge[h.id] = Math.min(100, S.charge[h.id] + N.rubyCharge * n)));
    else {
      const h = heroOf(t);
      if (h) S.charge[h.id] = Math.min(100, S.charge[h.id] + N.charge * n);
    }
  }

  /* ---------- striking ---------- */
  // Every rune in `cells` flies on its own (Battle Focus' blades, a critical die's row).
  async function strike(
    cells: number[],
    m: number,
    opts: { steel?: boolean; finale?: (zones: Zone[]) => Promise<void> } = {},
  ) {
    const byZone: Partial<Record<Zone, number>> = {};
    let heal = 0,
      armor = 0;
    const charge: Partial<Record<Rune, number>> = {};
    const flights: Promise<void>[] = [];
    for (const k of cells) {
      const [r, c] = rc(k),
        t = type(r, c);
      if (!t || isDie(t)) continue;
      const [x, y] = cellXY(r, c);
      if (t === 'skull') {
        gsap.to(tile(r, c).el, { scale: 1.4, opacity: 0, duration: 0.25 });
        continue;
      }
      charge[t] = (charge[t] ?? 0) + 1;
      let dest: [number, number];
      if (strikes(t)) {
        const z = zone(c);
        byZone[z] = (byZone[z] ?? 0) + N[t] * m;
        dest = foeXY(z);
      } else if (t === 'vial') {
        heal += N.vial * m;
        dest = appXY(heroBar);
      } else {
        armor += N.ward * m;
        dest = appXY(heroBar);
      }
      breakFx(t, x, y, 1);
      const p = document.createElement('img');
      p.className = 'er-proj';
      p.src = IMG[t];
      fx.appendChild(p);
      if (opts.steel) {
        const z = s * 0.86 * 1.3;
        p.style.width = p.style.height = z + 'px';
        p.style.margin = `${-z / 2}px 0 0 ${-z / 2}px`;
      }
      gsap.set(p, { x, y });
      tile(r, c).el.style.opacity = '0';
      if (opts.steel) {
        // Battle Focus: blades spin up through a steel-light trail
        const dx = dest[0] + (Math.random() * 40 - 20),
          dy = dest[1] + (Math.random() * 30 - 15);
        const d0 = flights.length * 0.05;
        gsap.to(p, { rotation: 540, duration: 0.5, delay: d0 * 0.4, ease: 'power2.in' });
        flights.push(
          tw(p, {
            x: dx,
            y: dy,
            rotation: '+=1080',
            duration: 0.42 + Math.random() * 0.12,
            ease: 'power3.in',
            delay: 0.5 + d0,
            onUpdate: () => {
              const qx = num(gsap.getProperty(p, 'x')),
                qy = num(gsap.getProperty(p, 'y'));
              for (let j = 0; j < 2; j++)
                emit({
                  x: qx,
                  y: qy,
                  vx: Math.random() - 0.5,
                  vy: Math.random() - 0.5,
                  drag: 0.92,
                  decay: 0.06,
                  size: 3 + Math.random() * 4,
                  col: STEEL[rnd(3)],
                });
            },
          }).then(() => {
            p.remove();
            sparks(dx, dy, 14);
            tone(1200 + rnd(400), 0.05, 'square', 0.03);
          }),
        );
      } else {
        const tc = COL[t];
        flights.push(
          tw(p, {
            x: dest[0],
            y: dest[1],
            scale: 0.55,
            duration: 0.32 + Math.random() * 0.1,
            ease: 'power2.in',
            delay: flights.length * 0.015,
            onUpdate: () =>
              emit({
                x: num(gsap.getProperty(p, 'x')),
                y: num(gsap.getProperty(p, 'y')),
                vx: Math.random() - 0.5,
                vy: Math.random() - 0.5,
                drag: 0.9,
                decay: 0.06,
                size: 2 + Math.random() * 3,
                col: tc[rnd(tc.length)],
              }),
          }).then(() => {
            p.remove();
            if (t !== 'vial' && t !== 'ward') impactFx(t, dest[0], dest[1], 1);
          }),
        );
      }
    }
    tone(520, 0.08, 'square', 0.04);
    await Promise.all(flights);
    if (opts.finale) await opts.finale(Object.keys(byZone) as Zone[]);
    for (const z of Object.keys(byZone) as Zone[]) hit(z, byZone[z]!, m >= 2 ? 'crit' : 'dmg');
    if (heal) {
      const real = Math.min(Math.round(heal), S.maxHp - S.hp);
      S.hp += real;
      const [x, y] = appXY(heroBar);
      float('+' + Math.round(heal), 'heal', x, y - 16);
    }
    if (armor) {
      const before = S.armor;
      S.armor = Math.min(N.armorCap, S.armor + Math.round(armor));
      const [x, y] = appXY(heroBar);
      float('+' + (S.armor - before) + ' armor', 'armor', x + 40, y - 16);
    }
    for (const t of Object.keys(charge) as Rune[]) addCharge(t, charge[t]!);
    render();
  }
  // matching: each group squeezes into one ball of light, then the light flies to its target
  async function strikeGroups(groups: Group[], extra: number[], m: number, combo: number, spawns: Spawn[]) {
    const ks = 1 + 0.35 * (combo - 1);
    if (combo >= 3 && !reduce) gsap.fromTo(app, { x: -3 * combo }, { x: 0, duration: 0.45, ease: 'elastic.out(1,.3)' });
    for (const k of extra) {
      const [r, c] = rc(k);
      if (type(r, c) === 'skull') {
        const [x, y] = cellXY(r, c),
          el = tile(r, c).el;
        breakFx('skull', x, y, 1);
        grid[r][c] = null;
        gsap.to(el, { scale: 1.4, opacity: 0, duration: 0.25, onComplete: () => el.remove() });
      }
    }
    tone(520, 0.08, 'square', 0.04);
    await Promise.all(
      groups.map((g, gi) =>
        orbGroup(
          g,
          gi,
          m,
          ks,
          spawns.find((sp) => g.cells.includes(sp[0])),
        ),
      ),
    );
    render();
  }
  async function orbGroup(g: Group, gi: number, m: number, ks: number, spawn?: Spawn) {
    const t = g.t,
      n = g.cells.length,
      C = COL[t];
    let ar = 0,
      ac2 = 0;
    if (spawn) [ar, ac2] = rc(spawn[0]);
    else
      for (const k of g.cells) {
        const [r, c] = rc(k);
        ar += r / n;
        ac2 += c / n;
      }
    const [ox, oy] = cellXY(ar, ac2);
    runLine(g);
    await wait(gi * 70);
    // 1. squeeze: the runes slide into the gather point, light streams with them
    const els = g.cells.map((k) => {
      const [r, c] = rc(k),
        el = tile(r, c).el,
        [x, y] = cellXY(r, c);
      grid[r][c] = null;
      for (let i = 0; i < 5; i++)
        emit({
          x: x + Math.random() * 14 - 7,
          y: y + Math.random() * 14 - 7,
          vx: (ox - x) / 12,
          vy: (oy - y) / 12,
          drag: 0.9,
          decay: 0.05,
          size: 2 + Math.random() * 3,
          col: C[i % C.length],
        });
      return el;
    });
    await Promise.all(
      els.map((el) =>
        tw(el, { x: ac2 * s, y: ar * s, scale: 0.3, opacity: 0, duration: 0.24, ease: 'power2.in' }).then(() =>
          el.remove(),
        ),
      ),
    );
    // 2. the light is born
    const orb: Orb = { x: ox, y: oy, r: 0, col: C[0], seed: Math.random() * 6 };
    orbs.push(orb);
    kick();
    ring(ox, oy, C[C.length > 2 ? 2 : 0], 2.5, 8);
    tone(420 + gi * 90, 0.14, 'sine', 0.08, 1.7);
    await tw(orb, { r: s * (0.16 + 0.03 * n) * Math.min(1.5, ks), duration: 0.18, ease: 'back.out(3)' });
    if (spawn) {
      // 4 and 5: hold, then the d20 forms where the runes met
      await wait(260);
      const [r, c] = rc(spawn[0]),
        gold = spawn[1] === 'd20a';
      grid[r][c] = makeTile(spawn[1], r, c, spawn[2]);
      gsap.from(tile(r, c).el, { scale: 0, rotation: -180, duration: 0.45, ease: 'back.out(2)' });
      forgeFx(r, c, gold);
      await wait(320);
    } else await wait(80);
    // 3. the light flies to its target
    let dest: [number, number], apply: () => void;
    if (strikes(t)) {
      const z = zone(Math.round(ac2));
      dest = foeXY(z);
      if (!WARDS) dest = [cellXY(0, ac2)[0], dest[1] + (Math.random() * 40 - 20)];
      const d = dest;
      apply = () => {
        hit(z, N[t] * n * m, m >= 2 ? 'crit' : 'dmg');
        if (t === 'ember') {
          const f = liveFoe(z);
          if (f.alive) f.burn++;
        }
        impactFx(t, d[0], d[1], ks * 1.6);
        ring(d[0], d[1], C[0], 3, 8);
      };
    } else if (t === 'vial') {
      const d = (dest = appXY(heroBar));
      apply = () => {
        const h = N.vial * n * m,
          real = Math.min(Math.round(h), S.maxHp - S.hp);
        S.hp += real;
        float('+' + Math.round(h), 'heal', d[0], d[1] - 16);
        impactFx(t, d[0], d[1], ks);
      };
    } else {
      const d = (dest = appXY(heroBar));
      apply = () => {
        const before = S.armor;
        S.armor = Math.min(N.armorCap, S.armor + Math.round(N.ward * n * m));
        float('+' + (S.armor - before) + ' armor', 'armor', d[0] + 40, d[1] - 16);
        ring(d[0], d[1], 'rgba(170,215,255,1)', 3, 10);
      };
    }
    const cx = (ox + dest[0]) / 2 + (Math.random() * 80 - 40),
      cy = Math.min(oy, dest[1]) - (dest[1] < oy ? 40 : 60),
      prog = { t: 0 };
    await tw(prog, {
      t: 1,
      duration: 0.36,
      ease: 'power2.in',
      onUpdate: () => {
        const u = 1 - prog.t;
        orb.x = u * u * ox + 2 * u * prog.t * cx + prog.t * prog.t * dest[0];
        orb.y = u * u * oy + 2 * u * prog.t * cy + prog.t * prog.t * dest[1];
        for (let i = 0; i < 2; i++)
          emit({
            x: orb.x,
            y: orb.y,
            vx: Math.random() - 0.5,
            vy: Math.random() - 0.5,
            drag: 0.9,
            decay: 0.05,
            size: orb.r * (0.4 + Math.random() * 0.5),
            col: C[rnd(C.length)],
          });
      },
    });
    orbs.splice(orbs.indexOf(orb), 1);
    addCharge(t, n);
    apply();
    render();
  }
  function removeCells(cells: number[]) {
    for (const k of cells) {
      const [r, c] = rc(k),
        t = grid[r][c];
      if (t) {
        gsap.to(t.el, { scale: 0, opacity: 0, duration: 0.15, onComplete: () => t.el.remove() });
        grid[r][c] = null;
      }
    }
  }

  async function resolve(origin: number | null, mult = 1) {
    let combo = 0;
    while (!S.over) {
      const groups = findGroups();
      if (!groups.length) break;
      combo++;
      const m = (1 + N.comboStep * (combo - 1)) * mult;
      mult = 1;
      if (combo > 1) showCombo(combo, m);
      const clear = new Set<number>(),
        spawns: Spawn[] = [];
      for (const g of groups) {
        g.cells.forEach((k) => clear.add(k));
        if (!noForge && (g.maxRun >= 4 || g.cells.length >= 5)) {
          const at = origin != null && g.cells.includes(origin) ? origin : g.longest[Math.floor(g.longest.length / 2)];
          spawns.push([at, g.maxRun >= 5 || g.cells.length >= 5 ? 'd20a' : 'd20', g.t]);
        }
      }
      for (const k of [...clear]) {
        const [r, c] = rc(k);
        for (const [dr, dc] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ])
          if (type(r + dr, c + dc) === 'skull') clear.add(key(r + dr, c + dc));
      }
      const inGroups = new Set(groups.flatMap((g) => g.cells));
      // lightning runes in a match go off; a charged rune caught in a blast goes off too
      const fired = new Set<number>(),
        blasts: [number, Charge][] = [],
        hitCells = new Set<number>();
      const queue = [...inGroups].filter((k) => grid[rc(k)[0]][rc(k)[1]]?.charge);
      while (queue.length) {
        const k = queue.shift()!;
        if (fired.has(k)) continue;
        fired.add(k);
        const [r, c] = rc(k),
          ch = tile(r, c).charge!;
        blasts.push([k, ch]);
        for (const b of blastCells(ch, r, c)) {
          if (!inGroups.has(b)) hitCells.add(b);
          const bt = grid[rc(b)[0]][rc(b)[1]];
          if (bt?.charge && !fired.has(b)) queue.push(b);
        }
      }
      await strikeGroups(
        groups,
        [...clear].filter((k) => !inGroups.has(k) && !hitCells.has(k)),
        m,
        combo,
        spawns,
      );
      if (blasts.length) await lightning(blasts, [...hitCells], m);
      await wait(80);
      await collapse();
      origin = null;
      await flushBanners();
      if (checkEnd()) return;
    }
  }

  /* ---------- enemy turn ---------- */
  async function enemyTurn() {
    for (const k of ZONES) {
      const f = S.foes[k];
      if (f.alive && f.burn > 0) {
        hit(k, N.burnPerStack * f.burn, 'burn');
        f.burn--;
        render();
        await wait(260);
        if (checkEnd()) return;
      }
    }
    await flushBanners();
    for (const k of ZONES) {
      const f = S.foes[k];
      if (!f.alive || S.over) continue;
      f.cd--;
      render();
      if (f.cd <= 0) {
        await act(k);
        f.cd = f.every;
        render();
        if (checkEnd()) return;
      }
    }
  }
  async function act(k: Zone) {
    const V = S.foes.vexa;
    const vexaHex = k === 'vexa' && !WARDS && V.next === 'hex';
    if (k === 'vexa' && !WARDS) V.next = vexaHex ? 'lash' : 'hex';
    if (k === 'right' || vexaHex) {
      const n = vexaHex ? (V.enraged ? N.foes.vexa.rageCurse : N.foes.vexa.curse) : N.foes.right.curse;
      banner(vexaHex ? 'Hex' : esc(N.foes.right.name), `Curses ${n === 3 ? 'three' : n === 4 ? 'four' : n} runes`);
      const stone = vexaHex ? pods.vexa : pods.right.querySelector<HTMLElement>('.er-stone')!;
      if (vexaHex) {
        gsap.fromTo(boss, { scale: 1 }, { scale: 1.05, duration: 0.2, yoyo: true, repeat: 1 });
        gsap.fromTo(bossFlash, { opacity: 0.4 }, { opacity: 0, duration: 0.5 });
      } else gsap.fromTo(stone, { scale: 1 }, { scale: 1.25, duration: 0.2, yoyo: true, repeat: 1 });
      const pool: number[] = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isRune(type(r, c))) pool.push(key(r, c));
      const picks: number[] = [];
      for (let i = 0; i < n && pool.length; i++) picks.push(pool.splice(rand(pool.length), 1)[0]);
      const [sx, sy] = appXY(stone);
      tone(180, 0.5, 'sawtooth', 0.06, 0.5);
      await Promise.all(
        picks.map((k2, i) => {
          const [r, c] = rc(k2),
            [x, y] = cellXY(r, c);
          const p = document.createElement('img');
          p.className = 'er-proj';
          p.src = IMG.skull;
          fx.appendChild(p);
          gsap.set(p, { x: sx, y: sy, scale: 0.4 });
          return tw(p, { x, y, scale: 1, duration: 0.45, delay: i * 0.08, ease: 'power2.inOut' }).then(() => {
            p.remove();
            tile(r, c).el.remove();
            grid[r][c] = makeTile('skull', r, c);
            gsap.from(tile(r, c).el, { scale: 1.6, opacity: 0, duration: 0.25 });
          });
        }),
      );
      await wait(350);
      return;
    }
    const dmg = k === 'left' ? N.foes.left.dmg : V.enraged ? N.foes.vexa.rageDmg : N.foes.vexa.dmg;
    if (k === 'left') {
      const stone = pods.left.querySelector('.er-stone')!;
      await tw(stone, { y: 24, scale: 1.2, duration: 0.15, ease: 'power2.in' });
      gsap.to(stone, { y: 0, scale: 1, duration: 0.3 });
    } else {
      banner(V.enraged ? 'Soul Rend' : 'Soul Lash');
      if (FIG) {
        // She gathers, then lunges at the party.
        await tw(boss, { scale: 0.97, y: 4, duration: 0.2, ease: 'power1.out' });
        await tw(boss, { scale: 1.14, y: -6, duration: 0.22, ease: 'power3.in' });
        gsap.to(boss, { scale: 1, y: 0, duration: 0.45, delay: 0.1, ease: 'power2.out' });
      } else {
        await tw(boss, { scale: 1.08, duration: 0.25, ease: 'power2.in' });
        gsap.to(boss, { scale: 1, duration: 0.4 });
      }
    }
    hurt(dmg);
    await wait(450);
  }
  function hurt(n: number) {
    const absorbed = Math.min(S.armor, n);
    S.armor -= absorbed;
    const real = n - absorbed;
    S.hp = Math.max(0, S.hp - real);
    const [x, y] = appXY(heroBar);
    float('−' + real, 'hurt', x, y - 18);
    if (absorbed) float(absorbed + ' blocked', 'armor', x + 60, y - 30);
    gsap.fromTo(redFlash, { opacity: real ? 1 : 0.3 }, { opacity: 0, duration: 0.5 });
    if (!reduce) gsap.fromTo(app, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1,.25)' });
    thud(0.35);
    buzz(real ? [45, 35, 30] : 15, true);
    render();
  }

  /* ---------- player actions ---------- */
  async function playSwap(a: number, b: number) {
    if (S.busy || S.over) return;
    S.busy = true;
    setSel(null);
    const [r1, c1] = rc(a),
      [r2, c2] = rc(b),
      A = tile(r1, c1),
      B = tile(r2, c2);
    if (isDie(A.type) || isDie(B.type)) {
      S.busy = false;
      const [dr, dc] = isDie(A.type) ? [r1, c1] : [r2, c2];
      return rollDie(dr, dc);
    }
    tone(330, 0.05, 'sine', 0.05);
    swapData(a, b);
    await Promise.all([
      tw(A.el, { x: c2 * s, y: r2 * s, duration: 0.16 }),
      tw(B.el, { x: c1 * s, y: r1 * s, duration: 0.16 }),
    ]);
    if (!findGroups().length) {
      swapData(a, b);
      tone(140, 0.12, 'square', 0.05);
      buzz([8, 50, 8]);
      await Promise.all([
        tw(A.el, { x: c1 * s, y: r1 * s, duration: 0.16 }),
        tw(B.el, { x: c2 * s, y: r2 * s, duration: 0.16 }),
      ]);
      S.busy = false;
      return;
    }
    S.moves++;
    hideHint();
    await resolve(b);
    await afterMove(true);
  }
  async function afterMove(enemy: boolean) {
    if (!S.over && enemy) await enemyTurn();
    if (!S.over && !hasMoves()) await reshuffle();
    render();
    S.busy = false;
    checkEnd();
  }
  // the d20: flick it at a target (or tap to throw at the foe above it); d20 + party bonus against a DC
  function throwDieEl(t: Die, rune: Rune, x: number, y: number) {
    const el = document.createElement('div'),
      z = s * 1.05;
    el.className = 'er-tdie';
    el.style.width = el.style.height = z + 'px';
    el.innerHTML = dieHTML(t, rune, z);
    fx.appendChild(el);
    gsap.set(el, { x, y, xPercent: -50, yPercent: -50 });
    return el;
  }
  async function flyDie(
    el: HTMLElement,
    rune: Rune,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    i: number,
    sides = 20,
  ) {
    const cx = (x0 + x1) / 2 + (i ? 30 : -30),
      cy = Math.min(y0, y1) - 130 - i * 20,
      prog = { t: 0 },
      dn = el.querySelector('.er-dn')!,
      C = COL[rune] || FIRE;
    let last = 0;
    await tw(prog, {
      t: 1,
      duration: 0.72,
      delay: i * 0.08,
      ease: 'power1.inOut',
      onUpdate: () => {
        const t = prog.t,
          u = 1 - t;
        gsap.set(el, {
          x: u * u * x0 + 2 * u * t * cx + t * t * x1,
          y: u * u * y0 + 2 * u * t * cy + t * t * y1,
          rotation: t * 1080,
          scale: 1 + 0.55 * Math.sin(Math.PI * t),
        });
        const now = performance.now();
        if (now - last > 55) {
          last = now;
          dn.textContent = String(1 + rnd(sides));
          tone(600 + rnd(400), 0.02, 'square', 0.02);
        }
        emit({
          x: num(gsap.getProperty(el, 'x')),
          y: num(gsap.getProperty(el, 'y')),
          vx: Math.random() - 0.5,
          vy: Math.random() - 0.5,
          drag: 0.9,
          decay: 0.05,
          size: 3 + Math.random() * 3,
          col: C[rnd(C.length)],
        });
      },
    });
    thud(0.25);
    ring(x1, y1, 'rgba(255,220,160,1)', 2.5, 10);
    await tw(el, {
      keyframes: [
        { y: y1 - 26, scaleY: 1.05, duration: 0.14, ease: 'power2.out' },
        { y: y1, scaleY: 0.85, scaleX: 1.12, duration: 0.12, ease: 'power2.in' },
        { scaleY: 1, scaleX: 1, duration: 0.3, ease: 'elastic.out(1,.4)' },
      ],
    });
  }
  /* ---------- lightning ---------- */
  /** Blasts from lightning runes: a beam down a column, a burst over a 3x3; every rune caught strikes. */
  async function lightning(blasts: [number, Charge][], cells: number[], m: number) {
    crack();
    buzz([30, 30, 50], true);
    for (const [k, ch] of blasts) {
      const [r, c] = rc(k);
      if (ch === 'bolt') beam(c, r);
      else storm(r, c);
    }
    if (!reduce) gsap.fromTo(app, { y: -6 }, { y: 0, duration: 0.4, ease: 'elastic.out(1,.3)' });
    await wait(220);
    await clearCells(cells, m);
  }
  /** The bolt: lightning falls from the sky down the whole column, twice, and the column lights up. */
  function beam(c: number, from = 0) {
    const [x, top] = cellXY(0, c),
      [, bot] = cellXY(ROWS - 1, c),
      [, hy] = cellXY(from, c),
      y0 = top - s * 1.6,
      y1 = bot + s * 0.4;
    wash(x - s / 2, top - s / 2, s, bot - top + s);
    bolt(x, y0, x, y1, { w: 5, jag: 0.06, forks: 4 });
    later(() => bolt(x, y0, x, y1, { w: 3.5, jag: 0.08, forks: 2, decay: 0.07 }), 90);
    emit({ x, y: hy, size: s * 1.1, decay: 0.07, col: 'rgba(170,220,255,1)' });
    for (let r = 0; r < ROWS; r++) {
      const [, py] = cellXY(r, c);
      later(() => {
        emit({ x, y: py, size: s * 0.55, decay: 0.06, col: 'rgba(150,210,255,1)' });
        sparks(x, py, 7);
      }, r * 25);
    }
  }
  /** The storm: arcs crackle out from the rune to every cell around it, with a shockwave. */
  function storm(r: number, c: number) {
    const [x, y] = cellXY(r, c),
      r0 = Math.max(0, r - 1),
      r1 = Math.min(ROWS - 1, r + 1),
      c0 = Math.max(0, c - 1),
      c1 = Math.min(COLS - 1, c + 1),
      [ax, ay] = cellXY(r0, c0),
      [bx, by] = cellXY(r1, c1);
    wash(ax - s / 2, ay - s / 2, bx - ax + s, by - ay + s, 0.03);
    emit({ x, y, size: s * 1.2, decay: 0.07, col: 'rgba(170,220,255,1)' });
    ring(x, y, 'rgba(255,255,255,1)', 4.5, s * 0.3);
    later(() => ring(x, y, 'rgba(120,190,255,1)', 3.2, s * 0.3), 80);
    let i = 0;
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++) {
        if (rr === r && cc === c) continue;
        const [tx, ty] = cellXY(rr, cc);
        later(() => {
          bolt(x, y, tx, ty, { w: 3, jag: 0.22, forks: 1, decay: 0.06 });
          sparks(tx, ty, 6);
        }, i++ * 22);
      }
    // and one more round of arcs as it fades
    later(() => {
      for (const [dx, dy] of [
        [-1, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
      ])
        bolt(x, y, x + dx * s * 1.2, y + dy * s * 1.2, { w: 2.2, jag: 0.3, forks: 0, decay: 0.08 });
    }, 200);
    sparks(x, y, 30);
  }
  /** Breaks these cells: runes strike (their damage, healing, armor), skulls shatter, dice stay. */
  async function clearCells(cells: number[], m: number) {
    const live = cells.filter((k) => {
      const t = type(rc(k)[0], rc(k)[1]);
      return t && !isDie(t);
    });
    if (!live.length) return;
    await strike(live, m);
    removeCells(live);
    render();
  }
  function randomRunes(n: number, not?: Rune) {
    const pool: number[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = type(r, c);
        if (isRune(t) && t !== not) pool.push(key(r, c));
      }
    const out: number[] = [];
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rand(pool.length), 1)[0]);
    return out;
  }

  /* ---------- the thrown die (2026-11-25): Playful Roll's 3D throw, and a random fate ---------- */
  const faces = facesFor(o.d20Fates);
  let dice: DiceStage | null = null,
    diceFailed = false,
    /** Set while a Blade Storm's matches resolve, so the storm can't forge the next golden die. */
    noForge = false;
  const diceHost = $('.er-dice');
  function diceStage() {
    if (dice || diceFailed) return dice;
    try {
      dice = new DiceStage(
        diceHost,
        synthSounds(
          () => (muted ? null : ac),
          (p) => buzz(p, true),
        ),
        reduce,
        (x, y, n) => sparks(x, y, n),
        faces.map((id) => FATE_ICON[id]),
      );
    } catch {
      diceFailed = true; // no WebGL: the die flies the old way
    }
    return dice;
  }
  async function applyFate(f: FateRoll, at: [number, number]) {
    switch (f.fate.id) {
      case 'bladeStorm': {
        // every rune and skull on the board turns to blades, one wave down the board, then they all match
        tone(160, 0.6, 'sawtooth', 0.07, 4);
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const old = grid[r][c];
            if (!old || isDie(old.type) || old.type === 'blade') continue;
            old.el.remove();
            grid[r][c] = makeTile('blade', r, c, 'ruby', old.charge);
            const el = tile(r, c).el;
            gsap.from(el, {
              scale: 0,
              rotation: -180,
              duration: 0.35,
              delay: r * 0.06 + c * 0.02,
              ease: 'back.out(2)',
            });
            const [x, y] = cellXY(r, c);
            later(() => sparks(x, y, 4), (r * 0.06 + c * 0.02) * 1000);
          }
        await wait(ROWS * 60 + 400);
        noForge = true;
        break;
      }
      case 'heroSurge': {
        // a random hero (decided with the roll) unleashes their power, for free
        const h = HEROES[f.hero % HEROES.length];
        burst(at[0], at[1], true);
        await wait(250);
        await unleash(h.id);
        break;
      }
      case 'tempest': {
        // runes charge with lightning one by one, then the whole storm goes off together
        const cells = randomRunes(FATE.tempestRunes),
          blasts: [number, Charge][] = [];
        for (const k of cells) {
          const [r, c] = rc(k),
            ch: Charge = rand(2) ? 'bolt' : 'storm';
          const [x, y] = cellXY(r, c);
          bolt(at[0], at[1], x, y, { w: 3.5, jag: 0.16, forks: 1, decay: 0.05 });
          crack();
          charge(r, c, ch);
          blasts.push([k, ch]);
          await wait(160);
        }
        await wait(350);
        const hit = new Set<number>();
        for (const [k, ch] of blasts) blastCells(ch, ...rc(k)).forEach((x) => hit.add(x));
        // the bolts are spent as they go off
        for (const [k] of blasts) {
          const [r, c] = rc(k),
            t = tile(r, c);
          if (t) t.charge = undefined;
        }
        await lightning(blasts, [...hit], 1);
        break;
      }
    }
    render();
  }
  async function rollDie(r: number, c: number, target?: Zone) {
    if (S.busy || S.over) return;
    S.busy = true;
    setSel(null);
    S.moves++;
    hideHint();
    const t = tile(r, c),
      dieType = t.type as Die,
      rune = t.rune || 'ruby';
    let tgt: Zone = target || S.lock || zone(c);
    if (!S.foes[tgt].alive) tgt = 'vexa';
    const [x0, y0] = cellXY(r, c);
    gsap.to(t.el, { scale: 0, opacity: 0, duration: 0.2, onComplete: () => t.el.remove() });
    grid[r][c] = null;
    if (dieType === 'd20') await rollD10At(rune, tgt, x0, y0);
    else await throwD20(dieType, rune, tgt, x0, y0);
    if (dead) return;
    await wait(400);
    await flushBanners();
    await collapse();
    if (!checkEnd()) await resolve(null);
    noForge = false;
    await afterMove(true);
  }
  /** The silver d10 (a match of 4): it spins up to the foe and strikes for its roll. Damage only. */
  async function rollD10At(rune: Rune, tgt: Zone, x0: number, y0: number) {
    const d = rollD10(rng, o.d10Damage);
    let [x1, y1] = foeXY(tgt);
    if (!WARDS) x1 = Math.max(60, Math.min(app.clientWidth - 60, x0 * 0.5 + app.clientWidth * 0.25));
    y1 += 12;
    const el = throwDieEl('d20', rune, x0, y0);
    await flyDie(el, rune, x0, y0, x1, y1, 0, 10);
    const dn = el.querySelector<HTMLElement>('.er-dn')!;
    dn.textContent = String(d.roll);
    gsap.fromTo(dn, { scale: 1.8 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
    const crit = d.roll === 10;
    hit(tgt, d.dmg, crit ? 'crit' : undefined);
    if (crit) {
      burst(x1, y1, true);
      gsap.fromTo(bossFlash, { opacity: 0.8 }, { opacity: 0, duration: 0.45 });
      tone(660, 0.3, 'triangle', 0.12, 1.5);
    } else {
      sparks(x1, y1, 16);
      tone(440, 0.15, 'triangle', 0.08, 1.2);
    }
    banner(`${d.roll}${crit ? ' · Critical' : ''}`, `d10 · ${d.dmg} damage`);
    later(() => gsap.to(el, { opacity: 0, scale: 0.4, duration: 0.3, onComplete: () => el.remove() }), 900);
    await wait(500);
  }
  /** The gold d20 (a match of 5): Playful Roll's 3D throw, and one of three big fates. */
  async function throwD20(dieType: Die, rune: Rune, tgt: Zone, x0: number, y0: number) {
    const stage3d = diceStage();
    let f: FateRoll, at: [number, number];
    if (stage3d) {
      // the die comes into the hand over the dimmed board; it is decided the moment it leaves the hand
      diceHost.dataset.on = 'true';
      const hint = $('.er-throw-hint');
      hint.textContent = 'Flick or tap the golden die';
      gsap.to(hint, { opacity: 1, duration: 0.25 });
      tone(240, 0.5, 'sawtooth', 0.05, 3);
      await stage3d.aim({
        count: 1,
        sigil: null,
        tableTop: bossbar.offsetTop + bossbar.offsetHeight,
        onGrab: () => void gsap.to(hint, { opacity: 0, duration: 0.2 }),
      });
      gsap.to(hint, { opacity: 0, duration: 0.2 });
      if (dead) return;
      f = rollFate(rng, HEROES.length, faces);
      await stage3d.throwHeld({ results: [f.roll], hang: ['short'] });
      if (dead) return;
      const p = stage3d.screenPoint(app, 0);
      at = [p.x, p.y];
      stage3d.flash(0xffd27a, 0.45, 0.35, 0);
      // the icon is read on the die, then the die goes and the fate's name takes its place
      await wait(700);
      if (dead) return;
      stage3d.shrinkAway(reduce ? 0 : 0.4);
      delete diceHost.dataset.on;
    } else {
      f = rollFate(rng, HEROES.length, faces);
      let [x1, y1] = foeXY(tgt);
      if (!WARDS) x1 = Math.max(60, Math.min(app.clientWidth - 60, x0 * 0.5 + app.clientWidth * 0.25));
      y1 += 12;
      const el = throwDieEl(dieType, rune, x0, y0);
      await flyDie(el, rune, x0, y0, x1, y1, 0);
      el.querySelector('.er-dn')!.innerHTML = fateIconSvg(f.fate.id, 'er-dn-icon');
      later(() => gsap.to(el, { opacity: 0, scale: 0.4, duration: 0.3, onComplete: () => el.remove() }), 1400);
      at = [x1, y1];
    }
    tone(660, 0.5, 'triangle', 0.15, 2);
    tone(990, 0.6, 'triangle', 0.1, 1.5);
    banner(`${fateIconSvg(f.fate.id, 'er-fate-icon')}${esc(f.fate.name)}`, esc(f.fate.text));
    burst(at[0], at[1], true);
    await wait(600);
    await applyFate(f, at);
  }
  async function power(id: HeroId) {
    if (S.busy || S.over || S.charge[id] < 100) return;
    S.busy = true;
    setSel(null);
    S.charge[id] = 0;
    render();
    await unleash(id);
    if (!checkEnd()) await resolve(null);
    await afterMove(false);
  }
  /** A hero's power: the card lifts, the cut-in, then the power itself (charge and turn are the caller's). */
  async function unleash(id: HeroId) {
    const h = HEROES.find((x) => x.id === id)!,
      card = $(`.er-hc[data-h=${id}]`);
    gsap.fromTo(card, { y: 0 }, { y: -14, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' });
    buzz([15, 40, 35], true);
    await cutIn(h);
    if (id === 'kael') {
      const cells: number[] = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (type(r, c) === 'blade') cells.push(key(r, c));
      await battleFocus(cells);
      await flushBanners();
      await wait(120);
      await collapse();
    } else if (id === 'garran') await shieldWall(card);
    else if (id === 'mara') await fireVolley(card);
    else await mendingHerbs(card);
  }

  /* ---------- cut-in ---------- */
  async function cutIn(h: HeroDef) {
    const el = $('.er-cutin'),
      band = el.querySelector('.er-band')!,
      lines = el.querySelector('.er-lines')!,
      img = el.querySelector<HTMLImageElement>('img.er-cut-hero')!,
      title = el.querySelector('.er-title')!,
      who = el.querySelector('.er-who')!,
      flash = el.querySelector('.er-flash')!;
    el.style.setProperty('--c1', h.c1);
    el.style.setProperty('--c2', h.c2);
    img.src = h.cut;
    title.textContent = h.power;
    who.textContent = h.name + ' · ' + h.text;
    sweep(h.c1);
    const tl = gsap.timeline();
    tl.set(el, { opacity: 1 })
      .set(flash, { opacity: 0 })
      .fromTo(el.querySelector('.er-dim'), { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0)
      .fromTo(band, { scaleY: 0 }, { scaleY: 1, duration: 0.18, ease: 'power3.out' }, 0.05)
      .fromTo(lines, { x: 0 }, { x: -260, duration: 1.4, ease: 'none' }, 0)
      .fromTo(
        img,
        { xPercent: -260, opacity: 0 },
        { xPercent: -55, opacity: 1, duration: 0.3, ease: 'power3.out' },
        0.12,
      )
      .to(img, { xPercent: -45, duration: 0.75, ease: 'none' }, 0.42)
      .fromTo(title, { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' }, 0.3)
      .fromTo(who, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.2 }, 0.45)
      .to(img, { xPercent: 160, opacity: 0, duration: 0.22, ease: 'power3.in' }, 1.15)
      .to([title, who], { opacity: 0, duration: 0.15 }, 1.15)
      .to(band, { scaleY: 0, duration: 0.18, ease: 'power3.in' }, 1.2)
      .to(flash, { opacity: 0.5, duration: 0.05 }, 1.35)
      .to(flash, { opacity: 0, duration: 0.2 })
      .to(el, { opacity: 0, duration: 0.15 }, 1.4);
    tone(220, 0.35, 'sawtooth', 0.07, 3);
    later(() => tone(880, 0.5, 'triangle', 0.1, 1.2), 300 / (reduce ? 3 : 1));
    await new Promise<void>((r) =>
      tl.eventCallback('onComplete', () => {
        if (!dead) r();
      }),
    );
  }

  /* ---------- particles (canvas, additive glow) ---------- */
  const pc = $<HTMLCanvasElement>('.er-pfx'),
    px = pc.getContext('2d')!;
  let parts: Particle[] = [],
    slashes: Slash[] = [],
    walls: Wall[] = [],
    bolts: Bolt[] = [],
    washes: Wash[] = [],
    pRun = false,
    raf = 0;
  const arrows: Arrow[] = [],
    orbs: Orb[] = [];
  const sprites: Record<string, HTMLCanvasElement> = {};
  function sprite(col: string) {
    if (sprites[col]) return sprites[col];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!,
      gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return (sprites[col] = c);
  }
  function sizeP() {
    const d = Math.min(2, devicePixelRatio || 1);
    pc.width = app.clientWidth * d;
    pc.height = app.clientHeight * d;
    px.setTransform(d, 0, 0, d, 0, 0);
  }
  function emit(p: Partial<Particle> & { x: number; y: number }) {
    parts.push({
      vx: 0,
      vy: 0,
      life: 1,
      decay: 0.03,
      size: 6,
      col: 'rgba(255,140,40,1)',
      drag: 0.96,
      grav: 0,
      grow: 0,
      ...p,
    });
    kick();
  }
  function kick() {
    if (!pRun && !dead) {
      pRun = true;
      raf = requestAnimationFrame(loop);
    }
  }
  function loop() {
    if (dead) return;
    const W = app.clientWidth,
      H = app.clientHeight;
    px.clearRect(0, 0, W, H);
    px.globalCompositeOperation = 'lighter';
    for (const w of washes) {
      // a cold wash over the cleared cells: bright in the middle, a lit rim
      const a = Math.max(0, w.life),
        cx = w.x + w.w / 2,
        cy = w.y + w.h / 2,
        g = px.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w.w, w.h) * 0.7);
      g.addColorStop(0, `rgba(200,235,255,${0.55 * a})`);
      g.addColorStop(0.6, `rgba(90,160,255,${0.3 * a})`);
      g.addColorStop(1, `rgba(40,90,255,${0.08 * a})`);
      px.fillStyle = g;
      px.beginPath();
      px.roundRect(w.x, w.y, w.w, w.h, 10);
      px.fill();
      px.strokeStyle = `rgba(190,230,255,${0.3 * a})`;
      px.lineWidth = 1.5;
      px.stroke();
      w.life -= w.decay;
    }
    washes = washes.filter((w) => w.life > 0);
    for (const b of bolts) {
      // a fresh fork every third frame makes it flicker like real lightning
      if (b.n++ % 3 === 0) b.paths = boltPaths(b);
      const a = Math.max(0, b.life),
        flick = 0.75 + Math.random() * 0.25;
      px.lineCap = 'round';
      px.lineJoin = 'round';
      b.paths.forEach((path, i) => {
        const k = i === 0 ? 1 : 0.45;
        for (const [w, c] of [
          [b.w * 3.2, `rgba(70,140,255,${0.28 * a * flick})`],
          [b.w * 1.4, `rgba(160,215,255,${0.8 * a * flick})`],
          [b.w * 0.45, `rgba(255,255,255,${a})`],
        ] as [number, string][]) {
          px.strokeStyle = c;
          px.lineWidth = w * k;
          px.beginPath();
          path.forEach(([x, y], j) => (j ? px.lineTo(x, y) : px.moveTo(x, y)));
          px.stroke();
        }
      });
      b.life -= b.decay;
    }
    bolts = bolts.filter((b) => b.life > 0);
    for (const sl of slashes) {
      // crescent slash: thick white core inside a cold glow
      const e = Math.min(1, sl.t),
        ex = sl.x0 + (sl.x1 - sl.x0) * e,
        ey = sl.y0 + (sl.y1 - sl.y0) * e,
        mx = (sl.x0 + ex) / 2 + sl.bow * (ey - sl.y0) * 0.25,
        my = (sl.y0 + ey) / 2 - sl.bow * (ex - sl.x0) * 0.25;
      px.globalAlpha = Math.max(0, sl.life);
      px.lineCap = 'round';
      for (const [w, c] of [
        [30, sl.glow],
        [14, 'rgba(230,240,255,0.7)'],
        [5, 'rgba(255,255,255,1)'],
      ] as [number, string][]) {
        px.strokeStyle = c;
        px.lineWidth = w * sl.scale * (0.4 + sl.life * 0.6);
        px.beginPath();
        px.moveTo(sl.x0, sl.y0);
        px.quadraticCurveTo(mx, my, ex, ey);
        px.stroke();
      }
      if (sl.t >= 1) sl.life -= sl.scale < 1 ? 0.09 : 0.045;
    }
    px.globalAlpha = 1;
    slashes = slashes.filter((sl) => sl.life > 0);
    for (const w of walls) {
      // Garran's barrier: two rows of glowing hexes growing out from the middle
      const r = 12,
        dx = r * 1.75,
        now = performance.now() / 1000;
      if (w.fade) w.life -= 0.035;
      for (let row = 0; row < 2; row++)
        for (let x = (row ? dx / 2 : 0) - dx; x < W + dx; x += dx) {
          if (Math.abs(x - W / 2) > w.t * (W / 2 + dx)) continue;
          const y = w.y - row * r * 1.5,
            a = Math.max(0, w.life) * (0.55 + 0.35 * Math.sin(now * 6 + x * 0.05));
          px.beginPath();
          for (let i = 0; i < 6; i++) {
            const an = Math.PI / 6 + (i * Math.PI) / 3;
            px.lineTo(x + Math.cos(an) * r, y + Math.sin(an) * r);
          }
          px.closePath();
          px.fillStyle = `rgba(80,150,255,${a * 0.25})`;
          px.fill();
          px.strokeStyle = `rgba(170,215,255,${a})`;
          px.lineWidth = 1.6;
          px.stroke();
        }
    }
    walls = walls.filter((w) => w.life > 0);
    for (const ob of orbs) {
      // a ball of light: coloured glow, white core, a slow pulse
      if (ob.r <= 0) continue;
      const pulse = 1 + 0.12 * Math.sin(performance.now() / 70 + ob.seed);
      px.globalAlpha = 0.9;
      const g = ob.r * 4.2 * pulse;
      px.drawImage(sprite(ob.col), ob.x - g / 2, ob.y - g / 2, g, g);
      px.globalAlpha = 1;
      const c = ob.r * 1.7 * pulse;
      px.drawImage(sprite('rgba(255,255,255,1)'), ob.x - c / 2, ob.y - c / 2, c, c);
    }
    for (const a of arrows) {
      const tr = a.trail;
      if (tr.length < 2) continue;
      for (let i = 1; i < tr.length; i++) {
        const f = i / tr.length;
        px.strokeStyle = `rgba(255,${(150 + 90 * f) | 0},${(60 + 120 * f) | 0},${f})`;
        px.lineWidth = 2 + 8 * f;
        px.lineCap = 'round';
        px.beginPath();
        px.moveTo(tr[i - 1][0], tr[i - 1][1]);
        px.lineTo(tr[i][0], tr[i][1]);
        px.stroke();
      }
      const [hx, hy] = tr[tr.length - 1];
      const z = a.big ? 48 : 34;
      px.globalAlpha = 1;
      px.drawImage(sprite('rgba(255,200,90,1)'), hx - z / 2, hy - z / 2, z, z);
    }
    for (const p of parts) {
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.grav;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.size += p.grow;
      if (p.life <= 0) continue;
      px.globalAlpha = Math.min(1, p.life * 1.4);
      if (p.ring) {
        px.strokeStyle = p.col;
        px.lineWidth = 3 * p.life;
        px.beginPath();
        px.arc(p.x, p.y, p.size, 0, 6.283);
        px.stroke();
      } else {
        const z = p.size * (0.5 + p.life * 0.5) * 2;
        px.drawImage(sprite(p.col), p.x - z / 2, p.y - z / 2, z, z);
      }
    }
    px.globalAlpha = 1;
    parts = parts.filter((p) => p.life > 0);
    if (parts.length || arrows.length || slashes.length || walls.length || orbs.length || bolts.length || washes.length)
      raf = requestAnimationFrame(loop);
    else {
      pRun = false;
      px.clearRect(0, 0, W, H);
    }
  }
  function burst(x: number, y: number, big: boolean) {
    const n = big ? 70 : 36;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283,
        v = 1.5 + Math.random() * (big ? 9 : 6);
      emit({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 1.5,
        grav: 0.14,
        drag: 0.93,
        decay: 0.018 + Math.random() * 0.03,
        size: 2 + Math.random() * 4,
        col: FIRE[i % 4],
      });
    }
    for (let i = 0; i < (big ? 14 : 7); i++)
      emit({
        x: x + Math.random() * 30 - 15,
        y: y + Math.random() * 20 - 10,
        vx: Math.random() * 2 - 1,
        vy: -0.6 - Math.random() * 1.2,
        drag: 0.98,
        decay: 0.012,
        size: 10 + Math.random() * 14,
        grow: 0.2,
        col: 'rgba(255,90,20,1)',
      });
    emit({ x, y, ring: true, size: 6, grow: big ? 5 : 3.2, decay: 0.05, col: 'rgba(255,210,140,1)' });
    emit({ x, y, size: big ? 60 : 38, decay: 0.08, col: 'rgba(255,240,200,1)' });
  }
  const hexA = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},1)`;
  };
  function sweep(col: string) {
    // rising ember wash behind a cut-in
    const W = app.clientWidth,
      H = app.clientHeight;
    for (let i = 0; i < 40; i++)
      emit({
        x: Math.random() * W,
        y: H * (0.3 + Math.random() * 0.4),
        vx: 3 + Math.random() * 5,
        vy: -0.5 - Math.random(),
        drag: 0.99,
        decay: 0.012 + Math.random() * 0.01,
        size: 2 + Math.random() * 3,
        col: col.startsWith('#') ? hexA(col) : col,
      });
  }
  function embersOn(k: Zone, n: number) {
    // lingering burn on the foe
    const [x, y] = foeXY(k);
    for (let i = 0; i < n; i++)
      later(
        () =>
          emit({
            x: x + Math.random() * 60 - 30,
            y: y + Math.random() * 30,
            vx: Math.random() - 0.5,
            vy: -1 - Math.random() * 1.5,
            drag: 0.98,
            decay: 0.02,
            size: 3 + Math.random() * 4,
            col: FIRE[i % 4],
          }),
        i * 40,
      );
  }
  function sparks(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283,
        v = 2 + Math.random() * 7;
      emit({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        grav: 0.12,
        drag: 0.92,
        decay: 0.03 + Math.random() * 0.03,
        size: 1.5 + Math.random() * 2.5,
        col: STEEL[i % 3],
      });
    }
  }
  function slash(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    bow: number,
    dur: number,
    scale = 1,
    glow = 'rgba(120,170,255,0.35)',
    quiet = false,
  ) {
    const sl: Slash = { x0, y0, x1, y1, bow, t: 0, life: 1, scale, glow };
    slashes.push(sl);
    kick();
    if (!quiet) tone(1800, 0.18, 'sawtooth', 0.05, 0.2);
    return tw(sl, { t: 1, duration: dur, ease: 'power3.out' });
  }
  async function battleFocus(cells: number[]) {
    // 1. Kael's focus: steel light lifts off every blade rune
    cells.forEach((k, i) => {
      const [r, c] = rc(k),
        [x, y] = cellXY(r, c);
      gsap.to(tile(r, c).el, { scale: 1.3, duration: 0.2, delay: i * 0.02, ease: 'back.out(3)' });
      for (let j = 0; j < 8; j++)
        later(
          () =>
            emit({
              x: x + Math.random() * s - s / 2,
              y: y + s * 0.3,
              vx: 0,
              vy: -1.5 - Math.random() * 2,
              drag: 0.97,
              decay: 0.03,
              size: 2 + Math.random() * 3,
              col: STEEL[j % 3],
            }),
          j * 45,
        );
    });
    tone(160, 0.6, 'sawtooth', 0.06, 4);
    await wait(520);
    // 2. the blades spin up at their targets; 3. a giant crossing slash, flash and shower of sparks
    await strike(cells, N.focusMult, {
      steel: true,
      finale: async (zones) => {
        const W = app.clientWidth,
          st = stage.getBoundingClientRect(),
          a = app.getBoundingClientRect(),
          top = st.top - a.top,
          h = st.height;
        if (!reduce) gsap.to(app, { x: 6, duration: 0.05, yoyo: true, repeat: 3 });
        const one = slash(W * 0.08, top + h * 0.18, W * 0.92, top + h * 0.82, 1, 0.16);
        await wait(110);
        const two = slash(W * 0.92, top + h * 0.18, W * 0.08, top + h * 0.82, -1, 0.16);
        await Promise.all([one, two]);
        gsap.fromTo(bossFlash, { opacity: 1 }, { opacity: 0, duration: 0.45 });
        thud(0.5);
        sparks(W / 2, top + h / 2, 60);
        for (const z of zones) {
          const [x, y] = foeXY(z);
          sparks(x, y, 30);
        }
        if (!reduce) gsap.fromTo(app, { y: -12 }, { y: 0, duration: 0.5, ease: 'elastic.out(1,.25)' });
        await wait(120);
      },
    });
    removeCells(cells);
  }
  function ring(x: number, y: number, col: string, grow = 3, size = 6) {
    emit({ x, y, ring: true, size, grow, decay: 0.05, col });
  }
  /** A jagged line from one point to another (midpoint displacement). */
  function zigzag(x0: number, y0: number, x1: number, y1: number, jag: number, depth = 5): [number, number][] {
    let pts: [number, number][] = [
      [x0, y0],
      [x1, y1],
    ];
    let off = Math.hypot(x1 - x0, y1 - y0) * jag;
    for (let d = 0; d < depth; d++) {
      const next: [number, number][] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1],
          [bx, by] = pts[i],
          len = Math.hypot(bx - ax, by - ay) || 1,
          o = (Math.random() * 2 - 1) * off;
        next.push([(ax + bx) / 2 + (-(by - ay) / len) * o, (ay + by) / 2 + ((bx - ax) / len) * o], pts[i]);
      }
      pts = next;
      off *= 0.55;
    }
    return pts;
  }
  function boltPaths(b: Bolt): [number, number][][] {
    const main = zigzag(b.x0, b.y0, b.x1, b.y1, b.jag);
    const out = [main];
    for (let i = 0; i < b.forks; i++) {
      // a fork leaves the main path and dies out to one side
      const j = 2 + Math.floor(Math.random() * (main.length - 4)),
        [fx, fy] = main[j],
        len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * (0.12 + Math.random() * 0.18),
        a = Math.atan2(b.y1 - b.y0, b.x1 - b.x0) + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      out.push(zigzag(fx, fy, fx + Math.cos(a) * len, fy + Math.sin(a) * len, b.jag * 1.4, 3));
    }
    return out;
  }
  function bolt(x0: number, y0: number, x1: number, y1: number, o: Partial<Bolt> = {}) {
    const b: Bolt = { x0, y0, x1, y1, jag: 0.12, w: 4, life: 1, decay: 0.055, forks: 3, paths: [], n: 0, ...o };
    b.paths = boltPaths(b);
    bolts.push(b);
    kick();
  }
  function wash(x: number, y: number, w: number, h: number, decay = 0.035) {
    washes.push({ x, y, w, h, life: 1, decay });
    kick();
  }
  /** A thunderclap: a low crack and a hiss. */
  function crack() {
    tone(1400, 0.25, 'sawtooth', 0.06, 0.3);
    tone(90, 0.35, 'square', 0.05, 0.5);
  }
  // every rune breaks its own way; k scales with the combo
  function breakFx(t: Rune | 'skull', x: number, y: number, k: number) {
    const C = COL[t],
      n = Math.round(10 * k);
    if (t === 'blade') {
      const d = s * 0.38;
      slash(x - d, y - d, x + d, y + d, 0, 0.08, 0.2, 'rgba(150,190,255,0.35)', true);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283,
          v = 2 + Math.random() * 4;
        emit({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          drag: 0.9,
          decay: 0.05,
          size: 1.5 + Math.random() * 2,
          col: C[i % 3],
        });
      }
    } else if (t === 'ember') {
      for (let i = 0; i < n + 4; i++) {
        const a = Math.random() * 6.283,
          v = 1 + Math.random() * 3.5;
        emit({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 1.5,
          grav: -0.05,
          drag: 0.93,
          decay: 0.035,
          size: 3 + Math.random() * 5,
          col: C[i % 4],
        });
      }
    } else if (t === 'ruby') {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283,
          v = 2.5 + Math.random() * 4;
        emit({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 2,
          grav: 0.25,
          drag: 0.95,
          decay: 0.03,
          size: 2 + Math.random() * 2.5,
          col: C[i % 3],
        });
      }
      emit({ x, y, size: s * 0.3, decay: 0.12, col: 'rgba(255,120,140,1)' });
    } else if (t === 'ward') {
      ring(x, y, 'rgba(170,215,255,1)', 2.4, s * 0.25);
      for (let i = 0; i < n / 2; i++) {
        const a = (i / (n / 2)) * 6.283;
        emit({ x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, drag: 0.9, decay: 0.05, size: 2.5, col: C[i % 3] });
      }
    } else if (t === 'vial') {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4,
          v = 2 + Math.random() * 4;
        emit({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          grav: 0.3,
          drag: 0.97,
          decay: 0.03,
          size: 2 + Math.random() * 3,
          col: C[i % 3],
        });
      }
    } else {
      for (let i = 0; i < 12; i++)
        emit({
          x: x + Math.random() * 20 - 10,
          y: y + Math.random() * 20 - 10,
          vx: Math.random() * 2 - 1,
          vy: -0.5 - Math.random(),
          drag: 0.97,
          decay: 0.025,
          size: 8 + Math.random() * 10,
          grow: 0.3,
          col: C[i % 3],
        });
    }
  }
  function impactFx(t: Rune | 'skull', x: number, y: number, k: number) {
    const C = COL[t] || FIRE;
    for (let i = 0; i < Math.round(8 * k); i++) {
      const a = Math.random() * 6.283,
        v = 2 + Math.random() * 5;
      emit({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        grav: 0.1,
        drag: 0.92,
        decay: 0.04,
        size: 2 + Math.random() * 3,
        col: C[i % C.length],
      });
    }
  }
  function runLine(g: Group) {
    // a light line runs along the matched row before it breaks
    const cells = g.longest,
      [r0, c0] = rc(cells[0]),
      [r1, c1] = rc(cells[cells.length - 1]),
      [x0, y0] = cellXY(r0, c0),
      [x1, y1] = cellXY(r1, c1);
    const glow = {
      blade: 'rgba(150,190,255,0.5)',
      ember: 'rgba(255,120,40,0.55)',
      ruby: 'rgba(255,50,80,0.55)',
      ward: 'rgba(120,180,255,0.5)',
      vial: 'rgba(90,230,110,0.5)',
    }[g.t];
    void slash(x0, y0, x1, y1, 0, 0.1, 0.3, glow, true);
  }
  // 4 and 5 matches: the d20 forms where the runes met
  function forgeFx(r: number, c: number, gold: boolean) {
    const [x, y] = cellXY(r, c),
      C = gold
        ? ['rgba(255,220,120,1)', 'rgba(255,255,220,1)', 'rgba(255,170,60,1)']
        : ['rgba(220,230,245,1)', 'rgba(255,255,255,1)', 'rgba(150,170,200,1)'];
    ring(x, y, C[1], gold ? 6 : 3, s * 0.3);
    if (gold) ring(x, y, C[0], 4, s * 0.15);
    for (let i = 0; i < (gold ? 70 : 16); i++) {
      const a = Math.random() * 6.283,
        v = 2 + Math.random() * (gold ? 8 : 5);
      emit({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        grav: 0.08,
        drag: 0.93,
        decay: 0.025,
        size: 2 + Math.random() * 3,
        col: C[i % 3],
      });
    }
    if (gold) {
      // a pillar of light and a flash for the golden die
      const top = stage.getBoundingClientRect().top - app.getBoundingClientRect().top;
      void slash(x, y, x, top, 0, 0.18, 0.9, 'rgba(255,200,90,0.5)', true);
      gsap.fromTo(bossFlash, { opacity: 0.6 }, { opacity: 0, duration: 0.5 });
      if (!reduce) gsap.fromTo(app, { y: -6 }, { y: 0, duration: 0.45, ease: 'elastic.out(1,.3)' });
    }
    float(
      gold ? 'Golden d20' : 'd10 forged',
      gold ? 'crit' : 'armor',
      Math.min(Math.max(x, 130), app.clientWidth - 130),
      y - s * 0.6,
    );
    if (gold) {
      tone(523, 0.3, 'triangle', 0.12);
      later(() => tone(784, 0.3, 'triangle', 0.12), 120);
      later(() => tone(1047, 0.5, 'triangle', 0.12), 240);
    } else tone(660, 0.3, 'triangle', 0.1, 1.5);
  }

  async function shieldWall(card: HTMLElement) {
    const [cx, cy] = appXY(card),
      a = app.getBoundingClientRect(),
      W = app.clientWidth,
      wy = heroBox.getBoundingClientRect().top - a.top + 16,
      BL = COL.ward;
    ring(cx, cy, 'rgba(170,215,255,1)', 4, 20);
    for (let i = 0; i < 30; i++) {
      const an = Math.random() * 6.283,
        v = 2 + Math.random() * 4;
      emit({
        x: cx,
        y: cy,
        vx: Math.cos(an) * v,
        vy: Math.sin(an) * v - 2,
        drag: 0.92,
        decay: 0.03,
        size: 2 + Math.random() * 3,
        col: BL[i % 3],
      });
    }
    const wall: Wall = { t: 0, life: 1, y: wy };
    walls.push(wall);
    kick();
    tone(180, 0.6, 'triangle', 0.12, 2.2);
    thud(0.4);
    if (!reduce) gsap.fromTo(app, { y: 5 }, { y: 0, duration: 0.4, ease: 'elastic.out(1,.3)' });
    await tw(wall, { t: 1, duration: 0.4, ease: 'power2.out' });
    S.armor = Math.min(N.armorCap + N.wallArmor, S.armor + N.wallArmor);
    const [hx, hy] = appXY(heroBar);
    float('+' + N.wallArmor + ' armor', 'armor', hx, hy - 16);
    render();
    await wait(200);
    const live = ZONES.filter((k) => S.foes[k].alive);
    tone(400, 0.4, 'sine', 0.08, 2);
    await Promise.all(
      live.map((k, i) => {
        const [fx2, fy2] = foeXY(k),
          sx = W / 2 + (fx2 - W / 2) * 0.2,
          prog = { t: 0 };
        return tw(prog, {
          t: 1,
          duration: 0.42,
          delay: i * 0.09,
          ease: 'power2.in',
          onUpdate: () => {
            const x = sx + (fx2 - sx) * prog.t,
              y = wy + (fy2 - wy) * prog.t;
            for (let j = 0; j < 3; j++)
              emit({
                x: x + Math.random() * 10 - 5,
                y,
                vx: Math.random() - 0.5,
                vy: 1,
                drag: 0.9,
                decay: 0.05,
                size: 3 + Math.random() * 3,
                col: BL[rnd(3)],
              });
          },
        }).then(() => {
          ring(fx2, fy2, 'rgba(170,215,255,1)', 4, 10);
          impactFx('ward', fx2, fy2, 2);
          S.foes[k].cd += 1;
          render();
          const badge = k === 'vexa' ? $('.er-vexa-cd') : pods[k].querySelector('.er-cd');
          gsap.fromTo(badge, { scale: 1.9 }, { scale: 1, duration: 0.45, ease: 'back.out(3)' });
          tone(620, 0.15, 'triangle', 0.08);
        });
      }),
    );
    banner('Foes stalled', 'Every foe waits one more turn');
    await wait(900);
    wall.fade = true;
  }

  async function mendingHerbs(card: HTMLElement) {
    const [cx, cy] = appXY(card),
      G = COL.vial,
      a = app.getBoundingClientRect();
    for (let i = 0; i < 60; i++)
      later(() => {
        const an = i * 0.55;
        emit({
          x: cx + Math.cos(an) * 26,
          y: cy + Math.sin(an) * 10,
          vx: Math.cos(an) * 1.8,
          vy: -2.5 - Math.random() * 3,
          grav: -0.02,
          drag: 0.97,
          decay: 0.014,
          size: 3 + Math.random() * 4,
          col: G[i % 3],
        });
      }, i * 10);
    [523, 659, 784, 1047].forEach((f, i) => later(() => tone(f, 0.35, 'sine', 0.08), i * 90));
    await wait(450);
    const bar = heroBar.getBoundingClientRect(),
      bx = bar.left - a.left,
      by = bar.top - a.top;
    for (let i = 0; i < 55; i++)
      later(
        () =>
          emit({
            x: bx + Math.random() * bar.width,
            y: by - 120 - Math.random() * 80,
            vx: 0,
            vy: 3 + Math.random() * 2,
            drag: 0.995,
            decay: 0.017,
            size: 3 + Math.random() * 3,
            col: G[rnd(3)],
          }),
        i * 8,
      );
    await wait(550);
    const real = Math.min(N.herbs, S.maxHp - S.hp);
    S.hp += real;
    float('+' + N.herbs, 'heal', bx + bar.width / 2, by - 16);
    emit({ x: bx + bar.width / 2, y: by + 6, size: bar.width * 0.4, decay: 0.05, col: 'rgba(120,255,140,1)' });
    gsap.fromTo(heroBar, { scaleY: 1.6 }, { scaleY: 1, duration: 0.4, ease: 'back.out(3)' });
    render();
    const skulls: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (type(r, c) === 'skull') skulls.push([r, c]);
    await Promise.all(
      skulls.map(([r, c], i) =>
        wait(i * 90).then(() => {
          const [x, y] = cellXY(r, c);
          breakFx('skull', x, y, 1);
          ring(x, y, 'rgba(140,255,150,1)', 2.5, s * 0.2);
          for (let j = 0; j < 12; j++) {
            const an = (j / 12) * 6.283;
            emit({
              x,
              y,
              vx: Math.cos(an) * 2.5,
              vy: Math.sin(an) * 2.5 - 1,
              drag: 0.93,
              decay: 0.03,
              size: 3,
              col: G[j % 3],
            });
          }
          tile(r, c).el.remove();
          grid[r][c] = makeTile('vial', r, c);
          gsap.from(tile(r, c).el, { scale: 0, rotation: 90, duration: 0.4, ease: 'back.out(2)' });
          tone(880 + i * 60, 0.12, 'sine', 0.06);
        }),
      ),
    );
    await wait(450);
  }

  async function fireVolley(card: HTMLElement) {
    const [sx, sy] = appXY(card),
      shots: Promise<void>[] = [];
    // Mara draws: embers gather at her card
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283,
        r = 50 + Math.random() * 30;
      emit({
        x: sx + Math.cos(a) * r,
        y: sy + Math.sin(a) * r,
        vx: (-Math.cos(a) * r) / 14,
        vy: (-Math.sin(a) * r) / 14,
        drag: 0.9,
        decay: 0.04,
        size: 3 + Math.random() * 3,
        col: FIRE[i % 4],
      });
    }
    tone(300, 0.4, 'sawtooth', 0.05, 2.5);
    await wait(380);
    for (let i = 0; i < N.volley; i++) {
      const live = ZONES.filter((k) => S.foes[k].alive);
      if (!live.length || S.over) break;
      const k = live[rand(live.length)],
        [tx, ty] = foeXY(k),
        big = i === N.volley - 1;
      const a: Arrow = {
        t: 0,
        big,
        trail: [],
        x0: sx + (Math.random() * 30 - 15),
        y0: sy - 24,
        cx: (sx + tx) / 2 + (Math.random() * 180 - 90),
        cy: Math.min(sy, ty) - 90 - Math.random() * 90,
        x1: tx + (Math.random() * 30 - 15),
        y1: ty + (Math.random() * 20 - 10),
      };
      arrows.push(a);
      kick();
      tone(900 + i * 60, 0.09, 'triangle', 0.07, 0.6);
      shots.push(
        tw(a, {
          t: 1,
          duration: big ? 0.6 : 0.48,
          ease: 'power1.in',
          onUpdate: () => {
            const t = a.t,
              u = 1 - t,
              x = u * u * a.x0 + 2 * u * t * a.cx + t * t * a.x1,
              y = u * u * a.y0 + 2 * u * t * a.cy + t * t * a.y1;
            a.trail.push([x, y]);
            if (a.trail.length > 18) a.trail.shift();
            for (let j = 0; j < 2; j++)
              emit({
                x,
                y,
                vx: Math.random() - 0.5,
                vy: Math.random() - 0.2,
                drag: 0.94,
                decay: 0.05,
                size: 2 + Math.random() * 3,
                col: FIRE[rnd(4)],
              });
          },
        }).then(() => {
          arrows.splice(arrows.indexOf(a), 1);
          burst(a.x1, a.y1, big);
          if (!reduce) gsap.fromTo(app, { x: big ? -10 : -4 }, { x: 0, duration: 0.3, ease: 'elastic.out(1,.3)' });
          if (S.over) return;
          hit(k, big ? N.volleyDmg * 2 : N.volleyDmg, big ? 'crit' : 'dmg');
          if (S.foes[k].alive) {
            S.foes[k].burn++;
            embersOn(k, big ? 24 : 10);
          }
          render();
          checkEnd();
        }),
      );
      await wait(130);
    }
    await Promise.all(shots);
    await wait(450);
    await flushBanners();
  }

  /* ---------- input ---------- */
  function setSel(k: number | null) {
    if (sel != null) {
      const [r, c] = rc(sel);
      grid[r][c]?.el.classList.remove('er-sel');
    }
    sel = k;
    if (k != null) {
      const [r, c] = rc(k);
      tile(r, c).el.classList.add('er-sel');
    }
  }
  let down: { r: number; c: number; x: number; y: number; moved: boolean; die: boolean; aim: Zone | null } | null =
    null;
  board.addEventListener('pointerdown', (e) => {
    audio();
    if (S.busy || S.over) return;
    const b = board.getBoundingClientRect(),
      c = Math.floor((e.clientX - b.left) / s),
      r = Math.floor((e.clientY - b.top) / s);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || !grid[r][c]) return;
    down = { r, c, x: e.clientX, y: e.clientY, moved: false, die: isDie(tile(r, c).type), aim: null };
    board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', (e) => {
    if (down && down.die) {
      aimAt(e);
      return;
    }
    if (!down || down.moved) return;
    const dx = e.clientX - down.x,
      dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) < s * 0.35) return;
    down.moved = true;
    const [dr, dc] = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
    const r2 = down.r + dr,
      c2 = down.c + dc;
    if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) return;
    void playSwap(key(down.r, down.c), key(r2, c2));
  });
  board.addEventListener('pointerup', () => {
    if (!down) return;
    const d = down;
    down = null;
    if (d.die) {
      gsap.to(aim, { opacity: 0, duration: 0.15 });
      render();
      if (S.busy) return;
      if (d.aim) void rollDie(d.r, d.c, d.aim);
      else if (!d.moved) void rollDie(d.r, d.c);
      return;
    }
    if (d.moved || S.busy) return;
    const k = key(d.r, d.c),
      t = type(d.r, d.c);
    if (isDie(t)) return void rollDie(d.r, d.c);
    if (sel == null) return setSel(k);
    if (sel === k) return setSel(null);
    const [r0, c0] = rc(sel);
    if (Math.abs(r0 - d.r) + Math.abs(c0 - d.c) === 1) return void playSwap(sel, k);
    setSel(k);
  });
  // dragging a die: a dotted line from the die to your finger; whichever foe it points at is the target
  function aimAt(e: PointerEvent) {
    if (!down) return;
    const a = app.getBoundingClientRect(),
      [x0, y0] = cellXY(down.r, down.c),
      x = e.clientX - a.left,
      y = e.clientY - a.top,
      dx = x - x0,
      dy = y - y0,
      len = Math.hypot(dx, dy);
    if (len < s * 0.5 || dy > -s * 0.3) {
      down.aim = null;
      down.moved = len >= s * 0.5;
      gsap.set(aim, { opacity: 0 });
      render();
      return;
    }
    down.moved = true;
    const st = stage.getBoundingClientRect(),
      ux = x0 + dx * ((st.bottom - a.top - 40 - y0) / dy) || x; // where the line crosses the stage
    let k: Zone = 'vexa';
    if (WARDS) {
      const lx = $('.er-lanes').getBoundingClientRect().left - a.left,
        rel = (ux - lx) / (s * COLS);
      k = rel < 2 / 7 ? 'left' : rel > 5 / 7 ? 'right' : 'vexa';
      if (!S.foes[k].alive) k = 'vexa';
    }
    down.aim = k;
    render();
    pods[k].classList.add('er-locked');
    gsap.set(aim, { x: x0, y: y0, width: len, rotation: (Math.atan2(dy, dx) * 180) / Math.PI, opacity: 0.95 });
  }
  function lockOn(k: Zone) {
    audio();
    if (S.over) return;
    S.lock = S.lock === k ? null : k;
    hideHint();
    render();
    tone(600, 0.06, 'sine', 0.06);
  }
  pods.left.addEventListener('click', () => lockOn('left'));
  pods.right.addEventListener('click', () => lockOn('right'));
  pods.vexa.addEventListener('click', () => lockOn('vexa'));
  const party = $('.er-party');
  party.style.setProperty('--n', String(HEROES.length));
  party.innerHTML = HEROES.map(
    (h) =>
      `<button class="er-hc" data-h="${h.id}" aria-label="${esc(h.name)}: ${esc(h.power)}" style="background-image:url('${cardFrameImg}')"><img class="er-face" src="${esc(h.face)}" alt=""><span class="er-pct"></span><span class="er-hc-rune" style="background-image:url('${cardOrbImg}')"><img src="${IMG[h.rune]}" alt=""></span><span class="er-nm">${esc(h.name)}</span><span class="er-pw">${esc(h.power)}</span><span class="er-cbar"><i class="er-fill"></i></span></button>`,
  ).join('');
  party.querySelectorAll<HTMLElement>('.er-hc').forEach((b) =>
    b.addEventListener('click', () => {
      audio();
      const id = b.dataset.h as HeroId;
      if (S.charge[id] >= 100) void power(id);
      else {
        const h = HEROES.find((x) => x.id === id)!;
        banner(esc(h.power), esc(h.text) + ` · charges from ${h.rune === 'ward' ? 'shield' : h.rune} runes`);
      }
    }),
  );
  root.querySelector('.er-charge-btn')?.addEventListener('click', () => {
    if (S.over) return;
    HEROES.forEach((h) => (S.charge[h.id] = 100));
    render();
  });
  root.querySelector('.er-restart-btn')?.addEventListener('click', () => {
    if (!S.busy) start();
  });
  function hideHint() {
    lockhint.style.opacity = '0';
  }

  /* ---------- state + render ---------- */
  function setBar(el: Element, frac: number, text?: string) {
    const i = el.querySelector<HTMLElement>('i')!,
      b = el.querySelector<HTMLElement>('b');
    if (el.classList.contains('er-hpbar')) i.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
    else i.style.transform = `scaleX(${frac})`;
    if (b) b.style.transform = `scaleX(${frac})`;
    const n = el.querySelector('.er-num');
    if (n && text != null) n.textContent = text;
  }
  function render() {
    const v = S.foes.vexa;
    setBar($('.er-vexa-bar'), v.hp / v.max, `${v.hp} / ${v.max}`);
    const w = wardsUp(),
      warded = $('.er-warded');
    warded.hidden = !w || !WARDS;
    warded.textContent = `Warded −${w * 25}%`;
    $('.er-enraged').hidden = !v.enraged;
    stage.classList.toggle('er-raging', v.enraged);
    const vb = $('.er-vexa-burn');
    vb.hidden = !v.burn;
    vb.textContent = `Burning ${v.burn}`;
    const vcd = $('.er-vexa-cd');
    vcd.textContent = String(v.cd);
    vcd.classList.toggle('er-soon', v.cd <= 1);
    const hex = !WARDS && v.next === 'hex',
      V = N.foes.vexa;
    $('.er-next-name').textContent = hex ? 'Hex' : v.enraged ? 'Soul Rend' : 'Soul Lash';
    $('.er-intent').innerHTML = hex
      ? `<em>${v.enraged ? V.rageCurse : V.curse}</em> runes to skulls`
      : `<em>${v.enraged ? V.rageDmg : V.dmg}</em> party damage`;
    for (const k of ['left', 'right'] as const) {
      const f = S.foes[k],
        p = pods[k];
      setBar(p.querySelector('.er-bar')!, f.hp / f.max);
      const cd = p.querySelector('.er-cd')!;
      cd.textContent = String(f.cd);
      cd.classList.toggle('er-soon', f.cd <= 1);
      const bb = p.querySelector<HTMLElement>('.er-burnb')!;
      bb.style.display = f.burn ? 'block' : 'none';
      bb.textContent = '🔥' + f.burn;
      p.classList.toggle('er-broken', !f.alive);
      p.classList.toggle('er-locked', S.lock === k);
    }
    pods.vexa.classList.toggle('er-locked', S.lock === 'vexa');
    setBar(heroBar, S.hp / S.maxHp, `${S.hp} / ${S.maxHp}`);
    const armorEl = $('.er-armor');
    armorEl.style.display = S.armor ? 'inline' : 'none';
    armorEl.textContent = `◈ ${S.armor}`;
    for (const h of HEROES) {
      const b = $(`.er-hc[data-h=${h.id}]`),
        cv = S.charge[h.id];
      b.querySelector<HTMLElement>('.er-fill')!.style.transform = `scaleX(${cv / 100})`;
      b.querySelector('.er-pct')!.textContent = cv >= 100 ? 'TAP' : cv + '%';
      b.classList.toggle('er-ready', cv >= 100);
    }
  }
  function result(won: boolean): BattleResult {
    const v = S.foes.vexa;
    return {
      outcome: won ? 'win' : 'loss',
      tier: battleTier(won, S.hp / S.maxHp, v.hp / v.max),
      hpLeft: S.hp,
      maxHp: S.maxHp,
      moves: S.moves,
      enemyHpLeft: v.hp,
      enemyMaxHp: v.max,
    };
  }
  function checkEnd() {
    if (S.over) return true;
    if (S.foes.vexa.hp <= 0) {
      S.over = true;
      later(() => endCard(true), 500);
      return true;
    }
    if (S.hp <= 0) {
      S.over = true;
      later(() => endCard(false), 500);
      return true;
    }
    return false;
  }
  function endCard(won: boolean) {
    const res = result(won);
    o.onEnd(res);
    buzz(won ? [30, 60, 30, 60, 90] : [90, 60, 140], true);
    const tier = won ? (res.tier === 'critSuccess' ? 'Flawless victory' : 'Victory') : 'Defeat';
    if (won) {
      gsap.to(boss, { opacity: 0.25, filter: 'grayscale(1)', duration: 1 });
      tone(523, 0.4);
      later(() => tone(784, 0.6), 200);
    }
    // Continue goes back to the story; a must-win fight only offers another go after a loss.
    const canContinue = o.hasContinue && (won || !o.mustWin);
    const canRetry = !o.hasContinue || o.allowRetry || (!won && o.mustWin);
    overlay.hidden = false;
    overlay.innerHTML = `<div class="er-card"><h1>${won ? `${E} falls` : 'The party falls'}</h1><div class="er-tier">${tier}</div>
    <div class="er-stats">${S.moves} moves · Party ${S.hp} / ${S.maxHp} HP${won ? '' : ` · ${E} ${S.foes.vexa.hp} HP left`}</div>
    ${canContinue ? '<button class="er-btn er-continue-btn">Continue</button>' : ''}
    ${canRetry ? `<button class="er-btn${canContinue ? ' er-btn-quiet' : ''} er-again-btn">${won ? 'Fight again' : 'Try again'}</button>` : ''}</div>`;
    gsap.from(overlay.querySelector('.er-card'), { scale: 0.8, opacity: 0, duration: 0.35, ease: 'back.out(2)' });
    overlay.querySelector<HTMLElement>('.er-again-btn')?.addEventListener('click', () => start());
    overlay.querySelector<HTMLElement>('.er-continue-btn')?.addEventListener('click', () => o.onContinue(res));
  }
  async function begin() {
    audio();
    overlay.hidden = true;
    S.busy = true;
    const hold = (o.startAt ?? 0) - performance.now();
    if (hold > 0) await new Promise<void>((r) => later(r, hold));
    await dealBoard();
    S.busy = false;
    if (WARDS) {
      lockhint.style.opacity = '1';
      later(hideHint, 5000);
    }
  }
  function intro() {
    overlay.hidden = false;
    const charges = HEROES.map((h) => `${esc(h.name)} from ${RUNE_PLURAL[h.rune]}`);
    const chargeLine =
      HEROES.length === 1
        ? `${esc(HEROES[0].name)} charges from ${RUNE_PLURAL[HEROES[0].rune]} and rubies.`
        : `Each of the party charges from one rune: ${charges.slice(0, -1).join(', ')} and ${charges[charges.length - 1]}. Rubies charge everyone.`;
    const V = N.foes.vexa;
    const alone = `${E} fights alone. Every ${V.every} turns she acts, switching between Soul Lash (a heavy hit on the party, so keep armor up) and Hex (curses runes into skulls). Enraged at half health, she acts ${V.rageEvery === 1 ? 'every turn' : `every ${V.rageEvery} turns`}. The red number is turns until she acts.`;
    overlay.innerHTML = `<div class="er-card"><h1>${esc(o.introTitle)}</h1><p class="er-sub">${esc(o.introSub)}</p>
    <ul>
      <li><img src="${IMG.blade}" alt=""><span>Swipe to swap runes and line up 3 or more. Blades, embers and rubies fly up and strike whatever stands above their column.</span></li>
      <li><img src="${IMG.vial}" alt=""><span>Vials heal the party, shields give armor that blocks her hits.</span></li>
      <li><img class="er-face-mini" src="${esc(HEROES[HEROES.length - 1].face)}" alt=""><span>${chargeLine} Tap a full portrait to use the power, for free.</span></li>
      <li><div class="er-mini er-mini-stone">ᛉ</div><span>${WARDS ? `Two wards guard ${E}: each one standing cuts her damage taken by 25%. The number on each foe is turns until it acts.` : alone}</span></li>
      <li><div class="er-mini">20</div><span>Match 4 to forge a silver d10: tap it and it strikes for its roll (a 10 crits). Match 5 for the golden d20: tap it, flick the die, and the face it lands on is your fate: Blade Storm (every rune turns to blades), Hero Surge (a random hero's power, free) or Tempest (lightning runes that all go off).</span></li>
      <li><div class="er-mini er-mini-zap">⚡</div><span>Some runes fall in glowing with lightning. Match one: a bolt clears its whole column, a storm the 3×3 around it.</span></li>
    </ul>
    <button class="er-btn er-go-btn">Fight</button></div>`;
    overlay.querySelector<HTMLElement>('.er-go-btn')!.addEventListener('click', () => {
      o.onTutorialEnd();
      void begin();
    });
  }
  function freshFoe(f: FoeRules): Foe {
    return { ...f, max: f.hp, cd: f.every, burn: 0, alive: true, enraged: false, next: 'lash' };
  }
  function start(first = false) {
    const F = N.foes;
    S = {
      hp: N.heroHp,
      maxHp: N.heroHp,
      armor: 0,
      charge: Object.fromEntries(HEROES.map((h) => [h.id, 0])) as Record<HeroId, number>,
      moves: 0,
      lock: null,
      busy: false,
      over: false,
      queue: [],
      foes: { left: freshFoe(F.left), vexa: freshFoe(F.vexa), right: freshFoe(F.right) },
    };
    if (!WARDS) {
      S.foes.left.alive = S.foes.right.alive = false;
      pods.left.hidden = pods.right.hidden = true;
    }
    overlay.hidden = true;
    gsap.set(boss, { opacity: 1, filter: 'none', scale: 1 });
    if (WARDS) {
      pods.left.classList.remove('er-broken');
      pods.right.classList.remove('er-broken');
    }
    sel = null;
    layout();
    buildBoard();
    render();
    if (!first) {
      S.busy = true;
      void dealBoard().then(() => {
        S.busy = false;
      });
    }
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (layout(), sizeP())) : null;
  ro?.observe(root);
  sizeP();
  /* ---------- the enemy card: her art at once, her lines once the host's entrance has broken the story open ---------- */
  function foeCard(done: () => void) {
    const card = $('.er-foe'),
      q = (c: string) => card.querySelector<HTMLElement>(c)!,
      V = N.foes.vexa,
      turns = (n: number) => (n === 1 ? 'TURN' : 'TURNS');
    const art = o.cardImage ?? o.enemyFigure ?? o.enemyImage;
    q('.er-foe-img').setAttribute('src', art);
    card.classList.toggle('er-foe-fig', FIG && art === o.enemyFigure);
    q('.er-f-name').textContent = o.enemyName;
    q('.er-f-title').textContent = o.enemyTitle ?? '';
    q('.er-f-every').innerHTML = `${V.every}<em>${turns(V.every)}</em>`;
    q('.er-f-s1').textContent = WARDS ? 'GUARDED BY' : 'HITS FOR';
    q('.er-f-v1').innerHTML = WARDS ? '2<em>WARDS</em>' : `${V.dmg}<em>DAMAGE</em>`;
    const moves = WARDS ? ['SOUL LASH', esc(N.foes.left.name), esc(N.foes.right.name)] : ['SOUL LASH', 'HEX'];
    q('.er-f-moves').innerHTML = moves.map((m) => `<span>${m.toUpperCase()}</span>`).join('');
    const when = V.rageEvery === 1 ? 'every turn' : `every ${V.rageEvery} turns`;
    q('.er-f-rage').innerHTML = WARDS
      ? `<b>AT HALF HEALTH</b> ${E} enrages: Soul Rend for ${V.rageDmg}, ${when}.`
      : `<b>AT HALF HEALTH</b> ${E} enrages: Soul Rend for ${V.rageDmg} or a Hex of ${V.rageCurse} runes, ${when}.`;
    const plate = q('.er-foe-plate'),
      hpText = q('.er-f-hp span'),
      chips = q('.er-f-moves').children,
      cnt = { hp: 0 };
    hpText.textContent = '0 HP';
    card.hidden = false;
    gsap.set(card, { opacity: 1 });
    gsap.set(plate.children, { opacity: 0 });
    gsap.set(q('.er-f-skip'), { opacity: 0 });
    gsap.set(q('.er-f-hp i'), { scaleX: 0 });
    const pace = o.introPace && o.introPace > 0 ? o.introPace : 1;
    const d = Math.max(0, ((o.startAt ?? 0) - performance.now()) / 1000) * pace;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      card.hidden = true;
      done();
    };
    const tl = gsap.timeline({ onComplete: finish });
    tl.timeScale(pace);
    tl.fromTo(q('.er-foe-img'), { scale: 1.1 }, { scale: 1, duration: d + 2.6, ease: 'power2.out' }, 0)
      .to(q('.er-f-skip'), { opacity: 1, duration: 0.3 }, d)
      .fromTo(q('.er-f-eye'), { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.25 }, d + 0.05)
      .fromTo(
        q('.er-f-name'),
        { opacity: 0, scale: 1.5 },
        { opacity: 1, scale: 1, duration: 0.2, ease: 'power3.in' },
        d + 0.15,
      )
      .call(
        () => {
          audio();
          thud(0.4);
          tone(150, 0.4, 'sawtooth', 0.06, 0.5);
        },
        undefined,
        d + 0.35,
      )
      .fromTo(card, { x: 7 }, { x: 0, duration: 0.45, ease: 'elastic.out(1.6,.2)' }, d + 0.35)
      .fromTo(q('.er-f-title'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25 }, d + 0.45)
      .fromTo(
        [q('.er-f-hp'), q('.er-f-row')],
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.22, stagger: 0.06 },
        d + 0.6,
      )
      .to(q('.er-f-hp i'), { scaleX: 1, duration: 0.6, ease: 'power1.out' }, d + 0.68)
      .call(() => tone(220, 0.6, 'triangle', 0.06, 2), undefined, d + 0.68)
      .to(
        cnt,
        {
          hp: V.hp,
          duration: 0.6,
          ease: 'none',
          onUpdate: () => {
            hpText.textContent = `${Math.round(cnt.hp).toLocaleString('en')} HP`;
          },
        },
        d + 0.68,
      )
      .set([q('.er-f-moves'), q('.er-f-rage')], { opacity: 1 }, d + 1.2)
      .fromTo(chips, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18, stagger: 0.08 }, d + 1.25)
      .call(() => tone(520, 0.12, 'triangle', 0.05), undefined, d + 1.25)
      .fromTo(q('.er-f-rage'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, d + 1.55)
      // held so it can be read, then the plate drops and the fight shows through
      .to([plate, q('.er-f-skip')], { opacity: 0, y: 30, duration: 0.3, ease: 'power2.in' }, d + 2.9)
      .to(card, { opacity: 0, duration: 0.35 }, d + 3.05);
    // a tap skips her lines (not before the host's entrance is over)
    card.addEventListener('pointerdown', () => {
      if (performance.now() < (o.startAt ?? 0)) return;
      tl.kill();
      gsap.to(card, { opacity: 0, duration: 0.25, onComplete: finish });
    });
  }

  start(true);
  const afterCard = () => (o.intro ? intro() : void begin());
  if (o.introCard && !reduce) foeCard(afterCard);
  else afterCard();

  return {
    destroy() {
      dead = true;
      ro?.disconnect();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      cancelAnimationFrame(raf);
      gsap.killTweensOf(root.querySelectorAll('*'));
      gsap.killTweensOf([...orbs, ...arrows, ...slashes, ...walls]);
      if (reduce) gsap.globalTimeline.timeScale(prevScale);
      dice?.dispose();
      void ac?.close();
      root.innerHTML = '';
      root.classList.remove('er-root');
    },
    debug: {
      get state() {
        return S;
      },
      get types() {
        return types();
      },
      playSwap,
      rollDie,
      power,
      place(r, c, what) {
        if (what === 'bolt' || what === 'storm') return charge(r, c, what);
        const t = tile(r, c);
        t.el.remove();
        grid[r][c] = makeTile(what, r, c, isDie(t.type) ? t.rune : (t.type as Rune));
        render();
      },
    },
  };
}
