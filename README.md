# Ember Runes

The match-3 fight for Playful Roll: swap runes, send them at the enemy and her wards, charge the party's powers,
forge and throw d20s. See `docs/DESIGN.md`.

```sh
pnpm install
pnpm dev        # demo on http://localhost:5175 (?solo, ?difficulty=hard, ?seed=7)
pnpm check      # typecheck, lint, tests
```

```tsx
import { RuneBattle } from 'ember-runes';
import 'ember-runes/style.css';

<RuneBattle
  enemyName="Vexa"
  enemyImage={url}
  wards
  difficulty="normal"
  seed={42}
  onContinue={(r) => console.log(r.tier)}
/>;
```
