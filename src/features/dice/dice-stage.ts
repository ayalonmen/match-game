import * as THREE from 'three';
import { gsap } from 'gsap';
import { SIGIL, type SigilBonus, type SigilFit, type Stat } from './sigil';
import { Die } from './die';
import { dieGeometry, environment, faceMaps, shadowTexture, SKIN, type FaceMaps } from './die-model';
import { SigilTrail } from './sigil-trail';
import { LAYOUT, REST_Y, THROW } from './throw';
import type { DiceSounds as SoundBoard } from './sounds';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const IDLE_AXIS = new V3(0.3, 1, 0.2).normalize();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface AimOptions {
  /** One die, or two for advantage / disadvantage. */
  count: 1 | 2;
  /** The sign the player may draw before the throw, or null for a plain throw. */
  sigil: Stat | null;
  /** Bottom edge of whatever covers the top of the stage (the stakes card), in px: the table starts under it. */
  tableTop: number;
  /** The player picked the die up. */
  onGrab?: () => void;
}

/** What the player did with the die before it left the hand. */
export interface Release {
  /** Earned by drawing the sigil. */
  bonus: SigilBonus;
  /** They drew something (as opposed to just flicking), so the sigil deserves an answer. */
  drew: boolean;
  /** Where the recognised sign sits on the stage, in px. */
  fit: SigilFit | null;
}

export interface ThrowRequest {
  /** Natural result of each die (1..20). Decided before the animation; each die is animated to land on its own. */
  results: number[];
  /** Per die: 'full' makes the last tip hang (close calls and criticals). */
  hang: ('full' | 'short')[];
  /**
   * Whether a face would pass the check. With it, a hanging die's last stretch is nudged so the face
   * it teeters on is the opposite of the result: a win hangs on a losing face, and the other way round.
   */
  wins?: (face: number) => boolean;
}

/** Called for sparks: a point in the host's px, how many and how hard. */
export type Spark = (x: number, y: number, count: number, power: number) => void;

interface Held {
  id: number;
  touch: boolean;
  x0: number;
  y0: number;
  moved: number;
  samples: { x: number; y: number; t: number }[];
  pvx: number;
  pvy: number;
}

/**
 * The dice table (Three.js r128 + GSAP), covering the whole stage. The die waits in the thumb zone;
 * the player picks it up, may draw the check's sigil with it, and flicks it. The flick sets the path
 * (see throw.ts); the result is decided by the caller between `aim` and `throwHeld`, so the die is
 * always animated to a face that was already chosen. Hidden between rolls.
 */
export class DiceStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  // the prototype's camera angle, 1.8× further back so the die also reads well low in the thumb zone
  private PIVOT = new V3(0, 0.55, 0);
  private CAM0 = new V3(0, 0.55 + 3.85 * 1.8, 5.2 * 1.8);
  private creep = { k: 0, at: new V3(0, 0.55, 0) };
  private all: Die[];
  private dice: Die[] = [];
  private maps: FaceMaps[] = [];
  private geometry: THREE.BufferGeometry;
  private shadowMap: THREE.Texture;
  private trail: SigilTrail;
  private raf = 0;
  private lastT = performance.now();
  private disposed = false;

  private W = 1;
  private H = 1;
  private restPx = { x: 0, y: 0 };
  private homeWorld = new V3();
  private pointerWorld = new V3();

  private phase: 'idle' | 'aim' | 'released' | 'rolling' = 'idle';
  private aimOpts: AimOptions | null = null;
  private resolveAim: ((r: Release | null) => void) | null = null;
  private held: Held | null = null;
  private flick = { vx: 0, vy: 0, tap: true, vw: new V3() };
  private lastRattle = 0;

  private readonly host: HTMLElement;
  private readonly sounds: SoundBoard;
  private readonly reduced: boolean;
  private readonly spark: Spark;
  private readonly icons?: readonly string[];

  /** `icons`: an icon (SVG path, 100x100 box) for each face 1-20, engraved in place of the numbers. */
  constructor(
    host: HTMLElement,
    sounds: SoundBoard,
    reduced: boolean,
    spark: Spark = () => {},
    icons?: readonly string[],
  ) {
    this.host = host;
    this.icons = icons;
    this.sounds = sounds;
    this.reduced = reduced;
    this.spark = spark;
    const { scene, camera } = this;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    this.renderer = renderer;
    this.trail = new SigilTrail(reduced);
    host.append(this.trail.canvas, renderer.domElement);

    camera.position.copy(this.CAM0);
    camera.lookAt(this.PIVOT);

    scene.add(new THREE.AmbientLight(0xffe2b0, 0.4));
    const key = new THREE.DirectionalLight(0xfff0d6, 1.15);
    key.position.set(-3, 6, 4);
    scene.add(key);
    const fire = new THREE.PointLight(0xff7a2f, 1.6, 16);
    fire.position.set(2.2, 0.4, 3.6);
    scene.add(fire);
    const rim = new THREE.DirectionalLight(0xc9a464, 0.7);
    rim.position.set(0, 3, -5);
    scene.add(rim);
    scene.environment = environment(renderer);

    const { geometry, faces } = dieGeometry();
    this.geometry = geometry;
    this.shadowMap = shadowTexture();
    const world = {
      scene,
      geometry,
      faces,
      shadowMap: this.shadowMap,
      cam0: this.CAM0,
      creep: this.creep,
      sounds,
      reduced,
      bevel: { color: SKIN.bevel, roughness: SKIN.bevelRough },
    };
    // the second die is only for advantage / disadvantage
    this.all = [new Die(world), new Die(world)];
    this.paintNumbers();
    // redraw the numbers once Cinzel has loaded
    if (document.fonts && document.fonts.load)
      document.fonts.load('900 76px Cinzel').then(
        () => this.paintNumbers(),
        () => {},
      );

    host.addEventListener('pointerdown', this.onDown);
    host.addEventListener('pointermove', this.onMove);
    host.addEventListener('pointerup', this.onUp);
    host.addEventListener('pointercancel', this.onUp);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.frame(performance.now());
  }

  private paintNumbers() {
    if (this.disposed) return;
    const fresh: FaceMaps[] = [];
    for (let n = 1; n <= 20; n++) fresh.push(faceMaps(n, this.icons?.[n - 1]));
    this.all.forEach((d) =>
      d.mats.forEach((m, i) => {
        if (i >= 20) return;
        m.map = fresh[i].map;
        m.bumpMap = fresh[i].bump;
        m.roughnessMap = fresh[i].rm;
        m.metalnessMap = fresh[i].rm;
        m.needsUpdate = true;
      }),
    );
    this.disposeMaps();
    this.maps = fresh;
  }

  private disposeMaps() {
    this.maps.forEach((t) => {
      t.map.dispose();
      t.bump.dispose();
      t.rm.dispose();
    });
    this.maps = [];
  }

  /** The point on the plane at height `y` that shows at (px, py) on the stage. */
  private worldAt(px: number, py: number, y: number) {
    const { camera } = this;
    const v = new V3((px / this.W) * 2 - 1, 1 - (py / this.H) * 2, 0.5).unproject(camera),
      d = v.sub(camera.position),
      t = (y - camera.position.y) / d.y;
    return camera.position.clone().add(d.multiplyScalar(t));
  }

  private resize = () => {
    const W = this.host.clientWidth,
      H = this.host.clientHeight;
    if (!W || !H) return;
    this.W = W;
    this.H = H;
    const { camera, CAM0, PIVOT } = this;
    this.renderer.setSize(W, H, false);
    this.trail.resize(W, H);
    // the table's centre shows at restPx: the view is the upper part of a taller one centred there,
    // and the field of view keeps the table the same width on any phone
    this.restPx = { x: W / 2, y: LAYOUT.restY(H) };
    const shift = H / 2 - this.restPx.y,
      HF = H + 2 * shift;
    camera.aspect = W / HF;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((2.55 / CAM0.distanceTo(PIVOT)) * (HF / W)));
    camera.setViewOffset(W, HF, 0, 2 * shift, W, H);
    camera.updateProjectionMatrix();
    camera.position.copy(CAM0);
    camera.lookAt(PIVOT);
    camera.updateMatrixWorld();
    this.homeWorld.copy(this.worldAt(W / 2, LAYOUT.homeY(H), LAYOUT.holdY));
  };

  /** Where the die waits in the hand, in the host's px (for placing a hint under it). */
  get homePoint() {
    return { x: this.W / 2, y: LAYOUT.homeY(this.H) };
  }

  private handOffset(i: number) {
    return this.dice.length === 1 ? new V3() : new V3(i ? LAYOUT.pairHold : -LAYOUT.pairHold, 0, i ? 0.15 : 0);
  }

  // ---------- the hand: pick up, lead, let go ----------

  /**
   * Puts the die in the player's hand and waits for them to throw it. Resolves as the die leaves the
   * hand with what they earned, or with null when the aim is cancelled. Follow with `throwHeld`.
   */
  aim(o: AimOptions): Promise<Release | null> {
    this.cancelAim();
    this.aimOpts = o;
    this.dice = this.all.slice(0, o.count);
    this.all.forEach((d) => {
      if (!this.dice.includes(d)) d.hide();
    });
    this.creep.k = 0;
    const scale = o.count === 2 ? 0.7 : o.sigil ? 0.85 : 1;
    this.dice.forEach((d, i) => d.appear(this.homeWorld.clone().add(this.handOffset(i)), scale));
    if (o.sigil) this.trail.start(o.sigil);
    this.phase = 'aim';
    this.host.dataset.aim = 'true';
    this.sounds.play('tick');
    return new Promise((resolve) => {
      this.resolveAim = resolve;
    });
  }

  /** Takes the die back out of the hand (the player went back, or the screen moved on). */
  cancelAim(duration = 0) {
    if (this.phase !== 'aim' && this.phase !== 'released') return;
    this.endAim();
    this.phase = 'idle';
    this.shrinkAway(duration);
    const done = this.resolveAim;
    this.resolveAim = null;
    done?.(null);
  }

  private endAim() {
    if (this.held) {
      try {
        this.host.releasePointerCapture(this.held.id);
      } catch {
        /* already gone */
      }
    }
    this.held = null;
    this.trail.stop();
    delete this.host.dataset.aim;
  }

  private localXY(e: PointerEvent) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    if (this.phase !== 'aim' || this.held) return;
    const p = this.localXY(e);
    const near = this.dice.some((d) => {
      const s = this.pointOf(d);
      return Math.hypot(s.x - p.x, s.y - p.y) < LAYOUT.grab;
    });
    if (!near) return;
    const touch = e.pointerType === 'touch';
    this.held = {
      id: e.pointerId,
      touch,
      x0: p.x,
      y0: p.y,
      moved: 0,
      samples: [{ x: p.x, y: p.y, t: performance.now() }],
      pvx: 0,
      pvy: 0,
    };
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    this.pointerWorld.copy(this.worldAt(p.x, p.y - (touch ? LAYOUT.touchLift : 0), LAYOUT.holdY));
    this.sounds.play('tick');
    this.aimOpts?.onGrab?.();
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    const held = this.held;
    if (!held || e.pointerId !== held.id) return;
    const p = this.localXY(e),
      now = performance.now(),
      last = held.samples[held.samples.length - 1];
    held.moved = Math.max(held.moved, Math.hypot(p.x - held.x0, p.y - held.y0));
    const dt = Math.max(1, now - last.t),
      vx = ((p.x - last.x) / dt) * 1000,
      vy = ((p.y - last.y) / dt) * 1000;
    // shaking the die rattles it
    if (vx * held.pvx + vy * held.pvy < 0 && Math.hypot(vx, vy) > 320 && now - this.lastRattle > 80) {
      this.lastRattle = now;
      this.sounds.clack(0.22);
      this.sounds.buzz(6);
    }
    held.pvx = vx;
    held.pvy = vy;
    held.samples.push({ x: p.x, y: p.y, t: now });
    if (held.samples.length > 12) held.samples.shift();
    this.pointerWorld.copy(
      this.worldAt(
        clamp(p.x, 30, this.W - 30),
        clamp(p.y - (held.touch ? LAYOUT.touchLift : 0), 90, this.H - 30),
        LAYOUT.holdY,
      ),
    );
  };

  private onUp = (e: PointerEvent) => {
    const held = this.held;
    if (!held || e.pointerId !== held.id || this.phase !== 'aim') return;
    const now = performance.now(),
      recent = held.samples.filter((s) => now - s.t < 110),
      a = recent[0],
      b = recent[recent.length - 1];
    const flick = this.flick;
    flick.vx = flick.vy = 0;
    flick.vw.set(0, 0, 0);
    flick.tap = held.moved < 14;
    if (a && b && b.t - a.t > 8) {
      const k = 1000 / (b.t - a.t);
      flick.vx = (b.x - a.x) * k;
      flick.vy = (b.y - a.y) * k;
      flick.vw
        .copy(this.worldAt(b.x, b.y, REST_Y))
        .sub(this.worldAt(a.x, a.y, REST_Y))
        .multiplyScalar(k);
    }
    // the sigil is settled the moment the die leaves the hand
    const trail = this.trail;
    trail.finish(now / 1000);
    const drew = Boolean(this.aimOpts?.sigil) && trail.length >= this.W * 0.35;
    const release: Release = { bonus: this.aimOpts?.sigil ? trail.bonus : 0, drew, fit: trail.fit };
    this.endAim();
    this.phase = 'released';
    const done = this.resolveAim;
    this.resolveAim = null;
    done?.(release);
  };

  private updateHand(dt: number, time: number) {
    if (this.phase !== 'aim') return;
    const { held, reduced } = this;
    this.dice.forEach((d, i) => {
      const tgt = (held ? this.pointerWorld : this.homeWorld).clone().add(this.handOffset(i));
      if (!held && !reduced) tgt.y += Math.sin(time * 2.2 + i * 1.7) * 0.09;
      const prev = d.mesh.position.clone();
      d.mesh.position.lerp(tgt, held ? 0.38 : 0.14);
      // it rolls the way it is led
      const delta = d.mesh.position.clone().sub(prev);
      delta.y = 0;
      const len = delta.length();
      if (len > 1e-4) d.mesh.rotateOnWorldAxis(new V3().crossVectors(UP, delta).normalize(), len * 1.15);
      if (!reduced) d.mesh.rotateOnWorldAxis(IDLE_AXIS, dt * (held ? 2.4 : 0.55) * (i ? -1 : 1));
      d.setGlow(0xe2702e, held ? 0.16 : 0.07 + 0.06 * Math.sin(time * 3.2));
    });
  }

  // ---------- the throw ----------

  /**
   * Throws what the player just let go of, along their flick, so each die lands on its decided
   * result. Resolves the moment the dice land (they then rock back and settle).
   */
  throwHeld(req: ThrowRequest): Promise<void> {
    if (this.phase !== 'released') return Promise.resolve();
    this.phase = 'rolling';
    const { dice, W, H, sounds } = this;
    const { vx, vy, tap, vw } = this.flick;
    const speed = Math.hypot(vx, vy),
      two = dice.length === 2;
    const hand = dice.reduce((v, d) => v.add(d.mesh.position), new V3()).divideScalar(dice.length);
    hand.y = REST_Y;
    const centre = this.worldAt(this.restPx.x, this.restPx.y, REST_Y);
    let power: number, dist: number;
    const base = new V3();
    if (speed < THROW.flickSpeed) {
      // a tap tosses it to the middle; letting go slowly drops it close to where it is held
      base.copy(centre).sub(hand);
      base.y = 0;
      const d0 = base.length();
      if (d0 < 0.4) base.set(rand(-0.4, 0.4), 0, -1);
      base.normalize();
      power = 0.3;
      dist = tap ? Math.max(d0, 1.6) : 1.9;
    } else {
      // the flick's real speed and direction on the table: how far it goes is the player's to judge
      vw.y = 0;
      dist = clamp(vw.length() * THROW.distPerSpeed, THROW.distMin, THROW.distMax);
      base.copy(vw).normalize();
      power = clamp(dist / THROW.fullPower, 0, 1);
    }
    sounds.play('whoosh', 0.3 + power * 0.5);

    // the table: the free part of the screen, as four walls on the table plane
    const sb = this.aimOpts?.tableTop ?? 60,
      xtra = two ? W * 0.265 : 0,
      mt = Math.min(W * 0.2 + xtra, W / 2 - 6),
      mb = Math.min(W * 0.28 + xtra, W / 2 - 6),
      yb = H - 92 - W * 0.3;
    const quad = [
      [mt, sb + W * 0.21],
      [W - mt, sb + W * 0.21],
      [W - mb, yb],
      [mb, yb],
    ].map(([x, y]) => this.worldAt(x, y, REST_Y));
    const mid = quad.reduce((v, c) => v.add(c), new V3()).divideScalar(4);
    const walls = quad.map((a, i) => {
      const e = quad[(i + 1) % 4].clone().sub(a),
        n = new V3(-e.z, 0, e.x).normalize();
      if (n.dot(mid.clone().sub(a)) < 0) n.negate();
      return { a, n };
    });
    const p = hand.clone();
    walls.forEach((w) => {
      const d = p.clone().sub(w.a).dot(w.n);
      if (d < 0.05) p.add(w.n.clone().multiplyScalar(0.05 - d));
    });
    const pts = [p.clone()],
      d = base.clone();
    let left = dist;
    for (let k = 0; k < THROW.bounces && left > 0.05; k++) {
      let tMin = Infinity,
        hit: (typeof walls)[number] | null = null;
      for (const w of walls) {
        const dn = d.dot(w.n);
        if (dn < -1e-6) {
          const t = w.a.clone().sub(p).dot(w.n) / dn;
          if (t >= 0 && t < tMin) {
            tMin = t;
            hit = w;
          }
        }
      }
      if (!hit || tMin >= left) {
        p.add(d.clone().multiplyScalar(left));
        pts.push(p.clone());
        break;
      }
      p.add(d.clone().multiplyScalar(tMin));
      pts.push(p.clone());
      d.reflect(hit.n).normalize();
      left = (left - tMin) * THROW.bounceKeep; // each bounce costs energy
    }
    if (pts.length > 2 && pts[pts.length - 1].distanceTo(pts[pts.length - 2]) < 0.4) pts.pop();

    const landed = dice.map((die, i) => {
      const n = req.results[i] ?? req.results[0];
      const shift = new V3(two ? (i ? LAYOUT.pairRest : -LAYOUT.pairRest) : 0, 0, 0),
        path = pts.map((q) => q.clone().add(shift));
      const last = path.length - 1;
      const hang = req.hang[i] ?? 'short';
      die.rest.copy(path[last]);
      if (req.wins && hang === 'full' && last > 0) {
        const want = !req.wins(n),
          seg = path[last].clone().sub(path[last - 1]),
          len = seg.length();
        seg.normalize();
        for (const off of [0, 0.12, -0.12, 0.24, -0.24]) {
          const cand = seg.clone().applyAxisAngle(UP, off);
          if (req.wins(die.faceBeforeLast(n, cand)) === want) {
            path[last] = path[last - 1].clone().add(cand.multiplyScalar(len));
            die.rest.copy(path[last]);
            break;
          }
        }
      }
      return die.throw({
        result: n,
        path,
        tips: THROW.tipsMin + Math.round(power * THROW.tipsPower),
        power,
        hang,
        yaw: Math.PI * (4 + power * 6) * (vx < 0 ? 1 : -1) * (i ? -1 : 1),
        delay: i * 0.07,
        onBounce: (dd) => {
          sounds.clack(0.85);
          sounds.buzz(14);
          const at = this.pointOf(dd);
          this.spark(at.x, at.y, 10, 0.5);
        },
      });
    });
    return Promise.all(landed).then(() => {
      if (this.phase === 'rolling') this.phase = 'idle';
    });
  }

  // ---------- after the throw ----------

  /** Emissive flash on die `i` (landing effect). */
  flash(hex: number, peak: number, dur: number, i = 0) {
    this.dice[i]?.flash(hex, peak, dur);
  }

  /** With two dice, the one that doesn't count steps back. */
  dimOthers(kept: number) {
    this.dice.forEach((d, i) => {
      if (i !== kept) d.dim(0.32, 0.4, 0.15);
    });
  }

  /** Shrinks the dice away and hides them. */
  shrinkAway(duration: number) {
    if (this.phase === 'rolling') this.phase = 'idle';
    this.all.forEach((d) => (duration > 0 ? d.shrinkAway(duration) : d.hide()));
    gsap.killTweensOf(this.creep);
    gsap.to(this.creep, { k: 0, duration: 0.3 });
  }

  private pointOf(d: Die) {
    const v = d.mesh.position.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.W, y: ((1 - v.y) / 2) * this.H };
  }

  /** Die `i`'s centre in coordinates relative to `container` (for particle bursts and the verdict). */
  screenPoint(container: HTMLElement, i = 0) {
    const d = this.dice[i] ?? this.all[0];
    const p = this.pointOf(d);
    const sr = container.getBoundingClientRect(),
      hr = this.host.getBoundingClientRect();
    return { x: hr.left - sr.left + p.x, y: hr.top - sr.top + p.y };
  }

  /** How many dice are in play. */
  get count() {
    return this.dice.length;
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastT) / 1000),
      now = nowMs / 1000;
    this.lastT = nowMs;
    this.updateHand(dt, now);
    const held = this.held,
      hs = held?.samples[held.samples.length - 1];
    const finger = held && hs ? { x: hs.x, y: hs.y - (held.touch ? LAYOUT.touchLift : 0) } : null;
    if (this.trail.update(now, finger)) {
      // the sign is recognised (or got better) while still in the hand
      const { bonus, fit } = this.trail;
      if (bonus === SIGIL.clean) {
        this.sounds.play('cross');
        this.sounds.buzz([10, 30, 20]);
        if (fit) this.spark(fit.cx, fit.cy, 30, 0.8);
      } else {
        this.sounds.play('tick');
        this.sounds.buzz(8);
      }
    }
    // the camera creeps straight at a teetering die, which keeps its place on screen
    this.camera.position.copy(this.CAM0).lerp(this.creep.at, THROW.creep * this.creep.k);
    for (const d of this.all) {
      if (!d.visible) continue;
      const hgt = Math.max(0, d.mesh.position.y - REST_Y),
        s = 1 / (1 + hgt * 0.35);
      d.shadow.position.x = d.mesh.position.x;
      d.shadow.position.z = d.mesh.position.z;
      d.shadow.scale.set(s, s, s);
      d.shadow.material.opacity = 0.9 * s;
    }
    this.renderer.render(this.scene, this.camera);
    this.trail.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    this.disposed = true;
    this.cancelAim();
    cancelAnimationFrame(this.raf);
    gsap.killTweensOf(this.creep);
    const { host } = this;
    host.removeEventListener('pointerdown', this.onDown);
    host.removeEventListener('pointermove', this.onMove);
    host.removeEventListener('pointerup', this.onUp);
    host.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.resize);
    this.all.forEach((d) => d.dispose());
    this.disposeMaps();
    this.geometry.dispose();
    this.shadowMap.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.trail.canvas.remove();
  }
}
