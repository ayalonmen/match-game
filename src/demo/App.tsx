import { RuneBattle, type Difficulty, type FigureFraming } from '../index';
import eddaImg from './assets/edda.webp';
import eddaHurtImg from './assets/edda-angry.webp';

// The demo page: ?solo for the fight without wards, ?difficulty=easy|normal|hard|brutal, ?seed=123, ?card for the enemy
// card, ?painting for Vexa's painting in place of the figure, ?framing=full|close (default auto).
const q = new URLSearchParams(location.search);
const difficulty = (q.get('difficulty') ?? 'normal') as Difficulty;
const seed = q.has('seed') ? Number(q.get('seed')) : undefined;
const figure = !q.has('painting');

export function App() {
  return (
    <RuneBattle
      wards={!q.has('solo')}
      difficulty={difficulty}
      seed={seed}
      {...(figure
        ? {
            enemyName: 'Edda',
            enemyTitle: 'Huntress of the Pines',
            enemyFigure: eddaImg,
            enemyFigureHurt: eddaHurtImg,
            figureFraming: (q.get('framing') ?? 'auto') as FigureFraming,
          }
        : {})}
      introSub={q.has('solo') ? 'Solo fight' : 'Combat demo'}
      tutorial={!q.has('card')}
      introCard={q.has('card')}
      devTools
      onEnd={(r) => console.info('[ember-runes] fight over', r)}
      handleRef={(h) => ((window as unknown as { __er: unknown }).__er = h?.debug)}
    />
  );
}
