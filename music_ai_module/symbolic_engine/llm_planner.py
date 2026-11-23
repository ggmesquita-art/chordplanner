"""
LLMPlanner: Neuro-symbolic harmonic, voice-leading, and structural planner.

Uses OpenAI (when OPENAI_API_KEY is configured and reachable) enriched with
`SkillLoader` context, and provides a complete deterministic symbolic planner
grounded in the `music-composition` skill for 100% offline operation.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Dict, List, Optional, Sequence, Tuple

from music_ai_module.config import settings
from music_ai_module.schemas import (
    CamelotKey,
    GenerationRequest,
    NoteEvent,
    TheoreticalPlan,
    TrackInput,
    TrackRole,
    camelot_to_tonic_scale,
    tonic_scale_to_camelot,
)
from music_ai_module.symbolic_engine.skill_loader import SkillLoader

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Music Theory Primitives
# ---------------------------------------------------------------------------

PC_NAMES_SHARP: List[str] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PC_NAMES_FLAT: List[str] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Keys that conventionally spell accidentals with flats
FLAT_TONIC_PCS_MAJOR = {1, 3, 5, 6, 8, 10}  # Db, Eb, F, Gb, Ab, Bb
FLAT_TONIC_PCS_MINOR = {0, 1, 2, 3, 5, 7, 8, 10}  # Cm, Dbm, Dm, Ebm, Fm, Gm, Abm, Bbm

SCALE_INTERVALS: Dict[str, List[int]] = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "ionian": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "natural_minor": [0, 2, 3, 5, 7, 8, 10],
    "aeolian": [0, 2, 3, 5, 7, 8, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
    "melodic_minor": [0, 2, 3, 5, 7, 9, 11],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "locrian": [0, 1, 3, 5, 6, 8, 10],
    "major_pentatonic": [0, 2, 4, 7, 9],
    "minor_pentatonic": [0, 3, 5, 7, 10],
    "blues": [0, 3, 5, 6, 7, 10],
    "phrygian_dominant": [0, 1, 4, 5, 7, 8, 10],
    "lydian_dominant": [0, 2, 4, 6, 7, 9, 10],
}

NOTE_NAME_TO_PC: Dict[str, int] = {
    "C": 0, "B#": 0,
    "C#": 1, "DB": 1,
    "D": 2,
    "D#": 3, "EB": 3,
    "E": 4, "FB": 4,
    "F": 5, "E#": 5,
    "F#": 6, "GB": 6,
    "G": 7,
    "G#": 8, "AB": 8,
    "A": 9,
    "A#": 10, "BB": 10,
    "B": 11, "CB": 11,
}

ROMAN_DEGREE_MAP: Dict[str, int] = {
    "I": 0,
    "II": 1,
    "III": 2,
    "IV": 3,
    "V": 4,
    "VI": 5,
    "VII": 6,
}

_ROMAN_RE = re.compile(r"^([b♭#♯]?)(VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)(.*)$")
_CHORD_RE = re.compile(r"^([A-Ga-g])([#♯b♭]?)(.*?)(?:/([A-Ga-g][#♯b♭]?))?$")


def pc_to_name(pc: int, use_flats: bool = False) -> str:
    idx = pc % 12
    return PC_NAMES_FLAT[idx] if use_flats else PC_NAMES_SHARP[idx]


def is_minor_scale(scale_id: str) -> bool:
    sid = scale_id.strip().lower()
    return any(
        tok in sid
        for tok in ("minor", "aeolian", "dorian", "phrygian", "locrian", "blues")
    ) and "major" not in sid


def get_scale_intervals(scale_id: str) -> List[int]:
    sid = scale_id.strip().lower().replace("-", "_").replace(" ", "_")
    if sid in SCALE_INTERVALS:
        return SCALE_INTERVALS[sid]
    if "min" in sid:
        return SCALE_INTERVALS["minor"]
    return SCALE_INTERVALS["major"]


def resolve_key_context(
    request: GenerationRequest,
) -> Tuple[CamelotKey, int, str, str, List[int]]:
    """
    Resolve (camelot_key, tonic_pc, tonic_name, scale_id, scale_pitches)
    respecting explicit `tonic_pc` / `scale_id` overrides and CamelotKey defaults.
    """
    ck_pc, ck_name, ck_scale = camelot_to_tonic_scale(request.camelot_key)
    fields_set = getattr(request, "model_fields_set", set())

    if "scale_id" in fields_set or request.scale_id != "minor":
        scale_id = request.scale_id.strip().lower()
    else:
        scale_id = ck_scale

    if request.tonic_pc is not None:
        tonic_pc = request.tonic_pc % 12
        use_flats = (
            tonic_pc in FLAT_TONIC_PCS_MINOR
            if is_minor_scale(scale_id)
            else tonic_pc in FLAT_TONIC_PCS_MAJOR
        )
        tonic_name = ck_name if tonic_pc == ck_pc else pc_to_name(tonic_pc, use_flats=use_flats)
    else:
        tonic_pc = ck_pc
        tonic_name = ck_name

    camelot_key = request.camelot_key
    if "camelot_key" not in fields_set and (
        request.tonic_pc is not None or "scale_id" in fields_set
    ):
        try:
            camelot_key = tonic_scale_to_camelot(tonic_pc, scale_id)
        except ValueError:
            camelot_key = request.camelot_key

    intervals = get_scale_intervals(scale_id)
    scale_pitches = [(tonic_pc + iv) % 12 for iv in intervals]
    return camelot_key, tonic_pc, tonic_name, scale_id, scale_pitches


def roman_to_chord_symbol(
    roman: str,
    tonic_pc: int,
    is_minor: bool = False,
    use_flats: bool = False,
) -> str:
    """
    Convert a Roman numeral token (e.g. 'I', 'ii7', 'bVI', 'iiø7', 'V7b9')
    into a concrete chord symbol in the given key.
    """
    token = roman.strip()
    m = _ROMAN_RE.match(token)
    if not m:
        return token

    acc_str, numeral, suffix = m.group(1), m.group(2), m.group(3)
    degree_idx = ROMAN_DEGREE_MAP[numeral.upper()]

    acc_offset = 0
    if acc_str in ("b", "♭"):
        acc_offset = -1
    elif acc_str in ("#", "♯"):
        acc_offset = 1

    # Major reference degrees; in minor without explicit accidental, III/VI/VII map to natural minor b3/b6/b7
    if is_minor and acc_offset == 0 and numeral.upper() in ("III", "VI", "VII"):
        base_offsets = SCALE_INTERVALS["minor"]
    else:
        base_offsets = SCALE_INTERVALS["major"]

    root_pc = (tonic_pc + base_offsets[degree_idx] + acc_offset) % 12
    root_name = pc_to_name(root_pc, use_flats=use_flats or (acc_str in ("b", "♭")))

    is_lower = numeral.islower()
    clean_suffix = suffix.replace("♭", "b").replace("♯", "#")

    if clean_suffix.startswith("ø"):
        quality = "m7b5" + clean_suffix[1:].lstrip("7")
        if clean_suffix == "ø":
            quality = "m7b5"
        elif clean_suffix == "ø7":
            quality = "m7b5"
    elif clean_suffix.startswith("°") or clean_suffix.startswith("dim"):
        rest = clean_suffix[1:] if clean_suffix.startswith("°") else clean_suffix[3:]
        quality = "dim" + rest
    elif clean_suffix.startswith("+") or clean_suffix.startswith("aug"):
        rest = clean_suffix[1:] if clean_suffix.startswith("+") else clean_suffix[3:]
        quality = "aug" + rest
    elif clean_suffix.startswith("maj"):
        quality = ("m" if is_lower else "") + clean_suffix
    elif clean_suffix.startswith("m"):
        quality = clean_suffix
    elif clean_suffix.startswith("sus"):
        quality = clean_suffix
    else:
        quality = ("m" if is_lower else "") + clean_suffix

    return f"{root_name}{quality}"


def parse_chord_symbol(symbol: str) -> Tuple[int, List[int], int]:
    """
    Parse a chord symbol into (root_pc, intervals_from_root, bass_pc).
    """
    cleaned = symbol.strip().replace("♯", "#").replace("♭", "b")
    m = _CHORD_RE.match(cleaned)
    if not m:
        return 0, [0, 4, 7], 0

    letter, acc, qual, slash_bass = m.group(1), m.group(2), m.group(3), m.group(4)
    root_key = f"{letter.upper()}{acc.upper() if acc == 'b' else acc}"
    root_pc = NOTE_NAME_TO_PC.get(root_key, NOTE_NAME_TO_PC.get(letter.upper(), 0))

    bass_pc = root_pc
    if slash_bass:
        b_key = f"{slash_bass[0].upper()}{slash_bass[1:].upper() if slash_bass[1:] == 'b' else slash_bass[1:]}"
        bass_pc = NOTE_NAME_TO_PC.get(b_key, root_pc)

    q = qual.strip()
    ql = q.lower()

    if ql in ("", "maj"):
        intervals = [0, 4, 7]
    elif ql in ("m", "min", "-"):
        intervals = [0, 3, 7]
    elif ql in ("dim", "°", "o"):
        intervals = [0, 3, 6]
    elif ql in ("aug", "+"):
        intervals = [0, 4, 8]
    elif ql == "5":
        intervals = [0, 7]
    elif ql in ("sus4", "sus"):
        intervals = [0, 5, 7]
    elif ql == "sus2":
        intervals = [0, 2, 7]
    elif ql in ("m7b5", "ø", "ø7", "min7b5"):
        intervals = [0, 3, 6, 10]
    elif ql in ("dim7", "°7", "o7"):
        intervals = [0, 3, 6, 9]
    elif ql in ("m(maj7)", "mmaj7", "minmaj7"):
        intervals = [0, 3, 7, 11]
    elif "maj9" in ql or "Δ9" in q:
        intervals = [0, 4, 7, 11, 14]
    elif "maj7" in ql or q.startswith("M7") or "Δ7" in q or "Δ" in q:
        intervals = [0, 4, 7, 11]
    elif ql.startswith("m9") or ql.startswith("min9"):
        intervals = [0, 3, 7, 10, 14]
    elif ql.startswith("m7") or ql.startswith("min7") or ql.startswith("-7"):
        intervals = [0, 3, 7, 10]
    elif ql.startswith("m6") or ql.startswith("min6"):
        intervals = [0, 3, 7, 9]
    elif ql.startswith("madd9"):
        intervals = [0, 3, 7, 14]
    elif ql == "6":
        intervals = [0, 4, 7, 9]
    elif ql in ("add9", "add2"):
        intervals = [0, 4, 7, 14]
    elif ql == "7b9":
        intervals = [0, 4, 7, 10, 13]
    elif ql == "7#9":
        intervals = [0, 4, 7, 10, 15]
    elif ql == "7alt":
        intervals = [0, 4, 10, 13, 20]
    elif ql in ("7sus4", "7sus"):
        intervals = [0, 5, 7, 10]
    elif ql.startswith("9"):
        intervals = [0, 4, 7, 10, 14]
    elif ql.startswith("13"):
        intervals = [0, 4, 7, 10, 14, 21]
    elif ql.startswith("11"):
        intervals = [0, 4, 7, 10, 14, 17]
    elif "7" in ql:
        if ql.startswith("m"):
            intervals = [0, 3, 7, 10]
        else:
            intervals = [0, 4, 7, 10]
    elif ql.startswith("m"):
        intervals = [0, 3, 7]
    else:
        intervals = [0, 4, 7]

    return root_pc, intervals, bass_pc


def _build_close_stack(pcs: List[int], start_pitch: int) -> List[int]:
    """Build an ascending close-position stack of pitch classes starting >= start_pitch."""
    out: List[int] = []
    cur = start_pitch
    for idx, pc in enumerate(pcs):
        if idx == 0:
            diff = (pc - (cur % 12)) % 12
            p = cur + diff
        else:
            prev = out[-1]
            diff = (pc - (prev % 12)) % 12
            if diff == 0:
                diff = 12
            p = prev + diff
        out.append(p)
    return out


def voice_chord(
    symbol: str,
    style: str = "close",
    prev_voicing: Optional[List[int]] = None,
    low: int = 48,
    high: int = 76,
) -> List[int]:
    """
    Generate a MIDI voicing for `symbol` using 'drop2', 'shell', or 'close'
    voice leading, minimizing voice movement relative to `prev_voicing`.
    """
    root_pc, intervals, _ = parse_chord_symbol(symbol)
    pcs: List[int] = []
    for iv in intervals:
        pc = (root_pc + iv) % 12
        if pc not in pcs:
            pcs.append(pc)

    style_norm = style.strip().lower()
    candidates: List[List[int]] = []

    if style_norm == "shell":
        # Root + 3rd (idx 1) + 7th/5th (last or idx 2)
        if len(pcs) >= 4:
            shell_pcs = [pcs[0], pcs[1], pcs[3]]
            guide_pcs = [pcs[1], pcs[3]]
        elif len(pcs) == 3:
            shell_pcs = [pcs[0], pcs[1], pcs[2]]
            guide_pcs = [pcs[1], pcs[2]]
        else:
            shell_pcs = pcs
            guide_pcs = pcs

        for root_base in (48, 55):
            r_diff = (shell_pcs[0] - (root_base % 12)) % 12
            r_note = root_base + r_diff
            if r_note > 59:
                r_note -= 12
            # Two inversions of the upper guide tones (3-7 and 7-3)
            for rot in range(len(guide_pcs)):
                rotated = guide_pcs[rot:] + guide_pcs[:rot]
                for guide_start in (55, 60):
                    stack = _build_close_stack(rotated, max(r_note + 3, guide_start))
                    voicing = sorted({r_note, *stack})
                    if voicing[0] >= 40 and voicing[-1] <= 79:
                        candidates.append(voicing)
    elif style_norm == "drop2":
        # Drop-2 uses 4 voices; double root on triads
        four_pcs = list(pcs[:4])
        while len(four_pcs) < 4:
            four_pcs.append(pcs[0])
        for rot in range(4):
            inv = four_pcs[rot:] + four_pcs[:rot]
            for base_start in (52, 57, 62):
                close = _build_close_stack(inv, base_start)
                if len(close) == 4:
                    # Drop the 2nd-highest voice down one octave
                    dropped = [close[0], close[1], close[2] - 12, close[3]]
                    voicing = sorted(dropped)
                    if voicing[0] >= low - 4 and voicing[-1] <= high + 3:
                        candidates.append(voicing)
    else:
        # Close voicing
        use_pcs = pcs[:4]
        for rot in range(len(use_pcs)):
            inv = use_pcs[rot:] + use_pcs[:rot]
            for base_start in (48, 53, 58, 63):
                voicing = _build_close_stack(inv, base_start)
                if voicing[0] >= low and voicing[-1] <= high:
                    candidates.append(voicing)

    if not candidates:
        # Safe fallback close stack around C4 (60)
        fallback = _build_close_stack(pcs[:4], 55)
        return [max(36, min(96, p)) for p in fallback]

    if not prev_voicing:
        # Pick candidate closest to comfortable middle register (centroid ~60)
        best = min(candidates, key=lambda c: abs(sum(c) / len(c) - 60.0))
        return best

    def _cost(cand: List[int]) -> float:
        if len(cand) == len(prev_voicing):
            leap = sum(abs(a - b) for a, b in zip(cand, prev_voicing)) / len(cand)
        else:
            leap = sum(min(abs(a - b) for b in prev_voicing) for a in cand) / len(cand)
        register_pull = 0.05 * abs((sum(cand) / len(cand)) - 60.0)
        return leap + register_pull

    return min(candidates, key=_cost)


def _diatonic_chords_for_key(
    tonic_pc: int,
    scale_id: str,
    scale_pitches: List[int],
    genre: str,
    use_flats: bool,
) -> List[Tuple[str, int, List[int]]]:
    """
    Build candidate (symbol, func_group, chord_pcs) tuples for melody harmonization.
    func_group: 0=Tonic, 1=Predominant, 2=Dominant
    """
    is_minor = is_minor_scale(scale_id)
    use_sevenths = genre.strip().lower() in ("jazz", "hip-hop", "hiphop", "r&b", "rnb", "neo-soul", "blues")
    rn_minor = ["i", "ii°", "bIII", "iv", "v", "bVI", "bVII"]
    rn_minor_7 = ["im7", "iiø7", "bIIImaj7", "iv7", "v7", "bVImaj7", "bVII7"]
    rn_major = ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
    rn_major_7 = ["Imaj7", "ii7", "iii7", "IVmaj7", "V7", "vi7", "iiø7"]

    if is_minor:
        rns = rn_minor_7 if use_sevenths else rn_minor
        func_map = [0, 1, 0, 1, 2, 1, 2]
    else:
        rns = rn_major_7 if use_sevenths else rn_major
        func_map = [0, 1, 0, 1, 2, 0, 2]

    candidates: List[Tuple[str, int, List[int]]] = []
    for idx, rn in enumerate(rns):
        sym = roman_to_chord_symbol(rn, tonic_pc, is_minor=is_minor, use_flats=use_flats)
        r_pc, ivs, _ = parse_chord_symbol(sym)
        pcs = [(r_pc + iv) % 12 for iv in ivs]
        candidates.append((sym, func_map[idx], pcs))

    # In minor keys, always also allow raised-leading-tone V / V7 for strong cadences
    if is_minor:
        dom_rn = "V7" if use_sevenths else "V"
        dom_sym = roman_to_chord_symbol(dom_rn, tonic_pc, is_minor=True, use_flats=use_flats)
        r_pc, ivs, _ = parse_chord_symbol(dom_sym)
        candidates.append((dom_sym, 2, [(r_pc + iv) % 12 for iv in ivs]))

    return candidates


def harmonize_melody(
    notes: List[NoteEvent],
    total_bars: int,
    bar_ticks: int,
    tonic_pc: int,
    scale_id: str,
    scale_pitches: List[int],
    genre: str,
    use_flats: bool,
) -> List[str]:
    """
    Harmonize a melody track per bar by analyzing strong-beat note weights and
    chaining functional harmony (T -> PD -> D -> T).
    """
    candidates = _diatonic_chords_for_key(tonic_pc, scale_id, scale_pitches, genre, use_flats)
    n_cands = len(candidates)

    # Score each bar's melody fit per candidate chord
    bar_fit: List[List[float]] = []
    beat_ticks = max(1, bar_ticks // 4)
    for b in range(total_bars):
        b_start = b * bar_ticks
        b_end = b_start + bar_ticks
        pc_weights: Dict[int, float] = {}
        for n in notes:
            if b_start <= n.start_tick < b_end:
                rel_tick = n.start_tick - b_start
                beat_pos = rel_tick / beat_ticks
                # Strong beats (beat 0 and beat 2 in 0-indexed 4/4) get higher harmonic weight
                metric_weight = 1.6 if abs(beat_pos - round(beat_pos)) < 0.15 and int(round(beat_pos)) in (0, 2) else 1.0
                dur_weight = max(0.25, (n.end_tick - n.start_tick) / beat_ticks)
                pc = n.pitch % 12
                pc_weights[pc] = pc_weights.get(pc, 0.0) + metric_weight * dur_weight

        scores: List[float] = []
        for idx, (sym, func, pcs) in enumerate(candidates):
            score = 0.0
            if not pc_weights:
                score = 1.0 if idx == 0 else 0.0
            else:
                for pc, w in pc_weights.items():
                    if pc == pcs[0]:
                        score += 3.2 * w
                    elif pc in pcs:
                        score += 2.4 * w
                    elif any((pc - cp) % 12 == 1 for cp in pcs[:2]):
                        score -= 1.2 * w
            # Encourage tonic at bar 0 and authentic arrival on last bar
            if b == 0 and idx == 0:
                score += 2.5
            if b == total_bars - 1 and idx == 0:
                score += 2.0
            scores.append(score)
        bar_fit.append(scores)

    # Functional transition matrix bonus: T(0)->PD(1)->D(2)->T(0)
    func_trans = {
        (0, 1): 1.5,
        (0, 2): 1.0,
        (0, 0): 0.3,
        (1, 2): 2.0,
        (1, 0): 0.8,
        (1, 1): 0.2,
        (2, 0): 2.4,
        (2, 1): -0.5,  # Retrograde D->PD discouraged
        (2, 2): 0.1,
    }

    dp: List[List[float]] = [list(bar_fit[0])]
    back: List[List[int]] = [[-1] * n_cands]

    for b in range(1, total_bars):
        cur_row = [-1e9] * n_cands
        cur_back = [0] * n_cands
        for j in range(n_cands):
            sym_j, func_j, pcs_j = candidates[j]
            for i in range(n_cands):
                sym_i, func_i, pcs_i = candidates[i]
                trans = func_trans.get((func_i, func_j), 0.0)
                if i == j:
                    trans -= 0.8  # Mild preference for harmonic movement between bars
                # Descending fifth root motion bonus
                if (pcs_i[0] - pcs_j[0]) % 12 == 7:
                    trans += 1.0
                val = dp[b - 1][i] + trans + bar_fit[b][j]
                if val > cur_row[j]:
                    cur_row[j] = val
                    cur_back[j] = i
        dp.append(cur_row)
        back.append(cur_back)

    best_last = max(range(n_cands), key=lambda j: dp[-1][j])
    chosen_indices = [0] * total_bars
    chosen_indices[-1] = best_last
    for b in range(total_bars - 1, 0, -1):
        chosen_indices[b - 1] = back[b][chosen_indices[b]]

    return [candidates[idx][0] for idx in chosen_indices]


def build_bass_notes_for_bar(
    symbol: str,
    next_symbol: Optional[str],
    bar_ticks: int,
    groove_style: str,
    velocity: int = 84,
) -> List[dict]:
    """
    Create functional bass line notes (root, fifth/octave, and approach note)
    with bar-relative onset_ticks.
    """
    root_pc, _, bass_pc = parse_chord_symbol(symbol)
    target_pc = bass_pc
    # Place bass root in MIDI range 36..47 (C2..B2) or up to 50
    root_midi = 36 + (target_pc % 12)
    if root_midi < 36:
        root_midi += 12
    fifth_midi = root_midi + 7
    if fifth_midi > 55:
        fifth_midi -= 12

    beat = max(1, bar_ticks // 4)
    notes: List[dict] = []

    if next_symbol is not None and bar_ticks >= beat * 4:
        next_root_pc, _, next_bass_pc = parse_chord_symbol(next_symbol)
        next_midi = 36 + (next_bass_pc % 12)
        # Diatonic/chromatic leading approach a half or whole step away
        approach_midi = next_midi - 1 if abs((next_midi - 1) - root_midi) <= 7 else next_midi + 2
        approach_midi = max(33, min(55, approach_midi))

        notes.append({
            "pitch": root_midi,
            "velocity": velocity,
            "onset_ticks": 0,
            "duration_ticks": max(1, beat * 2 - 20),
            "delta": 0,
        })
        notes.append({
            "pitch": fifth_midi,
            "velocity": max(50, velocity - 8),
            "onset_ticks": beat * 2,
            "duration_ticks": max(1, beat - 20),
            "delta": 0,
        })
        notes.append({
            "pitch": approach_midi,
            "velocity": max(50, velocity - 10),
            "onset_ticks": beat * 3,
            "duration_ticks": max(1, bar_ticks - beat * 3 - 20),
            "delta": 0,
        })
    elif bar_ticks >= beat * 2:
        half = bar_ticks // 2
        notes.append({
            "pitch": root_midi,
            "velocity": velocity,
            "onset_ticks": 0,
            "duration_ticks": max(1, half - 20),
            "delta": 0,
        })
        notes.append({
            "pitch": fifth_midi,
            "velocity": max(50, velocity - 8),
            "onset_ticks": half,
            "duration_ticks": max(1, bar_ticks - half - 20),
            "delta": 0,
        })
    else:
        notes.append({
            "pitch": root_midi,
            "velocity": velocity,
            "onset_ticks": 0,
            "duration_ticks": max(1, bar_ticks - 20),
            "delta": 0,
        })

    return notes


# ---------------------------------------------------------------------------
# LLMPlanner
# ---------------------------------------------------------------------------


class LLMPlanner:
    """
    Plans harmony, voice leading, form, and generates deterministic MIDI primer code.
    Supports optional async OpenAI enrichment with offline symbolic fallback.
    """

    def __init__(
        self,
        skill_loader: Optional[SkillLoader] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        self.skill_loader: SkillLoader = skill_loader or SkillLoader()
        self.api_key: Optional[str] = api_key if api_key is not None else settings.OPENAI_API_KEY
        self.model: str = model or settings.LLM_MODEL
        self.base_url: Optional[str] = base_url if base_url is not None else settings.OPENAI_BASE_URL

    @staticmethod
    def select_voice_leading_style(genre: str) -> str:
        g = genre.strip().lower()
        if any(k in g for k in ("jazz", "latin", "r&b", "rnb", "neo-soul", "bossa", "gospel")):
            return "drop2"
        if any(k in g for k in ("blues", "hip-hop", "hiphop", "hip_hop", "trap", "soul")):
            return "shell"
        return "close"

    @staticmethod
    def select_groove_style(genre: str) -> str:
        g = genre.strip().lower()
        if any(k in g for k in ("jazz", "blues", "swing", "bebop")):
            return "swing"
        if any(k in g for k in ("latin", "hip-hop", "hiphop", "hip_hop", "r&b", "rnb", "funk", "brazilian")):
            return "syncopated"
        if any(k in g for k in ("rock", "dance", "electronic", "edm", "house", "techno", "metal")):
            return "driving"
        return "straight"

    @staticmethod
    def compute_target_roles_order(request: GenerationRequest) -> List[TrackRole]:
        return [
            r
            for r in (
                TrackRole.CHORDS,
                TrackRole.BASS,
                TrackRole.DRUMS,
                TrackRole.PAD,
                TrackRole.MELODY,
            )
            if r in request.target_tracks or (r == TrackRole.MELODY and request.generate_melody)
        ]

    def _plan_progressions(
        self,
        request: GenerationRequest,
        total_bars: int,
        bar_ticks: int,
        tonic_pc: int,
        scale_id: str,
        scale_pitches: List[int],
    ) -> Tuple[List[str], str]:
        """
        Determine bar-by-bar chord symbols from user inputs or skill progressions.
        Returns (chord_progression_per_bar, rationale_source).
        """
        is_minor = is_minor_scale(scale_id)
        use_flats = (
            tonic_pc in FLAT_TONIC_PCS_MINOR if is_minor else tonic_pc in FLAT_TONIC_PCS_MAJOR
        )

        # 1. User supplied chord_symbols on any input track
        user_symbols: List[str] = []
        for track in request.input_tracks:
            cleaned = [s.strip() for s in track.chord_symbols if s and s.strip()]
            if cleaned:
                user_symbols = cleaned
                break

        if user_symbols:
            expanded = [user_symbols[i % len(user_symbols)] for i in range(total_bars)]
            return expanded, "preserved and expanded user-supplied chord_symbols"

        # 2. User supplied melody notes without chord_symbols
        melody_notes: List[NoteEvent] = []
        for track in request.input_tracks:
            if track.role == TrackRole.MELODY and track.notes:
                melody_notes = track.notes
                break

        if melody_notes:
            harmonized = harmonize_melody(
                notes=melody_notes,
                total_bars=total_bars,
                bar_ticks=bar_ticks,
                tonic_pc=tonic_pc,
                scale_id=scale_id,
                scale_pitches=scale_pitches,
                genre=request.genre,
                use_flats=use_flats,
            )
            return harmonized, "melody-driven functional harmonization (T -> PD -> D -> T)"

        # 3. No chords and no melody: choose idiomatic genre progression from skill catalog
        templates = self.skill_loader.get_genre_progressions(request.genre, is_minor=is_minor)
        sections = request.form_structure or ["A"]
        lengths = request.section_lengths or [total_bars]

        # Ensure lengths and sections align
        if len(lengths) != len(sections):
            lengths = [max(1, total_bars // len(sections))] * len(sections)
            lengths[-1] += total_bars - sum(lengths)

        progression: List[str] = []
        section_template_idx: Dict[str, int] = {}
        next_idx = 0
        for sec_label, sec_len in zip(sections, lengths):
            if sec_label not in section_template_idx:
                section_template_idx[sec_label] = next_idx % len(templates)
                next_idx += 1
            rn_prog = templates[section_template_idx[sec_label]]
            concrete = [
                roman_to_chord_symbol(rn, tonic_pc, is_minor=is_minor, use_flats=use_flats)
                for rn in rn_prog
            ]
            for i in range(sec_len):
                progression.append(concrete[i % len(concrete)])

        if len(progression) < total_bars:
            base = progression or [pc_to_name(tonic_pc, use_flats) + ("m" if is_minor else "")]
            while len(progression) < total_bars:
                progression.append(base[len(progression) % len(base)])
        return progression[:total_bars], f"music-composition catalog progression for {request.genre}"

    def _build_primer_dict(
        self,
        request: GenerationRequest,
        total_bars: int,
        chord_progression: List[str],
        voice_leading_style: str,
        groove_style: str,
        target_roles_order: List[TrackRole],
    ) -> dict:
        """
        Construct the deterministic Score dictionary (compatible with midigpt.Score.from_dict)
        containing user input tracks, voice-led chords, and functional bass.
        """
        resolution = 480
        tempo = int(round(60_000_000 / request.bpm))
        ts_num = request.time_signature[0] if len(request.time_signature) >= 1 else 4
        ts_den = request.time_signature[1] if len(request.time_signature) >= 2 else 4
        beat_length = ts_num * (4.0 / ts_den)
        bar_ticks = int(round(resolution * beat_length))

        # Pre-compute voice-led chord voicings per bar
        voicings_per_bar: List[List[int]] = []
        prev_v: Optional[List[int]] = None
        for sym in chord_progression:
            v = voice_chord(sym, style=voice_leading_style, prev_voicing=prev_v)
            voicings_per_bar.append(v)
            prev_v = v

        tracks_dicts: List[dict] = []
        has_chords_input = False
        has_bass_input = False

        for ti in request.input_tracks:
            if ti.role == TrackRole.CHORDS:
                has_chords_input = True
            elif ti.role == TrackRole.BASS:
                has_bass_input = True

            bars: List[dict] = [
                {
                    "ts_numerator": ts_num,
                    "ts_denominator": ts_den,
                    "beat_length": beat_length,
                    "future": False,
                    "notes": [],
                }
                for _ in range(total_bars)
            ]

            for n in ti.notes:
                bar_idx = n.start_tick // bar_ticks
                if 0 <= bar_idx < total_bars:
                    onset_in_bar = n.start_tick % bar_ticks
                    duration = max(1, n.end_tick - n.start_tick)
                    bars[bar_idx]["notes"].append({
                        "pitch": int(n.pitch),
                        "velocity": int(n.velocity),
                        "onset_ticks": int(onset_in_bar),
                        "duration_ticks": int(duration),
                        "delta": 0,
                    })

            # If user supplied a chords track with partial bars (e.g. bar 0 only),
            # fill remaining empty bars with the planned voice-led voicings.
            if ti.role == TrackRole.CHORDS:
                last_voicing = None
                for b_idx in range(total_bars):
                    if bars[b_idx]["notes"]:
                        last_voicing = sorted({n["pitch"] for n in bars[b_idx]["notes"]})
                    else:
                        sym = chord_progression[b_idx]
                        v = voice_chord(sym, style=voice_leading_style, prev_voicing=last_voicing)
                        last_voicing = v
                        dur = max(1, int(round(bar_ticks * 0.9)))
                        for p in v:
                            bars[b_idx]["notes"].append({
                                "pitch": int(p),
                                "velocity": 78,
                                "onset_ticks": 0,
                                "duration_ticks": dur,
                                "delta": 0,
                            })

            for b in bars:
                b["notes"].sort(key=lambda item: (item["onset_ticks"], item["pitch"]))

            tracks_dicts.append({
                "instrument": int(ti.program),
                "track_type": "drum" if ti.role == TrackRole.DRUMS else "melodic",
                "bars": bars,
            })

        # Add primer chords track if no user chords track existed
        if not has_chords_input:
            chord_bars: List[dict] = []
            dur = max(1, int(round(bar_ticks * 0.9)))
            for b_idx in range(total_bars):
                notes = [
                    {
                        "pitch": int(p),
                        "velocity": 78,
                        "onset_ticks": 0,
                        "duration_ticks": dur,
                        "delta": 0,
                    }
                    for p in voicings_per_bar[b_idx]
                ]
                chord_bars.append({
                    "ts_numerator": ts_num,
                    "ts_denominator": ts_den,
                    "beat_length": beat_length,
                    "future": False,
                    "notes": notes,
                })
            tracks_dicts.append({
                "instrument": 0,
                "track_type": "melodic",
                "bars": chord_bars,
            })

        # Add functional bass primer track when bass is targeted and not already provided
        if not has_bass_input and (TrackRole.BASS in target_roles_order or not request.input_tracks):
            bass_instrument = 32 if "jazz" in request.genre.lower() else 33
            bass_bars: List[dict] = []
            for b_idx in range(total_bars):
                next_sym = chord_progression[b_idx + 1] if b_idx + 1 < total_bars else chord_progression[0]
                b_notes = build_bass_notes_for_bar(
                    symbol=chord_progression[b_idx],
                    next_symbol=next_sym,
                    bar_ticks=bar_ticks,
                    groove_style=groove_style,
                    velocity=84,
                )
                bass_bars.append({
                    "ts_numerator": ts_num,
                    "ts_denominator": ts_den,
                    "beat_length": beat_length,
                    "future": False,
                    "notes": b_notes,
                })
            tracks_dicts.append({
                "instrument": bass_instrument,
                "track_type": "melodic",
                "bars": bass_bars,
            })

        return {
            "resolution": resolution,
            "tempo": tempo,
            "tracks": tracks_dicts,
        }

    @staticmethod
    def _render_primer_python_code(score_dict: dict) -> str:
        """
        Render a clean, self-contained Python module defining `def build_primer() -> dict:`.
        """
        payload_literal = json.dumps(score_dict, indent=2)
        # Convert JSON booleans to valid Python booleans
        payload_literal = (
            payload_literal.replace(": false", ": False")
            .replace(": true", ": True")
            .replace(": null", ": None")
        )
        return (
            '"""Auto-generated deterministic MIDI-GPT primer builder."""\n\n\n'
            "def build_primer() -> dict:\n"
            f"    return {payload_literal}\n"
        )

    def _create_deterministic_plan(self, request: GenerationRequest) -> TheoreticalPlan:
        camelot_key, tonic_pc, tonic_name, scale_id, scale_pitches = resolve_key_context(request)
        total_bars = max(1, sum(request.section_lengths) if request.section_lengths else 4)

        ts_num = request.time_signature[0] if len(request.time_signature) >= 1 else 4
        ts_den = request.time_signature[1] if len(request.time_signature) >= 2 else 4
        bar_ticks = int(round(480 * ts_num * (4.0 / ts_den)))

        voice_leading_style = self.select_voice_leading_style(request.genre)
        groove_style = self.select_groove_style(request.genre)
        target_roles_order = self.compute_target_roles_order(request)

        chord_progression, rationale = self._plan_progressions(
            request=request,
            total_bars=total_bars,
            bar_ticks=bar_ticks,
            tonic_pc=tonic_pc,
            scale_id=scale_id,
            scale_pitches=scale_pitches,
        )

        score_dict = self._build_primer_dict(
            request=request,
            total_bars=total_bars,
            chord_progression=chord_progression,
            voice_leading_style=voice_leading_style,
            groove_style=groove_style,
            target_roles_order=target_roles_order,
        )
        primer_code = self._render_primer_python_code(score_dict)

        explanation = (
            f"Planned {total_bars} bars in {tonic_name} {scale_id} (Camelot {camelot_key.value}) "
            f"at {request.bpm} BPM ({ts_num}/{ts_den}) for genre '{request.genre}'. "
            f"Progression source: {rationale} -> [{', '.join(chord_progression)}]. "
            f"Voice leading: {voice_leading_style}; groove: {groove_style}."
        )

        return TheoreticalPlan(
            camelot_key=camelot_key,
            tonic_pc=tonic_pc,
            tonic_name=tonic_name,
            scale_id=scale_id,
            scale_pitches=scale_pitches,
            genre=request.genre,
            total_bars=total_bars,
            chord_progression_per_bar=chord_progression,
            voice_leading_style=voice_leading_style,
            groove_style=groove_style,
            target_roles_order=target_roles_order,
            primer_python_code=primer_code,
            theoretical_explanation=explanation,
        )

    async def _query_openai(
        self,
        request: GenerationRequest,
        deterministic_fallback: TheoreticalPlan,
    ) -> Optional[TheoreticalPlan]:
        """
        Attempt to synthesize an enriched TheoreticalPlan via AsyncOpenAI.
        Returns None on any failure so the caller falls back cleanly.
        """
        if not self.api_key:
            return None

        try:
            from openai import AsyncOpenAI
        except ImportError:
            logger.debug("openai package not installed; using deterministic symbolic planner.")
            return None

        skill_context = self.skill_loader.load_compact_prompt_context(request.genre, max_chars=12000)
        system_prompt = (
            "You are the ChordPlanner Symbolic Music Theory Engine guided by the "
            "music-composition skill. Return a strict JSON object matching the "
            "TheoreticalPlan schema.\n\n"
            f"SKILL KNOWLEDGE BASE:\n{skill_context}"
        )
        user_prompt = (
            "Create a TheoreticalPlan JSON for this GenerationRequest:\n"
            f"{request.model_dump_json(indent=2)}\n\n"
            "Requirements:\n"
            f"- camelot_key: '{deterministic_fallback.camelot_key.value}', "
            f"tonic_pc: {deterministic_fallback.tonic_pc}, "
            f"tonic_name: '{deterministic_fallback.tonic_name}', "
            f"scale_id: '{deterministic_fallback.scale_id}', "
            f"scale_pitches: {deterministic_fallback.scale_pitches}\n"
            f"- total_bars: {deterministic_fallback.total_bars}\n"
            f"- chord_progression_per_bar: list of exactly {deterministic_fallback.total_bars} chord symbols\n"
            f"- voice_leading_style: '{deterministic_fallback.voice_leading_style}'\n"
            f"- groove_style: '{deterministic_fallback.groove_style}'\n"
            f"- target_roles_order: {[r.value for r in deterministic_fallback.target_roles_order]}\n"
            "- primer_python_code: self-contained Python code defining `def build_primer() -> dict:` "
            "returning a dict compatible with midigpt.Score.from_dict with bar-relative onset_ticks."
        )

        try:
            client_kwargs = {"api_key": self.api_key}
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            client = AsyncOpenAI(**client_kwargs)
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.15,
                timeout=20.0,
            )
            content = response.choices[0].message.content or ""
            plan = TheoreticalPlan.model_validate_json(content)
            if "def build_primer" not in plan.primer_python_code:
                raise ValueError("LLM response primer_python_code missing build_primer()")
            if len(plan.chord_progression_per_bar) != deterministic_fallback.total_bars:
                raise ValueError("LLM response chord_progression_per_bar length mismatch")
            return plan
        except Exception as exc:
            logger.warning(
                "OpenAI planner call failed (%s); falling back to deterministic planner.",
                exc,
            )
            return None

    async def create_generation_plan(self, request: GenerationRequest) -> TheoreticalPlan:
        """
        Create a complete TheoreticalPlan (including executable primer_python_code)
        for `request`. Uses OpenAI when configured, falling back seamlessly to the
        deterministic music-composition symbolic planner.
        """
        deterministic_plan = self._create_deterministic_plan(request)
        if self.api_key:
            llm_plan = await self._query_openai(request, deterministic_plan)
            if llm_plan is not None:
                return llm_plan
        return deterministic_plan
