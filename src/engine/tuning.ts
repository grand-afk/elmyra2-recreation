// Chromatic mode (CHRM): scales and equal divisions of the octave, all referenced to
// A0 = 27.5 Hz, as the manual specifies. Pure functions shared by the core and the UI.

export const A0 = 27.5;

/** EDO values in code order: 1111 (12, default), 111 (7), 112 (9), 113 (15), 114 (17). */
export const EDOS = [12, 7, 9, 15, 17] as const;

/** Scale index 0 = all steps of the active EDO; 1..4 = codes 11..14 (12-EDO only). */
export const SCALES = [
  { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
] as const;

/** Normal (unquantised) TUNE range: seven octaves from A0. */
export const TUNE_OCTAVES = 7;
/**
 * In CHRM the knob's travel per step stays constant (manual: "the range of the TUNE knobs is
 * scaled accordingly"). We give the knob 84 steps, i.e. 7 octaves of 12-EDO.
 */
export const CHRM_STEPS = 84;

export interface Tuning {
  edo: number;
  scale: number; // index into SCALES; only applies when edo === 12
}

/** Pitch classes (in EDO steps) available in the current tuning. */
export function stepsOf(t: Tuning): readonly number[] {
  if (t.edo === 12) return SCALES[t.scale]?.steps ?? SCALES[0].steps;
  return Array.from({ length: t.edo }, (_, i) => i);
}

/** Octaves above A0 for the n-th playable note (n >= 0) of a tuning. */
export function noteToOctaves(n: number, t: Tuning): number {
  const steps = stepsOf(t);
  const oct = Math.floor(n / steps.length);
  const idx = ((n % steps.length) + steps.length) % steps.length;
  return oct + steps[idx] / t.edo;
}

/** CHRM: quantise a TUNE knob position (0..1) to octaves above A0. */
export function quantiseTune(tune: number, t: Tuning): number {
  if (t.edo === 12 && t.scale > 0) {
    // Scales keep the chromatic range and snap to the nearest scale note.
    const semis = Math.round(tune * CHRM_STEPS);
    const steps = stepsOf(t);
    let best = 0;
    let bestD = Infinity;
    for (let o = Math.floor(semis / 12) - 1; o <= Math.floor(semis / 12) + 1; o++)
      for (const s of steps) {
        const c = o * 12 + s;
        const d = Math.abs(c - semis);
        if (d < bestD && c >= 0) {
          bestD = d;
          best = c;
        }
      }
    return best / 12;
  }
  return Math.round(tune * CHRM_STEPS) / t.edo;
}

const NAMES_12 = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];

/** Name a pitch (octaves above A0) in a tuning: nearest step, its name and the cents error. */
export function describePitch(octaves: number, edo: number) {
  const steps = octaves * edo;
  const nearest = Math.round(steps);
  const cents = ((steps - nearest) * 1200) / edo;
  const oct = Math.floor(nearest / edo);
  const pc = ((nearest % edo) + edo) % edo;
  // Scientific octave numbers change at C, so count from C for 12-EDO names.
  const name = edo === 12 ? `${NAMES_12[pc]}${Math.floor((nearest + 9) / 12)}` : `${pc}\\${edo} · oct ${oct}`;
  return { name, cents, step: nearest };
}

export const hzToOctaves = (hz: number) => Math.log2(hz / A0);
export const octavesToHz = (o: number) => A0 * Math.pow(2, o);
