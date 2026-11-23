"""
Command-Line Interface (CLI) for music_ai_module.
Accepts GenerationRequest JSON from stdin (or --input file) and outputs clean
GenerationResult JSON strictly to stdout, redirecting all logs to stderr.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from music_ai_module.orchestrator import MusicAIOrchestrator
from music_ai_module.schemas import GenerationRequest, GenerationResult


def main() -> None:
    # Route all log handlers strictly to stderr to prevent polluting stdout JSON
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="ChordPlanner Music AI Module CLI")
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        default=None,
        help="Path to JSON file containing GenerationRequest (defaults to reading from stdin)",
    )
    args = parser.parse_args()

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            raw_input = f.read()
    else:
        raw_input = sys.stdin.read()

    try:
        request = GenerationRequest.model_validate_json(raw_input)
    except Exception as exc:
        sys.stderr.write(f"Validation error for GenerationRequest: {exc}\n")
        failure_result = GenerationResult(
            success=False,
            message=f"Invalid GenerationRequest: {exc}",
            bpm=120,
            time_signature=[4, 4],
            camelot_key=GenerationRequest().camelot_key,
            tracks=[],
        )
        print(failure_result.model_dump_json(indent=2))
        sys.exit(1)

    orchestrator = MusicAIOrchestrator()
    result = asyncio.run(orchestrator.generate(request))

    # Output strictly the clean JSON result to stdout
    print(result.model_dump_json(indent=2))

    if not result.success:
        sys.exit(1)


if __name__ == "__main__":
    main()
