import { readSigil, SIGIL, sigilTemplate, type Pt, type SigilBonus, type SigilFit, type Stat } from './sigil';

type Sample = Pt & { t: number };

/**
 * The sigil while it is being drawn: follows the finger, keeps the last few seconds of the stroke,
 * asks the engine whether the sign is in it, and paints a faint ember trail and (once recognised)
 * the true shape burning in. Its canvas sits under the die at half resolution: it is all soft light.
 */
export class SigilTrail {
  readonly canvas = document.createElement('canvas');
  /** The best bonus the stroke has earned so far. It only goes up. */
  bonus: SigilBonus = 0;
  fit: SigilFit | null = null;
  /** Distance drawn (px), to tell a drawing from a plain flick. */
  length = 0;
  private on = false;
  private stat: Stat | null = null;
  private trail: Sample[] = [];
  private seen: Sample[] = [];
  private fade = 0;
  private flash = -9;
  private lastRead = 0;
  private dirty = false;
  private w = 1;
  private h = 1;

  constructor(private readonly reduced: boolean) {
    this.canvas.className = 'sigil-trail';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.round(w / 2));
    this.canvas.height = Math.max(1, Math.round(h / 2));
  }

  start(stat: Stat) {
    this.stat = stat;
    this.trail = [];
    this.seen = [];
    this.length = 0;
    this.bonus = 0;
    this.fit = null;
    this.flash = -9;
    this.on = true;
  }

  /** Stops reading. What is on screen fades out by itself. */
  stop() {
    this.on = false;
  }

  /** One last look at the stroke as the die leaves the hand. */
  finish(now: number) {
    if (this.on) this.read(now);
    this.stop();
  }

  private read(now: number): boolean {
    if (!this.stat) return false;
    const r = readSigil(this.trail, this.stat, this.w * 0.2);
    if (r.bonus <= this.bonus) return false;
    this.bonus = r.bonus;
    this.fit = r.fit;
    this.flash = now;
    return true;
  }

  /**
   * Each frame. `finger` is where the die is being led (null when it isn't held), read from the
   * finger itself, not the die, which trails a little behind and would round the corners.
   * Returns true on the frame the sign is recognised or improves.
   */
  update(now: number, finger: Pt | null): boolean {
    this.fade = Math.max(0, Math.min(1, this.fade + (this.on ? 0.07 : -0.035)));
    if (!this.on || !finger) return false;
    const last = this.trail[this.trail.length - 1];
    // one go: holding still starts over, and only the last few seconds of movement can form the sign
    if (last && now - last.t > SIGIL.stillSeconds) this.trail = [];
    else if (!last || Math.hypot(finger.x - last.x, finger.y - last.y) > 5) {
      if (last) this.length += Math.hypot(finger.x - last.x, finger.y - last.y);
      const s = { x: finger.x, y: finger.y, t: now };
      this.trail.push(s);
      this.seen.push(s);
    }
    while (this.trail.length && now - this.trail[0].t > SIGIL.seconds) this.trail.shift();
    if (now - this.lastRead > 0.07) {
      this.lastRead = now;
      return this.read(now);
    }
    return false;
  }

  draw(now: number) {
    const c = this.canvas.getContext('2d');
    if (!c) return;
    const W = this.w;
    c.setTransform(0.5, 0, 0, 0.5, 0, 0);
    if (this.dirty) {
      c.clearRect(0, 0, W, this.h);
      this.dirty = false;
    }
    if (this.fade <= 0) return;
    this.dirty = true;
    const f = this.fade,
      fl = Math.exp(-Math.max(0, now - this.flash) * 2.2);
    c.save();
    c.lineCap = c.lineJoin = 'round';
    c.globalCompositeOperation = 'lighter';
    // the trail: faint embers that die out within a second
    while (this.seen.length && now - this.seen[0].t > 1) this.seen.shift();
    const S = this.seen;
    if (!this.reduced)
      for (let i = 1; i < S.length; i++) {
        const a = Math.max(0, 1 - (now - S[i].t));
        if (a <= 0 || S[i].t - S[i - 1].t > 0.3) continue;
        for (const [lw, al] of [
          [W * 0.05, 0.07],
          [W * 0.014, 0.26],
        ]) {
          c.lineWidth = lw;
          c.strokeStyle = 'rgba(242,170,80,' + al * a * a * f + ')';
          c.beginPath();
          c.moveTo(S[i - 1].x, S[i - 1].y);
          c.lineTo(S[i].x, S[i].y);
          c.stroke();
        }
      }
    // once the sign is recognised, its true shape burns in over what was drawn
    if (this.fit && this.stat) {
      const g = this.fit;
      const P = sigilTemplate(this.stat).base.map((q) => ({ x: g.cx + q.x * g.size, y: g.cy + q.y * g.size }));
      const a = (this.bonus === SIGIL.clean ? 0.55 : 0.25) + 0.45 * fl;
      const line = (lw: number, col: string) => {
        c.lineWidth = lw;
        c.strokeStyle = col;
        c.beginPath();
        c.moveTo(P[0].x, P[0].y);
        for (let i = 1; i < P.length; i++) c.lineTo(P[i].x, P[i].y);
        c.stroke();
      };
      line(W * 0.11, 'rgba(242,170,80,' + 0.3 * a * f + ')');
      line(W * 0.035, 'rgba(255,230,180,' + a * f + ')');
    }
    c.restore();
  }
}
