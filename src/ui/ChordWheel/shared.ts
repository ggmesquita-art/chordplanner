import { getQuality, type Chord, type QualityId } from "../../core/chords";
import { chordIntervals } from "../../core/modifiers";
import { mod12, type PitchClass } from "../../core/pitch";

/** Classes de pitch que o acorde em hover compartilha com o acorde anterior. */
export function sharedPitchClasses(hover: { root: PitchClass; quality: QualityId } | null, previous: Chord | null): Set<number> {
  if (!hover || !previous) return new Set();
  const prev = new Set(chordIntervals(previous).map((i) => mod12(previous.root + i)));
  return new Set(getQuality(hover.quality).intervals.map((i) => mod12(hover.root + i)).filter((pc) => prev.has(pc)));
}
