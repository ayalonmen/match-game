import { RuneBattle, type Difficulty } from '../index';

// The demo page: ?solo for the fight without wards, ?difficulty=easy|normal|hard|brutal, ?seed=123.
const q = new URLSearchParams(location.search);
const difficulty = (q.get('difficulty') ?? 'normal') as Difficulty;
const seed = q.has('seed') ? Number(q.get('seed')) : undefined;

export function App() {
  return (
    <RuneBattle
      wards={!q.has('solo')}
      difficulty={difficulty}
      seed={seed}
      introSub={q.has('solo') ? 'Solo fight' : 'Combat demo'}
      devTools
      onEnd={(r) => console.info('[ember-runes] fight over', r)}
      handleRef={(h) => ((window as unknown as { __er: unknown }).__er = h?.debug)}
    />
  );
}
