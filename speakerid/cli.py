"""
Command-Line Interface for `speakerid` (`speakerid.cli`).

Purpose (BoM):
    Parses command-line arguments and invokes `create_smart_transcript()` so users
    can generate JSON and/or HTML SmartTranscripts™ from arbitrary audio files
    using local GPUs and any local or remote LLM.

Dual-Use CLI Reference (Human & LLM):
    - Entrypoint: `speakerid` (or `python -m speakerid.cli`)
    - Example Commands:
        1. Generate both JSON and HTML using local Ollama:
           `speakerid audio.m4a --hints info.json --llm-provider ollama --llm-model llama3.3 -o transcript.json --html transcript.html`
        2. Generate using a local vLLM / OpenAI-compatible server:
           `speakerid audio.m4a --llm-provider openai --llm-base-url http://localhost:8000/v1 --llm-model Qwen/Qwen2.5-32B-Instruct --html out.html`
        3. Generate using Google Gemini:
           `speakerid audio.m4a --hints info.json --llm-provider gemini --llm-model gemini-2.5-flash -o out.json --html out.html`
        4. Re-run LLM speaker ID & HTML rendering on an existing transcription JSON without re-running WhisperX:
           `speakerid --from-json raw_transcription.json --hints info.json --llm-provider ollama --html transcript.html`
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import List, Optional

from speakerid.llm import LLMConfig
from speakerid.pipeline import create_smart_transcript, load_dotenv_if_present


def build_arg_parser() -> argparse.ArgumentParser:
    """Constructs and returns the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="speakerid",
        description="Generate SmartTranscripts™ (ASR + Diarization + Speaker ID + Derived Agenda & Summaries + HTML/JSON) on local GPUs with a pluggable LLM.",
    )

    parser.add_argument(
        "audio",
        nargs="?",
        default=None,
        help="Path to the input audio/video file (e.g., audio.m4a, meeting.mp3, recording.wav).",
    )
    parser.add_argument(
        "--from-json",
        dest="from_json",
        default=None,
        help="Path to an existing Deepgram-compatible transcription JSON file (skips WhisperX GPU step).",
    )

    # Output options (optionally both JSON and HTML)
    out_group = parser.add_argument_group("Output Options (choose JSON, HTML, or both)")
    out_group.add_argument(
        "-o",
        "--output-json",
        dest="output_json",
        default=None,
        help="Output path for the structured JSON file (transcription + speaker_id_analysis).",
    )
    out_group.add_argument(
        "--html",
        "--output-html",
        dest="output_html",
        default=None,
        help="Output path for the interactive SmartTranscript HTML file.",
    )
    out_group.add_argument(
        "--web-shell",
        action="store_true",
        help="Use the multi-file SmartTranscripts web shell template + assets/ directory instead of the single-file standalone HTML.",
    )

    # Metadata & Hints
    meta_group = parser.add_argument_group("Meeting Metadata & Speaker Hints")
    meta_group.add_argument(
        "--hints",
        default=None,
        help="Path to an info.json file, a plain text hints file, or an inline hint string listing participants/members.",
    )
    meta_group.add_argument(
        "--proper-nouns",
        default=None,
        help="Comma-separated list of proper nouns/acronyms to bias WhisperX ASR (e.g., 'Westman,White,AOT,MBUF').",
    )
    meta_group.add_argument(
        "--title",
        default=None,
        help="Title of the meeting or recording (auto-detected from info.json or audio filename if omitted).",
    )
    meta_group.add_argument(
        "--media-url",
        default=None,
        help="URL or relative file path for the audio/video player inside the HTML viewer.",
    )
    meta_group.add_argument(
        "--jurisdiction",
        default=None,
        help="Optional organization or jurisdiction label for the HTML header.",
    )

    # WhisperX & Diarization Options
    asr_group = parser.add_argument_group("WhisperX & Diarization Options (GPU/CPU)")
    asr_group.add_argument(
        "--whisper-model",
        default=None,
        help="WhisperX ASR model size (default: env WHISPER_MODEL or 'large-v3'; maps to 'large-v3-turbo' on Apple Silicon MLX, or pass 'large-v3-full' for 32-layer MLX).",
    )
    asr_group.add_argument(
        "--language",
        default=None,
        help="ISO language code (e.g., 'en'). Auto-detected if omitted.",
    )
    asr_group.add_argument(
        "--no-diarize",
        action="store_true",
        help="Disable PyAnnote speaker diarization.",
    )
    asr_group.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "mps", "mlx", "cpu"],
        help="Compute device for WhisperX and PyAnnote (default: auto -> CUDA on NVIDIA PC/Linux, MLX/MPS on Apple Silicon Mac, CPU fallback).",
    )
    asr_group.add_argument(
        "--compute-type",
        default="auto",
        help="Faster-Whisper quantization type (default: auto -> float16 on CUDA, int8 on Mac/CPU).",
    )
    asr_group.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="WhisperX transcription batch size (default: 4).",
    )
    asr_group.add_argument(
        "--hf-token",
        default=None,
        help="Hugging Face token for PyAnnote diarization (defaults to HF_TOKEN env var).",
    )
    asr_group.add_argument(
        "--model-cache-dir",
        default=None,
        help="Optional local directory for caching Hugging Face / WhisperX models.",
    )

    # Pluggable LLM Options
    llm_group = parser.add_argument_group("Pluggable LLM Options (Local or Remote)")
    llm_group.add_argument(
        "--llm-provider",
        default=None,
        help="LLM provider: 'ollama', 'openai', 'vllm', 'lmstudio', 'llamacpp', 'gemini', 'anthropic', or 'litellm' (default: env LLM_PROVIDER or 'gemini').",
    )
    llm_group.add_argument(
        "--llm-model",
        default=None,
        help="Model name for speaker ID & agenda extraction (e.g., 'llama3.3', 'qwen2.5:32b', 'gemini-2.5-flash', 'gpt-4o').",
    )
    llm_group.add_argument(
        "--llm-base-url",
        default=None,
        help="Base URL for local/custom LLM server (e.g., 'http://localhost:11434' or 'http://localhost:8000/v1').",
    )
    llm_group.add_argument(
        "--llm-api-key",
        default=None,
        help="API key for remote LLM provider (defaults to provider environment variable).",
    )
    llm_group.add_argument(
        "--skip-llm",
        action="store_true",
        help="Skip LLM speaker identification and agenda generation (outputs raw diarized transcript).",
    )
    llm_group.add_argument(
        "--debug-dir",
        default=None,
        help="Optional directory to save raw LLM prompt and JSON completion for debugging.",
    )

    return parser


def run_cli(argv: Optional[List[str]] = None) -> int:
    """Parses CLI parameters and invokes `create_smart_transcript`."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        stream=sys.stdout,
    )
    load_dotenv_if_present()
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if not args.audio and not args.from_json:
        parser.error("You must provide either an input `audio` file or `--from-json <path>`.")

    # Default output path if neither --output-json nor --html was explicitly specified
    output_json = args.output_json
    output_html = args.output_html
    if not output_json and not output_html:
        stem = Path(args.audio).stem if args.audio else Path(args.from_json).stem
        output_json = f"{stem}_smarttranscript.json"
        output_html = f"{stem}_smarttranscript.html"

    proper_nouns_list = (
        [p.strip() for p in args.proper_nouns.split(",") if p.strip()]
        if args.proper_nouns
        else None
    )

    llm_cfg = LLMConfig()
    if args.llm_provider:
        llm_cfg.provider = args.llm_provider
    if args.llm_model:
        llm_cfg.model = args.llm_model
    if args.llm_base_url:
        llm_cfg.base_url = args.llm_base_url
    if args.llm_api_key:
        llm_cfg.api_key = args.llm_api_key

    create_smart_transcript(
        audio_path=args.audio,
        output_json_path=output_json,
        output_html_path=output_html,
        hints=args.hints,
        proper_nouns=proper_nouns_list,
        title=args.title,
        media_url=args.media_url,
        jurisdiction=args.jurisdiction,
        whisper_model=args.whisper_model,
        language=args.language,
        diarize=not args.no_diarize,
        device=args.device,
        compute_type=args.compute_type,
        batch_size=args.batch_size,
        hf_token=args.hf_token,
        model_cache_dir=args.model_cache_dir,
        llm_config=llm_cfg,
        skip_llm=args.skip_llm,
        precomputed_transcription=args.from_json,
        standalone_html=not args.web_shell,
        copy_assets=args.web_shell,
        debug_dir=args.debug_dir,
    )
    return 0


def main() -> None:
    """CLI entrypoint that delegates parameter interpretation to `run_cli`."""
    sys.exit(run_cli())


if __name__ == "__main__":
    main()
