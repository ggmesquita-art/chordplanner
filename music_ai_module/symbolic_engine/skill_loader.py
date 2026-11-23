"""
SkillLoader: Loads compositional theory, harmony, voice-leading, form,
groove, and genre guides from the `music-composition` skill directory.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from music_ai_module.config import settings


# Mapping from normalized genre aliases to files inside references/genres/
GENRE_FILE_MAP: Dict[str, str] = {
    "pop": "pop-rock.md",
    "rock": "pop-rock.md",
    "indie": "pop-rock.md",
    "alternative": "pop-rock.md",
    "jazz": "jazz-styles.md",
    "bebop": "jazz-styles.md",
    "swing": "jazz-styles.md",
    "fusion": "jazz-styles.md",
    "hip-hop": "hip-hop-rnb.md",
    "hiphop": "hip-hop-rnb.md",
    "hip_hop": "hip-hop-rnb.md",
    "rap": "hip-hop-rnb.md",
    "trap": "hip-hop-rnb.md",
    "r&b": "hip-hop-rnb.md",
    "rnb": "hip-hop-rnb.md",
    "neo-soul": "hip-hop-rnb.md",
    "soul": "hip-hop-rnb.md",
    "latin": "latin-pop-and-reggaeton.md",
    "reggaeton": "latin-pop-and-reggaeton.md",
    "salsa": "latin-pop-and-reggaeton.md",
    "bachata": "latin-pop-and-reggaeton.md",
    "bossa": "brazilian-pop-and-funk.md",
    "brazilian": "brazilian-pop-and-funk.md",
    "mpb": "brazilian-pop-and-funk.md",
    "samba": "brazilian-pop-and-funk.md",
    "blues": "folk-roots-and-traditions.md",
    "classical": "classical-periods.md",
    "baroque": "classical-periods.md",
    "romantic": "classical-periods.md",
    "dance-electronic": "electronic-edm.md",
    "dance": "electronic-edm.md",
    "electronic": "electronic-edm.md",
    "edm": "electronic-edm.md",
    "house": "electronic-edm.md",
    "techno": "electronic-edm.md",
    "ambient": "electronic-edm.md",
    "dnb": "electronic-edm.md",
    "soundtrack": "film-tv-scoring.md",
    "film": "film-tv-scoring.md",
    "cinematic": "film-tv-scoring.md",
    "tv": "film-tv-scoring.md",
    "orchestral": "film-tv-scoring.md",
    "game": "game-music.md",
    "country": "country-americana.md",
    "folk": "folk-roots-and-traditions.md",
    "metal": "metal-punk-hardcore.md",
    "punk": "metal-punk-hardcore.md",
    "gospel": "gospel-and-ccm.md",
    "kpop": "kpop-jpop.md",
    "k-pop": "kpop-jpop.md",
    "jpop": "kpop-jpop.md",
    "j-pop": "kpop-jpop.md",
    "afrobeats": "afrobeats-and-amapiano.md",
    "theatre": "musical-theatre.md",
}

# Canonical Roman numeral progression templates aligned with assets/progressions-catalog.md
_GENRE_PROGRESSIONS_MAJOR: Dict[str, List[List[str]]] = {
    "pop": [
        ["I", "V", "vi", "IV"],          # Axis progression (C-G-Am-F)
        ["vi", "IV", "I", "V"],          # Axis variant (Am-F-C-G)
        ["I", "vi", "IV", "V"],          # 50s / doo-wop (C-Am-F-G)
        ["IV", "I", "V", "vi"],          # Plagal pop loop (F-C-G-Am)
        ["I", "IV", "vi", "V"],          # Chorus lift (C-F-Am-G)
    ],
    "jazz": [
        ["ii7", "V7", "Imaj7", "Imaj7"],       # Core ii-V-I cadence
        ["Imaj7", "vi7", "ii7", "V7"],         # Standard turnaround (I-vi-ii-V)
        ["iii7", "vi7", "ii7", "V7"],          # Circle-of-fifths back half
        ["Imaj7", "IVmaj7", "iii7", "vi7"],    # Lyrical major 7th cycle
    ],
    "rock": [
        ["I", "bVII", "IV", "I"],        # Mixolydian rock loop (G-F-C-G)
        ["I", "V", "IV", "I"],           # Classic rock/folk stability
        ["I", "IV", "V", "IV"],          # Open singalong rock
        ["I", "bVI", "bVII", "I"],       # Modal-mixture power-pop/rock
    ],
    "hip-hop": [
        ["Imaj7", "vi7", "IVmaj7", "V7"],      # Smooth R&B/hip-hop loop
        ["IVmaj7", "iii7", "vi7", "Imaj7"],    # Neo-soul lifted loop
        ["Imaj7", "V7", "vi7", "IVmaj7"],      # Lush 7th axis
    ],
    "latin": [
        ["I", "IV", "V", "IV"],          # Classic pop-latin / montuno groove
        ["ii7", "V7", "Imaj7", "vi7"],   # Bossa / Latin jazz turnaround
        ["I", "V", "vi", "IV"],          # Latin pop standard
    ],
    "blues": [
        ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],  # 12-bar blues
        ["I7", "IV7", "I7", "V7"],       # Condensed 4-bar blues turnaround
    ],
    "classical": [
        ["I", "IV", "V", "I"],           # Authentic tonal cadence
        ["I", "vi", "ii", "V"],          # Circle-of-fifths sequence
        ["I", "V", "vi", "iii", "IV", "I", "IV", "V"],  # Pachelbel-family sequence
    ],
    "dance-electronic": [
        ["vi", "IV", "I", "V"],          # Anthemic EDM / progressive house
        ["I", "V", "vi", "IV"],          # Uplifting dance loop
        ["IV", "V", "vi", "I"],          # Melodic house lift
    ],
    "soundtrack": [
        ["I", "V", "vi", "IV"],          # Warm cinematic theme
        ["I", "bVI", "bVII", "I"],       # Heroic modal-mixture cadence
        ["I", "iii", "IV", "iv"],        # Bittersweet film/TV mixture
    ],
}

_GENRE_PROGRESSIONS_MINOR: Dict[str, List[List[str]]] = {
    "pop": [
        ["i", "bVI", "bIII", "bVII"],    # Minor axis (Am-F-C-G)
        ["i", "bVII", "bVI", "bVII"],    # Minor anthem loop (Am-G-F-G)
        ["i", "bVI", "bVII", "i"],       # Natural-minor lift (Am-F-G-Am)
        ["i", "iv", "bVII", "bIII"],     # Descending minor flow
    ],
    "jazz": [
        ["iiø7", "V7b9", "im7", "im7"],        # Minor ii-V-i cadence
        ["im7", "iv7", "bVII7", "bIIImaj7"],   # Minor circle to relative major
        ["im7", "iiø7", "V7", "im7"],          # Minor turnaround
    ],
    "rock": [
        ["i", "bVII", "bVI", "bVII"],    # Aeolian rock anthem (Am-G-F-G)
        ["i", "bIII", "bVII", "IV"],     # Dorian/Aeolian guitar loop
        ["i", "iv", "i", "V"],           # Classic minor rock
    ],
    "hip-hop": [
        ["im7", "bVImaj7", "iv7", "V7"], # Moody minor trap/R&B loop
        ["im7", "bVII", "bVI", "V7"],    # Andalusian hip-hop/trap motion
        ["im7", "iv7", "im7", "bVII"],   # Lo-fi minor vamp
    ],
    "latin": [
        ["i", "bVII", "bVI", "V7"],      # Andalusian cadence (flamenco/latin)
        ["im7", "iv7", "bVII7", "bIIImaj7"],
        ["i", "iv", "V7", "i"],          # Bolero / minor latin cadence
    ],
    "blues": [
        ["im7", "im7", "im7", "im7", "iv7", "iv7", "im7", "im7", "bVI7", "V7", "im7", "V7"],  # 12-bar minor blues
        ["im7", "iv7", "im7", "V7"],     # 4-bar minor blues turnaround
    ],
    "classical": [
        ["i", "iv", "V", "i"],           # Functional minor cadence
        ["i", "ii°", "V", "i"],          # Minor cadence with raised leading tone
        ["i", "iv", "bVII", "bIII", "bVI", "ii°", "V", "i"],  # Full minor circle
    ],
    "dance-electronic": [
        ["i", "bVI", "bIII", "bVII"],    # Melodic techno / trance / EDM minor
        ["i", "bVII", "bVI", "V"],       # Driving club tension
        ["i", "iv", "bVI", "bVII"],      # Deep house minor loop
    ],
    "soundtrack": [
        ["i", "bVI", "bIII", "bVII"],    # Epic minor scoring
        ["i", "iv", "bVI", "V"],         # Dramatic minor build
        ["i", "bII", "i", "V"],          # Dark Phrygian-tinged tension
    ],
}

_GENRE_ALIAS_TO_PROGRESSION_KEY: Dict[str, str] = {
    "pop": "pop",
    "kpop": "pop",
    "k-pop": "pop",
    "jpop": "pop",
    "j-pop": "pop",
    "indie": "pop",
    "country": "pop",
    "folk": "pop",
    "gospel": "pop",
    "jazz": "jazz",
    "bebop": "jazz",
    "swing": "jazz",
    "fusion": "jazz",
    "bossa": "jazz",
    "rock": "rock",
    "alternative": "rock",
    "metal": "rock",
    "punk": "rock",
    "hip-hop": "hip-hop",
    "hiphop": "hip-hop",
    "hip_hop": "hip-hop",
    "rap": "hip-hop",
    "trap": "hip-hop",
    "r&b": "hip-hop",
    "rnb": "hip-hop",
    "neo-soul": "hip-hop",
    "soul": "hip-hop",
    "lo-fi": "hip-hop",
    "lofi": "hip-hop",
    "latin": "latin",
    "reggaeton": "latin",
    "salsa": "latin",
    "bachata": "latin",
    "brazilian": "latin",
    "mpb": "latin",
    "samba": "latin",
    "blues": "blues",
    "classical": "classical",
    "baroque": "classical",
    "romantic": "classical",
    "dance-electronic": "dance-electronic",
    "dance": "dance-electronic",
    "electronic": "dance-electronic",
    "edm": "dance-electronic",
    "house": "dance-electronic",
    "techno": "dance-electronic",
    "ambient": "dance-electronic",
    "dnb": "dance-electronic",
    "soundtrack": "soundtrack",
    "film": "soundtrack",
    "cinematic": "soundtrack",
    "tv": "soundtrack",
    "game": "soundtrack",
    "orchestral": "soundtrack",
}


class SkillLoader:
    """
    Loads and indexes compositional knowledge from `.agents/skills/music-composition`.
    """

    CORE_FILES: List[str] = [
        "SKILL.md",
        "references/00-navigation.md",
        "references/harmony/functional-harmony.md",
        "references/harmony/voice-leading.md",
        "references/harmony/jazz-harmony.md",
        "references/harmony/modal-harmony.md",
        "references/harmony/chord-construction.md",
        "references/form/popular-song-forms.md",
        "references/rhythm-groove/groove-and-feel.md",
        "assets/progressions-catalog.md",
        "assets/jazz-voicings.md",
        "assets/modes-cheatsheet.md",
        "assets/form-templates.md",
        "assets/cadence-reference.md",
    ]

    def __init__(self, skill_path: Optional[Path] = None) -> None:
        self.skill_path: Path = Path(skill_path) if skill_path is not None else settings.SKILL_PATH
        self._file_cache: Dict[str, str] = {}
        self._context_cache: Dict[str, str] = {}

    def _read_rel(self, rel_path: str) -> str:
        norm = rel_path.replace("\\", "/")
        if norm in self._file_cache:
            return self._file_cache[norm]
        target = self.skill_path / norm
        if not target.is_file():
            return ""
        text = target.read_text(encoding="utf-8", errors="replace").strip()
        self._file_cache[norm] = text
        return text

    def _discover_melody_files(self) -> List[str]:
        melody_dir = self.skill_path / "references" / "melody"
        if not melody_dir.is_dir():
            return []
        return sorted(
            f"references/melody/{p.name}"
            for p in melody_dir.glob("*.md")
            if p.is_file()
        )

    def _resolve_genre_file(self, genre: str) -> Optional[str]:
        g = genre.strip().lower()
        if g in GENRE_FILE_MAP:
            return f"references/genres/{GENRE_FILE_MAP[g]}"

        # Fuzzy match against available genre markdown files
        genres_dir = self.skill_path / "references" / "genres"
        if genres_dir.is_dir():
            for p in sorted(genres_dir.glob("*.md")):
                stem = p.stem.lower()
                if g and (g in stem or any(tok in stem for tok in g.replace("-", " ").split())):
                    return f"references/genres/{p.name}"
        return "references/genres/pop-rock.md"

    def get_loaded_files(self, genre: str = "pop") -> List[str]:
        """
        Return the list of relative skill files resolved for a given genre.
        """
        files: List[str] = []
        for rel in self.CORE_FILES:
            if (self.skill_path / rel).is_file():
                files.append(rel)
        for rel in self._discover_melody_files():
            if rel not in files:
                files.append(rel)
        genre_file = self._resolve_genre_file(genre)
        if genre_file and (self.skill_path / genre_file).is_file() and genre_file not in files:
            files.append(genre_file)
        return files

    def load_core_context(self, genre: str = "pop") -> str:
        """
        Return structured compositional context combining SKILL.md, harmony &
        voice-leading rules, melody/form/rhythm guides, asset catalogs, and the
        matching genre guide.
        """
        norm_genre = genre.strip().lower() or "pop"
        if norm_genre in self._context_cache:
            return self._context_cache[norm_genre]

        sections: List[str] = []
        for rel in self.get_loaded_files(norm_genre):
            content = self._read_rel(rel)
            if content:
                sections.append(f"=== {rel} ===\n{content}")

        if not sections:
            fallback = (
                "Music Composition Skill Knowledge Base (fallback summary): "
                "Apply functional T -> PD -> D -> T harmony, smooth voice leading "
                "(minimizing leaps, Drop-2 / Shell / Close voicings), genre-appropriate "
                "progressions, and clear formal section contrast."
            )
            self._context_cache[norm_genre] = fallback
            return fallback

        combined = "\n\n".join(sections)
        self._context_cache[norm_genre] = combined
        return combined

    def load_compact_prompt_context(self, genre: str = "pop", max_chars: int = 16000) -> str:
        """
        Build a token-budgeted context excerpt suitable for LLM system prompts.
        """
        norm_genre = genre.strip().lower() or "pop"
        priority_files = [
            "SKILL.md",
            "references/harmony/functional-harmony.md",
            "references/harmony/voice-leading.md",
            "assets/progressions-catalog.md",
            "assets/jazz-voicings.md",
            "assets/cadence-reference.md",
            self._resolve_genre_file(norm_genre) or "references/genres/pop-rock.md",
        ]
        parts: List[str] = []
        remaining = max_chars
        for rel in priority_files:
            content = self._read_rel(rel)
            if not content or remaining <= 200:
                continue
            snippet = content[: min(len(content), max(800, remaining // 2))]
            block = f"=== {rel} ===\n{snippet}"
            parts.append(block)
            remaining -= len(block) + 2

        return "\n\n".join(parts) if parts else self.load_core_context(norm_genre)[:max_chars]

    def get_genre_progressions(self, genre: str, is_minor: bool = False) -> List[List[str]]:
        """
        Return Roman numeral progression templates aligned with `progressions-catalog.md`
        for the given genre and tonality (major vs minor).
        """
        g = genre.strip().lower()
        key = _GENRE_ALIAS_TO_PROGRESSION_KEY.get(g)
        if key is None:
            # Check substring match against known keys
            for cand in _GENRE_PROGRESSIONS_MAJOR:
                if cand in g or g in cand:
                    key = cand
                    break
        if key is None:
            key = "pop"

        table = _GENRE_PROGRESSIONS_MINOR if is_minor else _GENRE_PROGRESSIONS_MAJOR
        templates = table.get(key, table["pop"])
        return [list(prog) for prog in templates]
