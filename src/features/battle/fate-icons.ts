import type { FateId } from '../engine';

/*
  The icon of each gold d20 fate, engraved on the die's faces in place of numbers (Ayalon 2026-11-25) and shown on
  the fate banner. SVG paths in a 100x100 box, filled even-odd so inner shapes cut holes.
*/
export const FATE_ICON: Record<FateId, string> = {
  // crossed swords
  bladeStorm:
    'M8 8L22 11L74 63L63 74L11 22Z M58 82L82 58L88 64L64 88Z M76 82L82 76L95 89L89 95Z' +
    'M92 8L89 22L64 47L53 36L78 11Z M47 64L36 53L26 63L37 74Z M42 82L18 58L12 64L36 88Z M24 82L18 76L5 89L11 95Z',
  // a burst of power
  heroSurge: 'M50.0 2.0 L57.7 31.5 L83.9 16.1 L68.5 42.3 L98.0 50.0 L68.5 57.7 L83.9 83.9 L57.7 68.5 L50.0 98.0 L42.3 68.5 L16.1 83.9 L31.5 57.7 L2.0 50.0 L31.5 42.3 L16.1 16.1 L42.3 31.5Z M38 50a12 12 0 1 0 24 0a12 12 0 1 0-24 0Z',
  // a storm cloud and its bolt
  tempest: 'M24 54C10 54 6 34 20 30C20 16 38 10 46 20C52 8 74 10 76 26C92 26 96 50 80 54Z M50 58L36 80H48L42 98L64 72H52L58 58Z',
};

/** A fate's icon as an inline SVG. */
export const fateIconSvg = (id: FateId, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${FATE_ICON[id]}"/></svg>`;
