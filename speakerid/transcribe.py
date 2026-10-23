"""
WhisperX Transcription, Alignment, and Diarization Engine (`speakerid.transcribe`).

Purpose (BoM):
    Executes the local GPU/CPU ASR transcription pipeline using WhisperX
    (`faster-whisper`), Wav2Vec2 phonetic alignment, and PyAnnote speaker
    diarization, then maps the results into the standardized Deepgram-compatible
    JSON schema with speaker-grouped paragraphs and word timings.

Dual-Use Pipeline Specification (Human & LLM):
    - Stage 1 (`ASR Transcription`):
        * Uses `whisperx.load_model(model_name, device, compute_type)`.
        * Applies decoding parameters from `DEFAULT_WHISPER_CONFIG` (beam_size, patience,
          repetition_penalty, temperatures, etc.).
        * Cleans and token-truncates proper-noun hints into `initial_prompt` (max 400 tokens).
    - Stage 2 (`Phonetic Alignment`):
        * Uses `whisperx.load_align_model(language_code, device)` and `whisperx.align(...)`
          for accurate word-level start and end timestamps.
    - Stage 3 (`Speaker Diarization`):
        * Uses `whisperx.diarize.DiarizationPipeline(token=hf_token, device=device)`
          and `whisperx.assign_word_speakers(...)` to assign `[Speaker N]` labels.
    - Stage 4 (`Deepgram Schema Mapping`):
        * Groups consecutive segments into speaker paragraphs (`include_paragraphs=True`),
          splitting on speaker change or silence gaps > 2.0 seconds.
"""

import dataclasses
import gc
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from speakerid.schemas import (
    Alternative,
    Channel,
    DeepgramResponse,
    Metadata,
    ModelInfo,
    ParagraphElement,
    ParagraphsData,
    ParagraphSentence,
    Results,
    Utterance,
    Word,
)

logger = logging.getLogger(__name__)

# Thread lock to ensure only one transcription runs on the GPU at a time
_gpu_lock = threading.Lock()

# In-memory model caches for repeated API invocations in the same process
_whisper_models: Dict[str, Any] = {}
_align_models: Dict[str, Tuple[Any, dict]] = {}
_diarize_pipeline: Optional[Any] = None

DEFAULT_WHISPER_CONFIG: Dict[str, Any] = {
    "beam_size": 5,
    "patience": 1.0,
    "repetition_penalty": 1.2,
    "no_repeat_ngram_size": 0,
    "no_speech_threshold": 0.6,
    "compression_ratio_threshold": 2.0,
    "log_prob_threshold": -1.0,
    "condition_on_previous_text": True,
    "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
}


def configure_model_cache_dir(model_cache_dir: Optional[str] = None) -> None:
    """Configures Hugging Face cache environment variables if a local model cache directory is provided."""
    target_dir = (
        model_cache_dir
        or os.environ.get("SPEAKERID_MODEL_DIR")
        or os.environ.get("SMARTTRANSCRIPT_MODEL_DIR")
    )
    if target_dir and os.path.exists(target_dir):
        os.environ["HF_HOME"] = target_dir
        hub_dir = os.path.join(target_dir, "hub")
        os.environ["HF_HUB_CACHE"] = hub_dir
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def get_whisper_model(model_name: str, device: str, compute_type: str) -> Any:
    """Loads and caches the WhisperX ASR model of the specified size."""
    import whisperx

    key = f"{model_name}_{device}_{compute_type}"
    if key not in _whisper_models:
        _whisper_models[key] = whisperx.load_model(
            model_name,
            device,
            compute_type=compute_type,
            download_root=None,
        )
    return _whisper_models[key]


def get_alignment_model(language_code: str, device: str) -> Tuple[Any, dict]:
    """Loads and caches the Wav2Vec2 phonetic alignment model for the given language."""
    import whisperx

    key = f"{language_code}_{device}"
    if key not in _align_models:
        _align_models[key] = whisperx.load_align_model(
            language_code=language_code,
            device=device,
            model_dir=None,
        )
    return _align_models[key]


def get_diarization_pipeline(device: str, hf_token: Optional[str] = None) -> Any:
    """Loads and caches the PyAnnote speaker diarization pipeline."""
    global _diarize_pipeline
    if _diarize_pipeline is None:
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        token = hf_token or os.environ.get("HF_TOKEN")
        if not token:
            logger.warning(
                "HF_TOKEN is not set. PyAnnote speaker diarization requires a Hugging Face token "
                "with access to pyannote/speaker-diarization-3.1."
            )
        diarize_model = os.environ.get(
            "SPEAKERID_DIARIZE_MODEL", "pyannote/speaker-diarization-3.1"
        )
        import whisperx.diarize

        _diarize_pipeline = whisperx.diarize.DiarizationPipeline(
            model_name=diarize_model,
            token=token,
            device=device,
        )
    return _diarize_pipeline


def resolve_compute_device_and_type(
    device: str = "auto",
    compute_type: str = "auto",
) -> Tuple[Tuple[str, str], str]:
    """
    Resolves `(whisper_device, whisper_compute_type)` and `torch_device` across
    Windows/Linux (CUDA/CPU) and macOS Apple Silicon (MPS for Torch + CPU/int8 for Faster-Whisper).
    """
    import torch

    req_device = (device or "auto").lower().strip()
    req_compute = (compute_type or "auto").lower().strip()

    has_cuda = torch.cuda.is_available()
    has_mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()

    if req_device in ("auto", "cuda"):
        if has_cuda:
            whisper_dev = "cuda"
            torch_dev = "cuda"
            whisper_comp = "float16" if req_compute in ("auto", "float16") else req_compute
        elif has_mps and req_device == "auto":
            logger.info("Apple Silicon MPS detected: using CPU/int8 for CTranslate2 ASR and MPS for alignment/diarization.")
            whisper_dev = "cpu"
            torch_dev = "mps"
            whisper_comp = "int8" if req_compute in ("auto", "float16") else req_compute
        else:
            if req_device == "cuda":
                logger.warning("CUDA requested but not available. Falling back to CPU (int8).")
            whisper_dev = "cpu"
            torch_dev = "cpu"
            whisper_comp = "int8" if req_compute in ("auto", "float16") else req_compute
    elif req_device == "mps":
        whisper_dev = "cpu"
        torch_dev = "mps" if has_mps else "cpu"
        whisper_comp = "int8" if req_compute in ("auto", "float16") else req_compute
    else:
        whisper_dev = "cpu"
        torch_dev = "cpu"
        whisper_comp = "int8" if req_compute in ("auto", "float16") else req_compute

    return (whisper_dev, whisper_comp), torch_dev


def truncate_prompt_tokens(prompt: str, tokenizer: Any, max_tokens: int = 400) -> str:
    """Truncates a comma-separated prompt so it does not exceed Faster-Whisper's token limit (448)."""
    if not prompt:
        return prompt
    try:
        encoding = tokenizer.encode(prompt)
        if len(encoding.ids) <= max_tokens:
            return prompt

        parts = prompt.split(",")
        while parts and len(encoding.ids) > max_tokens:
            parts.pop()
            new_prompt = ",".join(parts)
            encoding = tokenizer.encode(new_prompt)
        return ",".join(parts)
    except Exception as e:
        logger.warning(f"Failed to truncate prompt via tokenizer: {e}")
        words = prompt.split()
        limit = max_tokens * 3 // 4
        if len(words) > limit:
            return " ".join(words[:limit])
        return prompt


def clean_initial_prompt(prompt: str) -> str:
    """Splits prompt on commas/hyphens/spaces, removes digits, and deduplicates proper nouns."""
    if not prompt:
        return prompt
    words = []
    seen = set()
    parts = prompt.split(",")
    for part in parts:
        subparts = re.split(r"[\s\-]+", part)
        for sub in subparts:
            cleaned = re.sub(r"[^a-zA-Z]", "", sub)
            if cleaned:
                cleaned_title = cleaned.capitalize()
                if cleaned_title not in seen:
                    seen.add(cleaned_title)
                    words.append(cleaned_title)
    return ", ".join(words)


def map_speaker_string_to_int(speaker_str: Optional[str]) -> Optional[int]:
    """Extracts the integer speaker index from a PyAnnote label like 'SPEAKER_00'."""
    if not speaker_str:
        return None
    match = re.search(r"\d+", str(speaker_str))
    if match:
        return int(match.group())
    return abs(hash(str(speaker_str))) % 100


def map_to_deepgram_response(
    whisper_result: dict,
    model_name: str,
    duration: float,
    request_id: str,
    include_utterances: bool = False,
    include_paragraphs: bool = True,
    diagnostics: Optional[dict] = None,
) -> DeepgramResponse:
    """Maps raw WhisperX segments and word alignments into the Deepgram v1 response schema."""
    segments = whisper_result.get("segments", [])

    all_words: List[Word] = []
    total_conf = 0.0
    conf_count = 0

    for seg in segments:
        seg_speaker = map_speaker_string_to_int(seg.get("speaker"))
        for w in seg.get("words", []):
            start_t = w.get("start", seg.get("start", 0.0))
            end_t = w.get("end", seg.get("end", 0.0))
            conf = w.get("score", 1.0)

            total_conf += conf
            conf_count += 1

            speaker_id = (
                map_speaker_string_to_int(w.get("speaker"))
                if "speaker" in w
                else seg_speaker
            )

            all_words.append(
                Word(
                    word=w.get("word", ""),
                    start=start_t,
                    end=end_t,
                    confidence=conf,
                    speaker=speaker_id,
                    speaker_confidence=1.0 if speaker_id is not None else None,
                    punctuated_word=w.get("word", ""),
                )
            )

    avg_confidence = (total_conf / conf_count) if conf_count > 0 else 1.0
    full_transcript = " ".join(
        [seg.get("text", "").strip() for seg in segments]
    ).strip()

    paragraphs_data = None
    if include_paragraphs and segments:
        paragraph_list: List[ParagraphElement] = []
        current_sentences: List[ParagraphSentence] = []
        current_speaker: Optional[int] = None
        p_start: Optional[float] = None
        p_end: Optional[float] = None

        for seg in segments:
            seg_speaker = map_speaker_string_to_int(seg.get("speaker")) or 0
            seg_text = seg.get("text", "").strip()
            seg_start = seg.get("start", 0.0)
            seg_end = seg.get("end", 0.0)

            speaker_changed = (
                current_speaker is not None and seg_speaker != current_speaker
            )
            time_gap = (
                p_end is not None
                and seg_start is not None
                and (seg_start - p_end) > 2.0
            )

            if current_speaker is None or speaker_changed or time_gap:
                if current_sentences:
                    p_words_count = sum(
                        len(s.text.split()) for s in current_sentences
                    )
                    paragraph_list.append(
                        ParagraphElement(
                            speaker=current_speaker or 0,
                            num_words=p_words_count,
                            start=p_start or 0.0,
                            end=p_end or 0.0,
                            sentences=current_sentences,
                        )
                    )
                current_speaker = seg_speaker
                current_sentences = []
                p_start = seg_start

            current_sentences.append(
                ParagraphSentence(text=seg_text, start=seg_start, end=seg_end)
            )
            p_end = seg_end

        if current_sentences:
            p_words_count = sum(len(s.text.split()) for s in current_sentences)
            paragraph_list.append(
                ParagraphElement(
                    speaker=current_speaker or 0,
                    num_words=p_words_count,
                    start=p_start or 0.0,
                    end=p_end or 0.0,
                    sentences=current_sentences,
                )
            )

        paragraphs_data = ParagraphsData(
            transcript=full_transcript,
            paragraphs=paragraph_list,
        )

    utterance_list = None
    if include_utterances:
        utterance_list = []
        for seg in segments:
            seg_speaker = map_speaker_string_to_int(seg.get("speaker"))
            seg_words = []
            for w in seg.get("words", []):
                start_t = w.get("start", seg.get("start", 0.0))
                end_t = w.get("end", seg.get("end", 0.0))
                conf = w.get("score", 1.0)
                w_speaker = (
                    map_speaker_string_to_int(w.get("speaker"))
                    if "speaker" in w
                    else seg_speaker
                )
                seg_words.append(
                    Word(
                        word=w.get("word", ""),
                        start=start_t,
                        end=end_t,
                        confidence=conf,
                        speaker=w_speaker,
                        speaker_confidence=1.0 if w_speaker is not None else None,
                        punctuated_word=w.get("word", ""),
                    )
                )

            utterance_list.append(
                Utterance(
                    start=seg.get("start", 0.0),
                    end=seg.get("end", 0.0),
                    confidence=1.0,
                    channel=0,
                    transcript=seg.get("text", "").strip(),
                    words=seg_words,
                    speaker=seg_speaker,
                    id=str(uuid.uuid4()),
                )
            )

    alt = Alternative(
        transcript=full_transcript,
        confidence=avg_confidence,
        words=all_words,
        paragraphs=paragraphs_data,
    )
    channel_obj = Channel(alternatives=[alt])

    created_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    meta = Metadata(
        request_id=request_id,
        created=created_str,
        duration=duration,
        models=[model_name],
        model_info={
            model_name: ModelInfo(
                name=model_name,
                version="v3",
                arch="whisperx",
            )
        },
        diagnostics=diagnostics,
    )

    return DeepgramResponse(
        metadata=meta,
        results=Results(
            channels=[channel_obj],
            utterances=utterance_list,
        ),
    )


def transcribe_audio_raw(
    audio_path: str,
    model_name: str = "large-v3",
    language: Optional[str] = None,
    diarize: bool = True,
    initial_prompt: Optional[str] = None,
    hf_token: Optional[str] = None,
    device: str = "cuda",
    compute_type: str = "float16",
    batch_size: int = 4,
    whisper_config: Optional[Dict[str, Any]] = None,
    model_cache_dir: Optional[str] = None,
    stage_callback: Optional[Callable[[str], None]] = None,
) -> Tuple[dict, float]:
    """
    Runs the WhisperX ASR, phonetic alignment, and PyAnnote diarization pipeline on a local audio file.
    Returns `(whisper_result_dict, audio_duration_seconds)`.
    """
    try:
        import torch
        import whisperx
    except ImportError as e:
        raise ImportError(
            "WhisperX and PyTorch are required for local transcription. "
            "Install them via `pip install torch whisperx pyannote.audio`."
        ) from e

    configure_model_cache_dir(model_cache_dir)

    (whisper_device, whisper_compute), torch_device = resolve_compute_device_and_type(
        device=device,
        compute_type=compute_type,
    )

    with _gpu_lock:
        audio = whisperx.load_audio(audio_path)
        duration = len(audio) / 16000.0

        # 1. ASR Transcription
        if stage_callback:
            stage_callback("ASR Transcription")
        logger.info(
            f"Running WhisperX ASR transcription (model={model_name}, device={whisper_device}, compute_type={whisper_compute})..."
        )
        t0 = time.time()
        model = get_whisper_model(model_name, whisper_device, whisper_compute)

        config = dict(DEFAULT_WHISPER_CONFIG)
        if whisper_config:
            config.update(whisper_config)

        if initial_prompt:
            initial_prompt = clean_initial_prompt(initial_prompt)
            logger.info(f"Cleaned initial_prompt ({len(initial_prompt)} chars)")

        original_options = model.options
        new_opts: Dict[str, Any] = {}
        valid_fields = {field.name for field in dataclasses.fields(model.options)}

        for k, v in config.items():
            if k in valid_fields:
                if k == "temperature" and isinstance(v, list) and "temperatures" in valid_fields:
                    new_opts["temperatures"] = [float(t) for t in v]
                elif k == "temperatures" and isinstance(v, list):
                    new_opts["temperatures"] = [float(t) for t in v]
                else:
                    new_opts[k] = v

        if initial_prompt:
            try:
                tokenizer = getattr(model.model, "hf_tokenizer", None)
                if tokenizer:
                    truncated = truncate_prompt_tokens(initial_prompt, tokenizer, max_tokens=400)
                    if len(truncated) < len(initial_prompt):
                        logger.info(
                            f"Truncated initial_prompt from {len(initial_prompt)} to {len(truncated)} chars (400 token limit)."
                        )
                        initial_prompt = truncated
            except Exception as e:
                logger.warning(f"Error truncating initial prompt: {e}")
            new_opts["initial_prompt"] = initial_prompt

        if new_opts:
            model.options = dataclasses.replace(model.options, **new_opts)

        try:
            result = model.transcribe(audio, batch_size=batch_size, language=language)
        finally:
            model.options = original_options

        transcribe_time = time.time() - t0
        detected_language = result.get("language", language or "en")

        # 2. Phonetic Alignment
        if stage_callback:
            stage_callback("Phonetic Alignment")
        logger.info(f"Running WhisperX phoneme alignment (device={torch_device})...")
        align_time = 0.0
        try:
            t0 = time.time()
            model_a, metadata = get_alignment_model(detected_language, torch_device)
            result = whisperx.align(
                result["segments"],
                model_a,
                metadata,
                audio,
                torch_device,
                return_char_alignments=False,
            )
            align_time = time.time() - t0
        except Exception as e:
            logger.warning(f"Phonetic alignment failed ({e}); falling back to segment-level timestamps.")

        # 3. Speaker Diarization
        diarize_time = 0.0
        if diarize:
            if stage_callback:
                stage_callback("Speaker Diarization")
            logger.info(f"Running PyAnnote speaker diarization (device={torch_device})...")
            try:
                t0 = time.time()
                pipeline = get_diarization_pipeline(torch_device, hf_token)
                diarize_segments = pipeline(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                diarize_time = time.time() - t0
            except Exception as e:
                logger.warning(f"Speaker diarization failed ({e}); continuing without speaker labels.")

        gc.collect()
        if torch_device == "cuda":
            torch.cuda.empty_cache()

        result["diagnostics"] = {
            "transcribe_time": round(transcribe_time, 3),
            "align_time": round(align_time, 3),
            "diarize_time": round(diarize_time, 3),
        }
        return result, duration


def transcribe_and_diarize(
    audio_path: str,
    model_name: str = "large-v3",
    language: Optional[str] = None,
    diarize: bool = True,
    proper_nouns: Optional[Union[List[str], str]] = None,
    hf_token: Optional[str] = None,
    device: str = "cuda",
    compute_type: str = "float16",
    batch_size: int = 4,
    include_paragraphs: bool = True,
    include_utterances: bool = False,
    whisper_config: Optional[Dict[str, Any]] = None,
    model_cache_dir: Optional[str] = None,
    request_id: Optional[str] = None,
    stage_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """
    High-level function to transcribe, align, and diarize an audio file and return
    a Deepgram-compatible JSON dictionary.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    req_id = request_id or str(uuid.uuid4())
    start_wall = time.time()

    initial_prompt: Optional[str] = None
    if proper_nouns:
        if isinstance(proper_nouns, list):
            flat = [p.strip() for kw in proper_nouns for p in kw.split(",") if p.strip()]
            initial_prompt = ", ".join(flat) if flat else None
        elif isinstance(proper_nouns, str):
            initial_prompt = proper_nouns.strip() or None

    whisper_result, duration = transcribe_audio_raw(
        audio_path=audio_path,
        model_name=model_name,
        language=language,
        diarize=diarize,
        initial_prompt=initial_prompt,
        hf_token=hf_token,
        device=device,
        compute_type=compute_type,
        batch_size=batch_size,
        whisper_config=whisper_config,
        model_cache_dir=model_cache_dir,
        stage_callback=stage_callback,
    )

    diagnostics = dict(whisper_result.get("diagnostics", {}))
    diagnostics["total_processing_time"] = round(time.time() - start_wall, 3)

    dg_response = map_to_deepgram_response(
        whisper_result=whisper_result,
        model_name=model_name,
        duration=duration,
        request_id=req_id,
        include_utterances=include_utterances,
        include_paragraphs=include_paragraphs,
        diagnostics=diagnostics,
    )
    return dg_response.model_dump()
