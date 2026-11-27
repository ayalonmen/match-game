import { useEffect, useRef } from 'react';
import { rulesFor, type Difficulty, type FateId, type Rules } from '../engine';
import { mountBattle, type BattleHandle, type BattleResult, type FigureFraming } from './controller';
import { partyFor, type HeroId, type PartyOverrides } from './heroes';
import vexaImg from './assets/vexa.webp';
import './battle.css';

export interface RuneBattleProps {
  /** The enemy's name and picture (default Vexa, the horned witch). With a figure, the picture is the enemy card's art. */
  enemyName?: string;
  enemyImage?: string;
  /** A cutout of the whole enemy (a Studio full-figure portrait): she stands on the stage in place of the painting. */
  enemyFigure?: string;
  /** The cutout in her hurt mood (same outline), shown for a moment on each hit. */
  enemyFigureHurt?: string;
  /** The scene behind the figure, blurred and darkened (default: enemyImage). */
  stageImage?: string;
  /** Closer (her upper body, the default since 2026-11-25), full body, or auto (full body when the stage has room). */
  figureFraming?: FigureFraming;
  /** Her two wards (Ash and Hex) stand in front of her; false is the solo fight. Default true. */
  wards?: boolean;
  difficulty?: Difficulty;
  /** Every number, for a host that tunes the fight itself; wins over wards / difficulty. */
  rules?: Rules;
  /** Other names or pictures for the party (the powers stay). */
  party?: PartyOverrides;
  /** Who fights: Kael (the story's hero) always, plus these (default all four). */
  members?: HeroId[];
  seed?: number;
  /** The how-to-play card before the fight: true always, false never, left out once per browser. */
  tutorial?: boolean;
  onTutorialEnd?: () => void;
  /** A `performance.now()` time: the board deals in no sooner (the host's entrance plays first). */
  startAt?: number;
  /** Open on the enemy card (art, name, health, clock, moves), the lines waiting for startAt. */
  introCard?: boolean;
  /** The line under her name on the card (default "Demon of the Den"). */
  enemyTitle?: string;
  /** The card's speed (the host's entrance pace; 1 is as designed). */
  introPace?: number;
  introTitle?: string;
  introSub?: string;
  /** With onContinue: also offer Fight again after the fight. */
  allowRetry?: boolean;
  /** A loss only offers Try again. */
  mustWin?: boolean;
  /** The silver d10 (a match of 4): damage per pip, so a roll strikes for roll x this (a 10 doubles). Default 8. */
  d10Damage?: number;
  /** The fates on the gold d20's faces (a match of 5). Default all three: bladeStorm, heroSurge, tempest. */
  d20Fates?: FateId[];
  /** The chance a new rune falls in charged with lightning, 0 to 1. Default 0.05; 0 turns them off. */
  lightningChance?: number;
  /** The test buttons (charge the party, restart). */
  devTools?: boolean;
  /** No sound (follow the host's own sound setting). */
  muted?: boolean;
  /**
   * The dice's buzz on phones as they fly and land (only the dice buzz). Pass the host's own haptics (its on/off
   * setting, an iPhone fallback); left out, the fight calls navigator.vibrate itself. A function that does nothing
   * turns it off.
   */
  haptic?: (pattern: number | number[]) => void;
  /** When the fight ends, before the end card. */
  onEnd?: (r: BattleResult) => void;
  /** The end card's Continue button; without it the card offers Fight again. */
  onContinue?: (r: BattleResult) => void;
  className?: string;
  /** For tests: the running fight. */
  handleRef?: (h: BattleHandle | null) => void;
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not on this device */
  }
}

const SEEN_KEY = 'ember-runes-tutorial-seen';
function showTutorial(t: boolean | undefined) {
  if (t !== undefined) return t;
  try {
    return localStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}
function markTutorialSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode: it shows again next time */
  }
}

/** Ember Runes: a match-3 fight. Mounts once per seed / setup; the host owns everything after onContinue. */
export function RuneBattle(props: RuneBattleProps) {
  const host = useRef<HTMLDivElement>(null);
  const cbs = useRef(props);
  useEffect(() => {
    cbs.current = props;
  });
  const {
    enemyName = 'Vexa',
    enemyImage = vexaImg,
    enemyFigure,
    enemyFigureHurt,
    stageImage,
    figureFraming = 'close',
    wards = true,
    difficulty = 'normal',
    rules,
    party,
    members,
    seed,
    tutorial,
    startAt,
    introCard = false,
    enemyTitle = 'Demon of the Den',
    introPace,
    d10Damage,
    d20Fates,
    lightningChance,
  } = props;
  const {
    introTitle = 'Ember Runes',
    introSub,
    allowRetry = false,
    mustWin = false,
    devTools = false,
    muted = false,
  } = props;
  const hasContinue = !!props.onContinue;
  const setup = JSON.stringify({
    enemyName,
    enemyImage,
    enemyFigure,
    enemyFigureHurt,
    stageImage,
    figureFraming,
    wards,
    difficulty,
    rules,
    party,
    members,
    seed,
    tutorial,
    startAt,
    introCard,
    enemyTitle,
    introPace,
    d10Damage,
    d20Fates,
    lightningChance,
    introTitle,
    introSub,
    allowRetry,
    mustWin,
    devTools,
    muted,
    hasContinue,
    ownArt: props.enemyImage !== undefined,
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const s = JSON.parse(setup) as typeof props & { hasContinue: boolean; ownArt: boolean };
    const h = mountBattle(el, {
      rules: s.rules ?? rulesFor({ wards: s.wards, difficulty: s.difficulty, enemyName: s.enemyName }),
      heroes: partyFor(s.party, s.members),
      enemyName: s.enemyName!,
      enemyImage: s.enemyImage!,
      enemyFigure: s.enemyFigure,
      enemyFigureHurt: s.enemyFigureHurt,
      stageImage: s.stageImage,
      // the enemy card shows the host's own art when it gave some, else the figure
      cardImage: s.ownArt && s.enemyFigure ? s.enemyImage : undefined,
      figureFraming: s.figureFraming,
      seed: s.seed ?? Math.floor(Math.random() * 2 ** 31),
      intro: showTutorial(s.tutorial),
      startAt: s.startAt,
      introCard: !!s.introCard,
      enemyTitle: s.enemyTitle,
      introPace: s.introPace,
      introTitle: s.introTitle!,
      introSub: s.introSub ?? `Fight ${s.enemyName}`,
      devTools: !!s.devTools,
      muted: !!s.muted,
      d10Damage: s.d10Damage,
      d20Fates: s.d20Fates,
      lightningChance: s.lightningChance,
      allowRetry: !!s.allowRetry,
      mustWin: !!s.mustWin,
      hasContinue: s.hasContinue,
      haptic: (p) => (cbs.current.haptic ?? vibrate)(p),
      onEnd: (r) => cbs.current.onEnd?.(r),
      onContinue: (r) => cbs.current.onContinue?.(r),
      onTutorialEnd: () => {
        markTutorialSeen();
        cbs.current.onTutorialEnd?.();
      },
    });
    cbs.current.handleRef?.(h);
    return () => {
      cbs.current.handleRef?.(null);
      h.destroy();
    };
  }, [setup]);

  return (
    <div
      ref={host}
      className={props.className}
      style={props.className ? undefined : { width: '100%', height: '100%' }}
    />
  );
}
