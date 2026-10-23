"""
End-to-End SmartTranscript™ Pipeline Orchestrator (`speakerid.pipeline`).

Purpose (BoM):
    Provides the primary Python API (`create_smart_transcript`) that connects
    local GPU WhisperX transcription & PyAnnote diarization, pluggable LLM
    speaker identification & agenda/summary generation, and optional JSON and/or
    interactive HTML output generation.

Dual-Use API Specification (Human & LLM):
    - Primary Entrypoint: `create_smart_transcript(...) -> SmartTranscriptOutput`
    - Input Modes:
        1. From an audio file (`audio_path="meeting.m4a"`): Runs WhisperX ASR,
           phonetic alignment, and PyAnnote diarization on GPU/CPU.
        2. From a pre-computed transcription JSON (`precomputed_transcription="raw.json"`):
           Skips WhisperX and runs only LLM speaker ID + agenda + HTML/JSON output.
    - Output Modes (optionally both):
        * `output_json_path`: Saves the complete structured JSON (`transcription` + `speaker_id_analysis`).
        * `output_html_path`: Saves the interactive SmartTranscript™ HTML viewer.
"""

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

from speakerid.html_renderer import render_smart_transcript_html
from speakerid.llm import LLMConfig, LLMProvider, create_llm_provider
from speakerid.schemas import SmartTranscriptOutput
from speakerid.speaker_id import identify_speakers_and_agenda, parse_hints_input
from speakerid.transcribe import transcribe_and_diarize

logger = logging.getLogger(__name__)


def load_dotenv_if_present(dotenv_path: Optional[str] = None) -> None:
    """Loads key=value pairs from a local `.env` file into `os.environ` without overwriting existing env vars."""
    candidates = [dotenv_path] if dotenv_path else [".env", os.path.join(os.getcwd(), ".env")]
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip().lstrip("\ufeff")
                        v = v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v
            break


def extract_metadata_from_info(
    hints: Optional[Union[str, Dict[str, Any]]]
) -> Dict[str, str]:
    """Extracts optional `title`, `video_url`, and `jurisdiction` fields if `hints` is an `info.json` file or dict."""
    meta: Dict[str, str] = {}
    info_dict: Optional[Dict[str, Any]] = None
    if isinstance(hints, dict):
        info_dict = hints
    elif isinstance(hints, str) and os.path.exists(hints) and hints.lower().endswith(".json"):
        try:
            with open(hints, "r", encoding="utf-8") as f:
                info_dict = json.load(f)
        except Exception:
            info_dict = None

    if isinstance(info_dict, dict):
        if info_dict.get("title"):
            meta["title"] = str(info_dict["title"])
        if info_dict.get("video_url"):
            meta["video_url"] = str(info_dict["video_url"])
        if info_dict.get("jurisdiction"):
            meta["jurisdiction"] = str(info_dict["jurisdiction"])
    return meta


def create_smart_transcript(
    audio_path: Optional[str] = None,
    output_json_path: Optional[str] = None,
    output_html_path: Optional[str] = None,
    hints: Optional[Union[str, Dict[str, Any]]] = None,
    proper_nouns: Optional[List[str]] = None,
    title: Optional[str] = None,
    media_url: Optional[str] = None,
    jurisdiction: Optional[str] = None,
    whisper_model: str = "large-v3",
    language: Optional[str] = None,
    diarize: bool = True,
    device: str = "auto",
    compute_type: str = "auto",
    batch_size: int = 4,
    hf_token: Optional[str] = None,
    whisper_config: Optional[Dict[str, Any]] = None,
    model_cache_dir: Optional[str] = None,
    llm_provider: Optional[LLMProvider] = None,
    llm_config: Optional[LLMConfig] = None,
    skip_llm: bool = False,
    precomputed_transcription: Optional[Union[str, Dict[str, Any]]] = None,
    standalone_html: bool = True,
    template_path: Optional[str] = None,
    copy_assets: bool = False,
    debug_dir: Optional[str] = None,
    stage_callback: Optional[Callable[[str], None]] = None,
) -> SmartTranscriptOutput:
    """
    Executes the full SmartTranscript pipeline:
    1. Parses metadata/hints (`info.json`, text file, or string) into `hint_text` and `proper_nouns`.
    2. Runs GPU/CPU WhisperX transcription, alignment, and PyAnnote speaker diarization
       (or loads `precomputed_transcription` if provided).
    3. Runs speaker identification and agenda generation via the pluggable `LLMProvider`.
    4. Optionally writes the structured JSON output (`output_json_path`) and/or the
       interactive HTML SmartTranscript viewer (`output_html_path`).
    """
    load_dotenv_if_present()
    request_id = str(uuid.uuid4())

    # 1. Parse hints and metadata
    hint_text, merged_proper_nouns = parse_hints_input(hints=hints, extra_proper_nouns=proper_nouns)
    info_meta = extract_metadata_from_info(hints)

    resolved_title = (
        title
        or info_meta.get("title")
        or (Path(audio_path).stem if audio_path else "SmartTranscript")
    )
    resolved_jurisdiction = (
        jurisdiction if jurisdiction is not None else info_meta.get("jurisdiction", "")
    )
    resolved_media_url = (
        media_url
        or info_meta.get("video_url")
        or (Path(audio_path).name if audio_path else "")
    )

    resolved_whisper_model = (
        whisper_model
        or os.environ.get("WHISPER_MODEL")
        or "large-v3"
    )

    # 2. Obtain Deepgram-compatible transcription & diarization
    if precomputed_transcription is not None:
        if isinstance(precomputed_transcription, str):
            with open(precomputed_transcription, "r", encoding="utf-8") as f:
                loaded = json.load(f)
        else:
            loaded = precomputed_transcription
        deepgram_data = loaded.get("transcription", loaded)
    else:
        if not audio_path:
            raise ValueError("Either `audio_path` or `precomputed_transcription` must be provided.")
        deepgram_data = transcribe_and_diarize(
            audio_path=audio_path,
            model_name=resolved_whisper_model,
            language=language,
            diarize=diarize,
            proper_nouns=merged_proper_nouns,
            hf_token=hf_token,
            device=device,
            compute_type=compute_type,
            batch_size=batch_size,
            whisper_config=whisper_config,
            model_cache_dir=model_cache_dir,
            request_id=request_id,
            stage_callback=stage_callback,
        )

    # 3. Speaker ID & Agenda Extraction via Pluggable LLM
    structured_data: Optional[Dict[str, Any]] = None
    if not skip_llm:
        if stage_callback:
            stage_callback("Speaker ID & Agenda (LLM)")
        provider = llm_provider or create_llm_provider(llm_config)
        structured_data = identify_speakers_and_agenda(
            deepgram_data=deepgram_data,
            hint_text=hint_text,
            llm_provider=provider,
            debug_dir=debug_dir,
        )

    # 4. Assemble Output Payload
    output_obj = SmartTranscriptOutput(
        status="success",
        request_id=request_id,
        title=resolved_title,
        audio_path=audio_path or "",
        media_url=resolved_media_url,
        jurisdiction=resolved_jurisdiction,
        transcription=deepgram_data,
        speaker_id_analysis=structured_data,
        json_output_path=output_json_path,
        html_output_path=output_html_path,
    )

    # 5. Write JSON output if requested
    if output_json_path:
        out_json = Path(output_json_path)
        out_json.parent.mkdir(parents=True, exist_ok=True)
        payload_to_save = {
            "status": "success",
            "request_id": request_id,
            "title": resolved_title,
            "jurisdiction": resolved_jurisdiction,
            "media_url": resolved_media_url,
            "transcription": deepgram_data,
            "speaker_id_analysis": structured_data,
        }
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(payload_to_save, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved SmartTranscript JSON -> {out_json}")

    # 6. Write HTML output if requested
    if output_html_path:
        render_smart_transcript_html(
            deepgram_data=deepgram_data,
            structured_data=structured_data,
            output_path=output_html_path,
            meeting_title=resolved_title,
            media_url=resolved_media_url,
            jurisdiction=resolved_jurisdiction,
            template_path=template_path,
            standalone=standalone_html,
            copy_assets=copy_assets,
        )

    return output_obj
