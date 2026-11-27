// What the dice table asks of the sound: named cues, a clack for each landing (its loudness) and a buzz on phones.
// The fight synthesizes them with Web Audio, like the rest of its sounds, so no files ship with the module.

export type SoundName = 'beat' | 'cross' | 'tick' | 'whoosh';

export interface DiceSounds {
  play(name: SoundName, volume?: number): void;
  clack(volume: number): void;
  buzz(pattern: number | number[]): void;
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not on this device */
  }
}

/** Synthesized dice sounds on the host's audio context (null while there is none, or when muted). */
export function synthSounds(
  ctx: () => AudioContext | null,
  haptic: (pattern: number | number[]) => void = vibrate,
): DiceSounds {
  function noise(ac: AudioContext, dur: number) {
    const n = Math.floor(ac.sampleRate * dur),
      buf = ac.createBuffer(1, n, ac.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    const src = ac.createBufferSource();
    src.buffer = buf;
    return src;
  }
  function out(ac: AudioContext, v: number, dur: number) {
    const g = ac.createGain();
    g.gain.setValueAtTime(v, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    g.connect(ac.destination);
    return g;
  }
  function tone(f: number, dur: number, v: number, type: OscillatorType = 'sine', slide = 1) {
    const ac = ctx();
    if (!ac) return;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * slide, ac.currentTime + dur);
    o.connect(out(ac, v, dur));
    o.start();
    o.stop(ac.currentTime + dur);
  }
  return {
    play(name, volume = 1) {
      const ac = ctx();
      if (!ac) return;
      if (name === 'whoosh') {
        const src = noise(ac, 0.35),
          f = ac.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(600, ac.currentTime);
        f.frequency.exponentialRampToValueAtTime(2400, ac.currentTime + 0.3);
        src.connect(f);
        f.connect(out(ac, 0.25 * volume, 0.35));
        src.start();
      } else if (name === 'tick') tone(1800, 0.04, 0.05 * volume, 'square');
      else if (name === 'beat') {
        tone(70, 0.18, 0.4 * volume, 'sine', 0.6);
        setTimeout(() => tone(60, 0.2, 0.3 * volume, 'sine', 0.6), 140);
      } else tone(880, 0.3, 0.1 * volume, 'triangle', 1.5);
    },
    clack(volume) {
      const ac = ctx();
      if (!ac) return;
      const src = noise(ac, 0.06),
        f = ac.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1400 + Math.random() * 900;
      src.connect(f);
      f.connect(out(ac, 0.5 * volume, 0.06));
      src.start();
      tone(320 + Math.random() * 120, 0.05, 0.12 * volume, 'triangle', 0.7);
    },
    buzz(pattern) {
      haptic(pattern);
    },
  };
}
