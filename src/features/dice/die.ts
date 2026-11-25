import * as THREE from 'three';
import { gsap } from 'gsap';
import { REST_Y, SPREAD, STEP, THROW, tipEase } from './throw';
import type { Face } from './die-model';
import type { DiceSounds as SoundBoard } from './sounds';

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** What every die on the stage shares. */
export interface DieWorld {
  scene: THREE.Scene;
  geometry: THREE.BufferGeometry;
  faces: Face[];
  shadowMap: THREE.Texture;
  /** The camera's home position: results face it. */
  cam0: THREE.Vector3;
  /** The camera's creep toward a teetering die: `k` 0..1, toward `at`. */
  creep: { k: number; at: THREE.Vector3 };
  sounds: SoundBoard;
  reduced: boolean;
  bevel: { color: number; roughness: number };
}

export interface ThrowOptions {
  /** Natural d20 result (1..20). Decided before the animation; the die is animated to land on it. */
  result: number;
  /** The line on the table, from under the hand to where the die rests, with a corner at each bounce. */
  path: THREE.Vector3[];
  tips: number;
  /** 0..1, from the flick. */
  power: number;
  /** 'full': the last tip hangs on its edge (close calls and criticals). */
  hang: 'full' | 'short';
  /** Flat spin (rad), unwinding as it rolls. */
  yaw: number;
  delay?: number;
  onBounce?: (die: Die) => void;
}

interface Segment {
  a: THREE.Vector3;
  d: THREE.Vector3;
  len: number;
  s0: number;
  axis: THREE.Vector3;
  remEnd: number;
  base: THREE.Quaternion;
}

/** One d20: its mesh, its shadow, and the throw that lands it on a decided face. */
export class Die {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Where the die rests after the current throw. */
  readonly rest = new THREE.Vector3(0, REST_Y, 0);
  /** 20 number faces, then the bevel. */
  readonly mats: THREE.MeshStandardMaterial[] = [];
  private base: THREE.Color[];
  private tl: gsap.core.Timeline | null = null;
  private readonly w: DieWorld;

  constructor(world: DieWorld) {
    this.w = world;
    for (let i = 0; i < 20; i++)
      this.mats.push(
        new THREE.MeshStandardMaterial({ metalness: 1, roughness: 1, bumpScale: 0.035, envMapIntensity: 1.15 }),
      );
    this.mats.push(
      new THREE.MeshStandardMaterial({
        color: world.bevel.color,
        metalness: 1,
        roughness: world.bevel.roughness,
        envMapIntensity: 1.25,
      }),
    );
    this.base = this.mats.map((m) => m.color.clone());
    this.mesh = new THREE.Mesh(world.geometry, this.mats);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: world.shadowMap, transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    world.scene.add(this.shadow, this.mesh);
    this.hide();
  }

  get visible() {
    return this.mesh.visible;
  }

  hide() {
    this.kill();
    this.mesh.visible = this.shadow.visible = false;
    this.mesh.scale.setScalar(1);
    this.setGlow(0, 0);
    this.setTint(1);
  }

  private kill() {
    this.tl?.kill();
    this.tl = null;
    gsap.killTweensOf(this.mesh.scale);
    gsap.killTweensOf(this.glow);
    gsap.killTweensOf(this.tint);
  }

  /** Rotates face `fi`'s normal toward the camera and twists it so the number reads upright. */
  targetQuat(fi: number) {
    const { faces, cam0 } = this.w;
    const dir = cam0.clone().sub(this.rest).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(faces[fi].n, dir);
    const u = faces[fi].up.clone().applyQuaternion(q1);
    u.sub(dir.clone().multiplyScalar(u.dot(dir))).normalize();
    const upT = new THREE.Vector3(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y)).normalize();
    const ang = Math.atan2(dir.dot(new THREE.Vector3().crossVectors(u, upT)), u.dot(upT));
    return new THREE.Quaternion().setFromAxisAngle(dir, ang).multiply(q1);
  }

  /** The number the player reads just before the last tip, for a roll arriving along `dir`. */
  faceBeforeLast(result: number, dir: THREE.Vector3) {
    const { faces, cam0 } = this.w;
    const axis = new THREE.Vector3().crossVectors(UP, dir).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, -STEP).multiply(this.targetQuat(result - 1));
    const cam = cam0.clone().sub(this.rest).normalize();
    let best = 0,
      bd = -2;
    faces.forEach((f, i) => {
      const d = f.n.clone().applyQuaternion(q).dot(cam);
      if (d > bd) {
        bd = d;
        best = i;
      }
    });
    return best + 1;
  }

  private tint = { v: 1 };
  /** Darkens the die (the one that doesn't count steps back). */
  setTint(v: number) {
    this.tint.v = v;
    this.mats.forEach((m, i) => m.color.copy(this.base[i]).multiplyScalar(v));
  }
  dim(to: number, duration: number, delay: number) {
    gsap.to(this.tint, { v: to, duration, delay, onUpdate: () => this.setTint(this.tint.v) });
    gsap.to(this.mesh.scale, { x: 0.8, y: 0.8, z: 0.8, duration, delay });
  }

  private glow = { k: 0 };
  setGlow(hex: number, k: number) {
    const c = new THREE.Color(hex).multiplyScalar(k);
    this.mats.forEach((m) => m.emissive.copy(c));
  }

  /** Emissive flash on every face (landing effect). */
  flash(hex: number, peak: number, dur: number) {
    this.glow.k = 0;
    gsap.to(this.glow, {
      k: peak,
      duration: dur,
      yoyo: true,
      repeat: 1,
      ease: 'sine.inOut',
      onUpdate: () => this.setGlow(hex, this.glow.k),
    });
  }

  /** Pops the die into the hand at `pos`, showing its 20. */
  appear(pos: THREE.Vector3, scale: number) {
    this.kill();
    this.setTint(1);
    this.setGlow(0, 0);
    this.rest.set(pos.x, REST_Y, pos.z);
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(this.targetQuat(19));
    this.mesh.visible = this.shadow.visible = true;
    gsap.fromTo(
      this.mesh.scale,
      { x: 0.001, y: 0.001, z: 0.001 },
      { x: scale, y: scale, z: scale, duration: this.w.reduced ? 0 : 0.45, ease: 'back.out(1.8)' },
    );
  }

  /** Shrinks the die away and hides it. */
  shrinkAway(duration: number) {
    if (!this.mesh.visible) return;
    this.kill();
    gsap.to(this.mesh.scale, {
      x: 0.001,
      y: 0.001,
      z: 0.001,
      duration,
      ease: 'power2.in',
      onComplete: () => this.hide(),
    });
  }

  /**
   * Throws the die from where it is held so it lands on `o.result` at the end of `o.path`. It flies
   * the first part of the path, then tips over one edge at a time, its position locked to its
   * rotation. Resolves the moment it lands on the result face (it then rocks back and settles).
   */
  throw(o: ThrowOptions): Promise<void> {
    const { reduced, sounds, creep } = this.w;
    this.kill();
    const m = this.mesh;
    const from = m.position.clone(),
      fromQuat = m.quaternion.clone();
    m.visible = this.shadow.visible = true;
    this.setTint(1);
    this.setGlow(0, 0);
    const pts = o.path;
    const rest = this.rest.copy(pts[pts.length - 1]);
    rest.y = REST_Y;
    const target = this.targetQuat(o.result - 1);

    const segs: Segment[] = [];
    let S = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pts[i + 1].clone().sub(pts[i]);
      d.y = 0;
      const len = d.length();
      if (len < 1e-4) continue;
      d.normalize();
      segs.push({
        a: pts[i],
        d,
        len,
        s0: S,
        axis: new THREE.Vector3().crossVectors(UP, d).normalize(),
        remEnd: 0,
        base: target,
      });
      S += len;
    }
    if (!segs.length) {
      // nowhere to go: a path of no length still needs a direction to tip along
      const d = new THREE.Vector3(0, 0, -1);
      segs.push({
        a: rest.clone(),
        d,
        len: 0,
        s0: 0,
        axis: new THREE.Vector3().crossVectors(UP, d),
        remEnd: 0,
        base: target,
      });
    }
    const tips = Math.max(1, Math.min(reduced ? 1 : o.tips, Math.floor(S / (STEP * SPREAD) + 1e-6)));
    const startRem = tips * STEP,
      sRoll = Math.max(0, S - startRem * SPREAD); // the die flies the first `sRoll` of the path, then rolls
    // rolling orientation, composed back from the result face: around each stretch's own axis, continuous through a bounce
    for (let i = segs.length - 1; i >= 0; i--) {
      const g = segs[i],
        nx = segs[i + 1];
      g.remEnd = (S - g.s0 - g.len) / SPREAD;
      g.base = nx
        ? new THREE.Quaternion().setFromAxisAngle(nx.axis, -(g.remEnd - nx.remEnd)).multiply(nx.base)
        : target.clone();
    }
    const segAt = (sv: number) => {
      for (const g of segs) if (sv <= g.s0 + g.len) return g;
      return segs[segs.length - 1];
    };
    const airAxis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    const hand = !reduced;
    if (hand) gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.3 });
    else m.scale.setScalar(1);
    const offx = hand ? from.x - pts[0].x : 0,
      offz = hand ? from.z - pts[0].z : 0;
    const h0 = hand ? Math.max(0, from.y - REST_Y) : 0;
    const arcH = hand ? 0.5 + o.power * 0.9 : 0;
    const air = clamp(0.36 + sRoll * 0.075, 0.44, 0.95);
    const airSpin = Math.PI * (0.8 + o.power * 1.2);
    const st = { rem: startRem, air: 0, u: 0, ya: h0, hy: 0, bh: 0, yaw: 1, blend: hand ? 0 : 1 };
    const qAir = new THREE.Quaternion(),
      qRoll = new THREE.Quaternion(),
      qYaw = new THREE.Quaternion(),
      qF = new THREE.Quaternion();
    let lastS = 0;
    const apply = () => {
      const sr = S - st.rem * SPREAD,
        sv = sr - sRoll * (1 - st.u),
        gp = segAt(Math.max(0, sv)),
        k = Math.max(0, sv) - gp.s0;
      const fade = (1 - st.u) * (1 - st.u);
      const frac = (((st.rem % STEP) + STEP) % STEP) / STEP,
        lift = 0.07 * Math.sin(Math.PI * frac); // centre rises while balanced on an edge
      m.position.set(
        gp.a.x + gp.d.x * k + offx * fade,
        REST_Y + st.ya + arcH * Math.sin(Math.PI * st.u) + st.hy + st.bh + lift,
        gp.a.z + gp.d.z * k + offz * fade,
      );
      for (let i = 1; i < segs.length; i++)
        if (lastS < segs[i].s0 && sv >= segs[i].s0) {
          // hit an edge of the table: a small hop
          gsap.fromTo(
            st,
            { bh: 0 },
            { bh: 0.16 + 0.2 * (1 - sv / S), duration: 0.11, yoyo: true, repeat: 1, ease: 'power1.out' },
          );
          o.onBounce?.(this);
        }
      lastS = sv;
      const gr = segAt(Math.max(0, sr));
      qYaw.setFromAxisAngle(UP, o.yaw * st.yaw);
      qAir.setFromAxisAngle(airAxis, airSpin * (1 - st.air));
      qRoll.setFromAxisAngle(gr.axis, -(st.rem - gr.remEnd));
      qF.copy(qYaw).multiply(qAir).multiply(qRoll).multiply(gr.base);
      if (st.blend < 1) m.quaternion.copy(fromQuat).slerp(qF, st.blend);
      else m.quaternion.copy(qF);
    };
    const tl = gsap.timeline({ onUpdate: apply, delay: o.delay ?? 0 });
    this.tl = tl;
    apply();

    // the durations of the tips; on a close call the last one is the hang
    const durs: number[] = [];
    let dur = THROW.first;
    const hang = o.hang === 'full' && !reduced ? rand(THROW.hang[0], THROW.hang[1]) : 0;
    for (let i = 0; i < tips; i++) {
      const last = i === tips - 1;
      durs.push(reduced ? 0.4 : last && hang ? hang : dur);
      dur *= THROW.tipGrow;
    }
    const early = durs.slice(0, -1).reduce((a, b) => a + b, 0);

    let t = 0;
    if (!reduced) {
      // 1. out of the hand and through the air
      tl.to(st, { air: 1, u: 1, duration: air, ease: 'none' }, 0).to(
        st,
        { ya: 0, duration: air, ease: 'power2.in' },
        0,
      );
      tl.to(st, { blend: 1, duration: 0.16, ease: 'none' }, 0);
      tl.call(
        () => {
          sounds.clack(0.9);
          sounds.buzz(12);
        },
        undefined,
        air,
      );
      t = air;
      // a few shrinking hops while it starts to roll
      let bt = t;
      const hopK = 0.55 + o.power * 0.6;
      THROW.hops.forEach((hop, i) => {
        const h = hop * hopK,
          up = 0.12 + h * 0.3;
        tl.to(st, { hy: h, duration: up, ease: 'power2.out' }, bt).to(
          st,
          { hy: 0, duration: up, ease: 'power2.in' },
          bt + up,
        );
        bt += up * 2;
        tl.call(() => sounds.clack(0.7 - i * 0.2), undefined, bt);
      });
      // the flat spin is spent by the time the last tip starts, so the teeter reads cleanly
      tl.to(st, { yaw: 0, duration: Math.max(0.9, air + early), ease: 'power3.out' }, 0);
    } else {
      st.air = 1;
      st.u = 1;
      st.ya = 0;
      st.yaw = 0;
      st.blend = 1;
    }

    // 2. rolling: each tip slower than the last
    for (let i = 0; i < tips; i++) {
      const last = i === tips - 1,
        d = durs[i];
      const k = reduced ? 0.3 : last && hang ? 0.97 : Math.min(0.85, 0.35 + i * 0.12);
      tl.to(st, { rem: (tips - i - 1) * STEP, duration: d, ease: tipEase(k) }, t);
      t += d;
      if (!last) {
        const v = 0.75 - i * 0.07;
        tl.call(() => sounds.clack(v), undefined, t);
      }
    }
    if (hang) {
      tl.call(
        () => {
          sounds.play('beat');
          sounds.buzz([18, 120, 14]);
        },
        undefined,
        t - hang * 0.55,
      );
      const start = Math.max(0, t - hang - 0.3);
      tl.call(
        () => {
          if (creep.k < 0.01) creep.at.copy(rest);
        },
        undefined,
        start,
      );
      tl.to(creep, { k: 1, duration: hang + 0.3, ease: 'sine.inOut' }, start);
    }

    // 3. lands on the result face, tries to tip over the next edge, rocks back and settles
    const landed = new Promise<void>((resolve) => tl.call(() => resolve(), undefined, t));
    if (!reduced) {
      const back = hang ? rand(0.22, 0.3) : rand(0.12, 0.18);
      tl.to(st, { rem: -back, duration: 0.42, ease: 'power2.out' }, t)
        .to(st, { rem: 0, duration: 0.32, ease: 'power2.in' }, t + 0.42)
        .call(() => sounds.clack(0.4), undefined, t + 0.74)
        .to(st, { rem: -0.05, duration: 0.12, ease: 'power1.out' }, t + 0.74)
        .to(st, { rem: 0, duration: 0.16, ease: 'power1.in' }, t + 0.86);
      if (hang) tl.to(creep, { k: 0, duration: 0.8, ease: 'power2.out' }, t + 0.6);
    }
    return landed;
  }

  dispose() {
    this.kill();
    this.mats.forEach((m) => m.dispose());
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
  }
}
