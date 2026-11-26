import { RuneBattle, type Difficulty, type FigureFraming } from '../index';
import eddaImg from './assets/edda.webp';
import eddaHurtImg from './assets/edda-angry.webp';

// The demo page: the solo fight (?wards for the Ash and Hex wards), ?difficulty=easy|normal|hard|brutal, ?seed=123, ?card for the enemy
// card, ?dev for the test buttons, ?painting for Vexa's painting in place of the figure, ?framing=full|auto (default close).
const q = new URLSearchParams(location.search);
const difficulty = (q.get('difficulty') ?? 'normal') as Difficulty;
const seed = q.has('seed') ? Number(q.get('seed')) : undefined;
const figure = !q.has('painting');

export function App() {
  return (
    <RuneBattle
      wards={q.has('wards')}
      difficulty={difficulty}
      seed={seed}
      {...(figure
        ? {
            enemyName: 'Edda',
            enemyTitle: 'Huntress of the Pines',
            enemyFigure: eddaImg,
            enemyFigureHurt: eddaHurtImg,
            figureFraming: (q.get('framing') ?? 'close') as FigureFraming,
          }
        : {})}
      introSub={q.has('wards') ? 'Combat demo' : 'Solo fight'}
      tutorial={!q.has('card')}
      introCard={q.has('card')}
      devTools={q.has('dev')}
      onEnd={(r) => console.info('[ember-runes] fight over', r)}
      handleRef={(h) => ((window as unknown as { __er: unknown }).__er = h?.debug)}
    />
  );
}
