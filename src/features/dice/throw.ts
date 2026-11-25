/*
  The throw. The player holds the die in the thumb zone and flicks it: the flick's speed and direction
  set the whole path. The die flies from the hand, lands, and rolls on by tipping over one edge at a
  time (position locked to rotation, so it never slides), bouncing off the edges of the screen until
  the throw is spent. It rests wherever it ends. Each tip is fast as it falls onto a face and slow as
  it climbs over the next edge; on a close call the last climb hangs before it drops.
  Numbers approved in the dice throw mockup (2026-11-10).
*/
export const STEP = Math.PI - Math.acos(-Math.sqrt(5) / 3); // angle between neighbouring faces of a d20
export const SPREAD = 0.6; // table distance travelled per radian of rolling
/** Inradius of the unit die, so the resting face sits on the table. */
export const REST_Y = 0.7947;

/** Fast falling onto a face, slow climbing over the next edge. k grows each tip (energy loss). */
export const tipEase = (k: number) => (x: number) => x + (k * Math.sin(2 * Math.PI * x)) / (2 * Math.PI);

export const THROW = {
  /** Duration of the first tip (s); each following tip is ×1.3 longer. */
  first: 0.2,
  tipGrow: 1.3,
  /** Shrinking hops after the first impact. */
  hops: [0.5, 0.18, 0.06],
  /** The long last tip on a close call or a critical (s, random in this range). */
  hang: [0.9, 1.25] as const,
  /** Tips across the table: 2 for a soft throw, up to 5 for the hardest. */
  tipsMin: 2,
  tipsPower: 3,
  /** A release slower than this (px/s) is a drop or a tap, not a flick. */
  flickSpeed: 140,
  /** Table distance per unit of flick speed, and its limits. */
  distPerSpeed: 0.4,
  distMin: 1,
  distMax: 17,
  /** The distance that counts as full power. */
  fullPower: 9,
  /** Share of the remaining distance kept after each bounce off an edge. */
  bounceKeep: 0.7,
  /** Most bounces in one throw. */
  bounces: 6,
  /** How far the camera creeps toward a teetering die (share of the way). */
  creep: 0.2,
};

/** Where things sit on the stage, as shares of its width (W) and height (H). */
export const LAYOUT = {
  /** The centre of the table on screen: where a tap tosses the die. */
  restY: (h: number) => Math.max(0.385 * h, 262),
  /** Where the die waits in the hand. */
  homeY: (h: number) => Math.min(0.72 * h, h - 190),
  /** Height the die is held above the table. */
  holdY: 1.05,
  /** A touch closer than this to the die (px) picks it up. */
  grab: 115,
  /** A finger hides what is under it, so a touch holds the die this far above itself (px). */
  touchLift: 44,
  /** How far apart two dice rest and are held. */
  pairRest: 1.12,
  pairHold: 0.78,
};
