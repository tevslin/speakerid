"""
Example usage of the `speakerid` Python API (`examples/example_api_usage.py`).

Purpose (BoM):
    Demonstrates how to invoke `speakerid` programmatically from Python to
    produce SmartTranscripts™:
    1. Standard call using a local Ollama LLM (or remote Gemini/OpenAI).
    2. Supplying a custom user-defined `LLMProvider` subclass.
"""

import argparse
from typing import Any, Dict
from speakerid import (
    LLMConfig,
    LLMProvider,
    create_smart_transcript,
)


class CustomLocalLLM(LLMProvider):
    """Example showing how a user can plug in any custom LLM inference code."""

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Replaces the LLM call with custom inference logic returning speakers & agenda_items."""
        # Replace this stub with any custom local model call (e.g., llama_cpp.Llama, transformers, etc.)
        return {
            "speakers": [
                {
                    "speaker_id": "Speaker 0",
                    "speaker_name": "Host / Chair",
                    "reason": "Identified via custom LLM provider",
                    "confidence_level": 9,
                }
            ],
            "agenda_items": [
                {
                    "title": "Opening Remarks",
                    "start_time": 0.0,
                    "summary": "The chair opens the session.",
                }
            ],
        }


def run_with_configured_llm(
    audio_path: str,
    hints_path: str,
    provider: str = "ollama",
    model: str = "llama3.3",
    base_url: str = "",
) -> None:
    """Runs the full pipeline (WhisperX GPU + Diarization + LLM Speaker ID) and writes JSON + HTML."""
    llm_cfg = LLMConfig(
        provider=provider,
        model=model,
        base_url=base_url or None,
    )

    result = create_smart_transcript(
        audio_path=audio_path,
        hints=hints_path,
        output_json_path="output/smarttranscript.json",
        output_html_path="output/smarttranscript.html",
        llm_config=llm_cfg,
    )
    print(f"Created SmartTranscript™ for: {result.title}")
    print(f"  JSON saved to: {result.json_output_path}")
    print(f"  HTML saved to: {result.html_output_path}")


def main() -> None:
    """Parses CLI parameters and invokes the example function."""
    parser = argparse.ArgumentParser(description="Run speakerid Python API example.")
    parser.add_argument("audio", help="Path to audio file")
    parser.add_argument("--hints", default="examples/sample_info.json", help="Path to hints JSON/txt")
    parser.add_argument("--provider", default="ollama", help="LLM provider name")
    parser.add_argument("--model", default="llama3.3", help="LLM model name")
    parser.add_argument("--base-url", default="", help="Optional LLM base URL")
    args = parser.parse_args()

    run_with_configured_llm(
        audio_path=args.audio,
        hints_path=args.hints,
        provider=args.provider,
        model=args.model,
        base_url=args.base_url,
    )


if __name__ == "__main__":
    main()
