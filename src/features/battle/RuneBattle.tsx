import { useEffect, useRef } from 'react';
import { rulesFor, type Difficulty, type Rules } from '../engine';
import { mountBattle, type BattleHandle, type BattleResult, type FigureFraming } from './controller';
import { partyFor, type PartyOverrides } from './heroes';
import vexaImg from './assets/vexa.webp';
import './battle.css';

export interface RuneBattleProps {
  /** The enemy's name and picture (default Vexa, the horned witch). */
  enemyName?: string;
  enemyImage?: string;
  /** A cutout of the whole enemy (a Studio full-figure portrait): she stands on the stage in place of the painting. */
  enemyFigure?: string;
  /** The cutout in her hurt mood (same outline), shown for a moment on each hit. */
  enemyFigureHurt?: string;
  /** The scene behind the figure, blurred and darkened (default: enemyImage). */
  stageImage?: string;
  /** Full body, or closer (cropped at the legs). Default auto: closer when the stage is short. */
  figureFraming?: FigureFraming;
  /** Her two wards (Ash and Hex) stand in front of her; false is the solo fight. Default true. */
  wards?: boolean;
  difficulty?: Difficulty;
  /** Every number, for a host that tunes the fight itself; wins over wards / difficulty. */
  rules?: Rules;
  /** Other names or pictures for the party (the powers stay). */
  party?: PartyOverrides;
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
  /** The test buttons (charge the party, restart). */
  devTools?: boolean;
  /** When the fight ends, before the end card. */
  onEnd?: (r: BattleResult) => void;
  /** The end card's Continue button; without it the card offers Fight again. */
  onContinue?: (r: BattleResult) => void;
  className?: string;
  /** For tests: the running fight. */
  handleRef?: (h: BattleHandle | null) => void;
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
    figureFraming = 'auto',
    wards = true,
    difficulty = 'normal',
    rules,
    party,
    seed,
    tutorial,
    startAt,
    introCard = false,
    enemyTitle = 'Demon of the Den',
    introPace,
  } = props;
  const { introTitle = 'Ember Runes', introSub, allowRetry = false, mustWin = false, devTools = false } = props;
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
    seed,
    tutorial,
    startAt,
    introCard,
    enemyTitle,
    introPace,
    introTitle,
    introSub,
    allowRetry,
    mustWin,
    devTools,
    hasContinue,
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const s = JSON.parse(setup) as typeof props & { hasContinue: boolean };
    const h = mountBattle(el, {
      rules: s.rules ?? rulesFor({ wards: s.wards, difficulty: s.difficulty, enemyName: s.enemyName }),
      heroes: partyFor(s.party),
      enemyName: s.enemyName!,
      enemyImage: s.enemyImage!,
      enemyFigure: s.enemyFigure,
      enemyFigureHurt: s.enemyFigureHurt,
      stageImage: s.stageImage,
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
      allowRetry: !!s.allowRetry,
      mustWin: !!s.mustWin,
      hasContinue: s.hasContinue,
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
