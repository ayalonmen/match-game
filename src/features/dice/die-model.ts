import * as THREE from 'three';

/*
  The die: a crimson icosahedron with every edge and corner cut back into a rounded gold bevel, and the
  numbers engraved (a bump map plus a roughness/metalness map per face).
*/

/** UV corners of each face's triangle inside its 256×256 texture. */
const TA: [number, number] = [0.5, 0.93];
const TB: [number, number] = [0.06, 0.17];
const TC: [number, number] = [0.94, 0.17];

/**
 * The die's look. Ember Runes (2026-11-26) matches Ayalon's antique gold d20: amber faces with fiery veins,
 * heavy gold edges and gold engravings.
 */
export const SKIN = {
  top: '#7a2c08',
  bot: '#260800',
  /** The engraving's ink, top to bottom. */
  num: ['#fff4c4', '#f2c560', '#a8741e'] as const,
  line: '#e8b45a',
  /** Glowing veins in the amber. */
  vein: 'rgba(255,190,90,',
  bevel: 0xe0aa48,
  bevelRough: 0.22,
  rough: 0.62,
  metal: 0,
  numRough: 0.32,
  numMetal: 1,
};

export interface FaceMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  /** Roughness in green, metalness in blue. */
  rm: THREE.CanvasTexture;
}

const canvas = (w: number, h: number) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
};

/**
 * One face: colour, an engraving height map, and a roughness / metalness map. With `icon` (an SVG path in a
 * 100x100 box, filled even-odd) the face carries that icon instead of its number; face 20 still shines.
 */
export function faceMaps(num: number, icon?: string): FaceMaps {
  const glyph = icon ? new Path2D(icon) : null;
  const sk = SKIN;
  const P = (t: [number, number]) => [t[0] * 256, (1 - t[1]) * 256];
  const pa = P(TA),
    pb = P(TB),
    pc = P(TC);
  const font = '900 ' + (num >= 10 ? 70 : 82) + 'px Cinzel, Georgia, serif';
  // everything that is cut into the face: a border, three pips and the number
  const marks = (x: CanvasRenderingContext2D, fill: string | CanvasGradient, lw: number) => {
    x.strokeStyle = fill;
    x.fillStyle = fill;
    x.lineWidth = lw;
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(pa[0], pa[1] + 30);
    x.lineTo(pb[0] + 28, pb[1] - 16);
    x.lineTo(pc[0] - 28, pc[1] - 16);
    x.closePath();
    x.stroke();
    [
      [pa[0], pa[1] + 50],
      [pb[0] + 47, pb[1] - 27],
      [pc[0] - 47, pc[1] - 27],
    ].forEach(([cx, cy]) => {
      x.beginPath();
      x.moveTo(cx, cy - 5);
      x.lineTo(cx + 5, cy);
      x.lineTo(cx, cy + 5);
      x.lineTo(cx - 5, cy);
      x.closePath();
      x.fill();
    });
    if (glyph) {
      x.save();
      x.translate(128 - 44, 150 - 46);
      x.scale(0.88, 0.88);
      x.fill(glyph, 'evenodd');
      x.restore();
      return;
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = font;
    x.fillText(String(num), 128, 150);
    if (num === 6 || num === 9) x.fillRect(108, 190, 40, 6);
  };

  const col = canvas(256, 256),
    x = col.getContext('2d')!;
  const bg = x.createRadialGradient(128, 140, 10, 128, 140, 150);
  bg.addColorStop(0, sk.top);
  bg.addColorStop(1, sk.bot);
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 256);
  // fiery veins through the amber
  x.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let vx = Math.random() * 256,
      vy = Math.random() * 256,
      a = Math.random() * 6.283;
    x.strokeStyle = sk.vein + (0.12 + Math.random() * 0.18) + ')';
    x.lineWidth = 0.8 + Math.random() * 1.4;
    x.beginPath();
    x.moveTo(vx, vy);
    for (let j = 0; j < 7; j++) {
      a += (Math.random() - 0.5) * 1.6;
      vx += Math.cos(a) * 14;
      vy += Math.sin(a) * 14;
      x.lineTo(vx, vy);
    }
    x.stroke();
  }
  // a little grain
  for (let i = 0; i < 260; i++) {
    x.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,235,200' : '0,0,0') + ',' + Math.random() * 0.05 + ')';
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const ink = x.createLinearGradient(0, 105, 0, 195);
  ink.addColorStop(0, sk.num[0]);
  ink.addColorStop(0.45, sk.num[1]);
  ink.addColorStop(1, sk.num[2]);
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.75)';
  x.shadowBlur = 5;
  x.shadowOffsetY = 3;
  marks(x, num === 20 ? sk.num[0] : ink, 2.5);
  x.restore();
  if (num !== 20) {
    x.globalAlpha = 0.9;
    marks(x, ink, 2.5);
    x.globalAlpha = 1;
  }
  const map = new THREE.CanvasTexture(col);
  map.encoding = THREE.sRGBEncoding;
  map.anisotropy = 8;

  const bc = canvas(256, 256),
    bx = bc.getContext('2d')!;
  bx.fillStyle = '#9a9a9a';
  bx.fillRect(0, 0, 256, 256);
  bx.shadowColor = '#000';
  bx.shadowBlur = 3;
  marks(bx, '#141414', 3);
  const bump = new THREE.CanvasTexture(bc);
  bump.anisotropy = 8;

  const rc = canvas(256, 256),
    rx = rc.getContext('2d')!;
  const ch = (v: number) => Math.round(v * 255);
  rx.fillStyle = 'rgb(0,' + ch(sk.rough) + ',' + ch(sk.metal) + ')';
  rx.fillRect(0, 0, 256, 256);
  marks(rx, 'rgb(0,' + ch(sk.numRough) + ',' + ch(sk.numMetal) + ')', 2.5);
  const rm = new THREE.CanvasTexture(rc);
  rm.anisotropy = 8;
  return { map, bump, rm };
}

/** Soft radial shadow blob for the table. */
export function shadowTexture(): THREE.CanvasTexture {
  const sc = canvas(128, 128);
  const sx = sc.getContext('2d')!,
    gr = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = gr;
  sx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(sc);
}

/** Reflections: a small painted room (soft key light above, firelight low, a gold rim) as an environment map. */
export function environment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const c = canvas(512, 256),
    x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#6b5a48');
  g.addColorStop(0.42, '#2a1d14');
  g.addColorStop(0.5, '#120b07');
  g.addColorStop(1, '#3a1c0c');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  const blob = (cx: number, cy: number, rx: number, ry: number, col: string) => {
    x.save();
    x.translate(cx, cy);
    x.scale(rx, ry);
    const r = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    r.addColorStop(0, col);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = r;
    x.beginPath();
    x.arc(0, 0, 1, 0, 6.3);
    x.fill();
    x.restore();
  };
  blob(150, 40, 90, 46, 'rgba(255,244,222,1)');
  blob(380, 60, 60, 30, 'rgba(255,226,170,0.85)');
  blob(330, 190, 110, 50, 'rgba(255,122,47,0.95)');
  blob(40, 150, 50, 26, 'rgba(201,164,100,0.8)');
  blob(470, 130, 40, 60, 'rgba(255,200,120,0.6)');
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.encoding = THREE.sRGBEncoding;
  const pm = new THREE.PMREMGenerator(renderer),
    env = pm.fromEquirectangular(t).texture;
  pm.dispose();
  t.dispose();
  return env;
}

export interface Face {
  /** Outward normal. */
  n: THREE.Vector3;
  /** Direction of the number's top, in the face's plane. */
  up: THREE.Vector3;
}

/**
 * The geometry. The 20 number faces stay in their planes, inset (groups 0..19), so the die rests and
 * reads as a plain icosahedron would; group 20 is the bevel: a strip along each edge and a cap on
 * each corner, with normals that run from one face's to the next so the flat strips shade as round.
 */
export function dieGeometry(): { geometry: THREE.BufferGeometry; faces: Face[] } {
  const V3 = THREE.Vector3;
  let ico: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 0);
  if (ico.index) ico = ico.toNonIndexed();
  const src = ico.attributes.position as THREE.BufferAttribute;
  const INSET = 0.2;
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [];
  const faces: Face[] = [];
  type Corner = { c: THREE.Vector3; n: THREE.Vector3 };
  type Edge = { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 };
  const key = (v: THREE.Vector3) => v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3);
  const corners = new Map<string, { p: THREE.Vector3; list: Corner[] }>();
  const edges = new Map<string, Edge[]>();
  const push = (p: THREE.Vector3, n: THREE.Vector3, u: [number, number]) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(u[0], u[1]);
  };
  // a triangle wound to face outward
  const tri = (
    a: THREE.Vector3,
    na: THREE.Vector3,
    b: THREE.Vector3,
    nb: THREE.Vector3,
    c: THREE.Vector3,
    nc: THREE.Vector3,
  ) => {
    const out = new V3().crossVectors(b.clone().sub(a), c.clone().sub(a)).dot(a.clone().add(b).add(c)) > 0;
    push(a, na, [0, 0]);
    if (out) {
      push(b, nb, [0, 0]);
      push(c, nc, [0, 0]);
    } else {
      push(c, nc, [0, 0]);
      push(b, nb, [0, 0]);
    }
  };
  for (let f = 0; f < 20; f++) {
    const v = [0, 1, 2].map((k) => new V3().fromBufferAttribute(src, f * 3 + k));
    const cen = v[0].clone().add(v[1]).add(v[2]).divideScalar(3),
      n = cen.clone().normalize();
    faces.push({ n, up: v[0].clone().sub(cen).normalize() });
    const ins = v.map((p) => p.clone().lerp(cen, INSET));
    push(ins[0], n, TA);
    push(ins[1], n, TB);
    push(ins[2], n, TC);
    v.forEach((p, k) => {
      const kk = key(p);
      if (!corners.has(kk)) corners.set(kk, { p, list: [] });
      corners.get(kk)!.list.push({ c: ins[k], n });
      const q = v[(k + 1) % 3],
        kq = key(q),
        ek = [kk, kq].sort().join('|');
      if (!edges.has(ek)) edges.set(ek, []);
      const pair = kk < kq ? [ins[k], ins[(k + 1) % 3]] : [ins[(k + 1) % 3], ins[k]];
      edges.get(ek)!.push({ a: pair[0], b: pair[1], n });
    });
  }
  edges.forEach(([e1, e2]) => {
    tri(e1.a, e1.n, e1.b, e1.n, e2.a, e2.n);
    tri(e1.b, e1.n, e2.b, e2.n, e2.a, e2.n);
  });
  corners.forEach(({ p, list }) => {
    const axis = p.clone().normalize();
    const mid = list
      .reduce((s, c) => s.add(c.c), new V3())
      .divideScalar(list.length)
      .add(axis.clone().multiplyScalar(0.012));
    const ref = list[0].c.clone().sub(mid),
      side = new V3().crossVectors(axis, ref);
    const angle = (c: Corner) => {
      const d = c.c.clone().sub(mid);
      return Math.atan2(d.dot(side), d.dot(ref));
    };
    list.sort((A, B) => angle(A) - angle(B));
    list.forEach((c, i) => {
      const d = list[(i + 1) % list.length];
      tri(mid, axis, c.c, c.n, d.c, d.n);
    });
  });
  ico.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (let f = 0; f < 20; f++) g.addGroup(f * 3, 3, f);
  g.addGroup(60, pos.length / 3 - 60, 20);
  return { geometry: g, faces };
}
