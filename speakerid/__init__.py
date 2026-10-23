"""
Package initialization for `speakerid` (SmartTranscripts™ Local GPU & Pluggable LLM Generator).

Purpose (BoM):
    Exposes the primary Python API for generating SmartTranscripts™ locally from
    arbitrary audio files using GPU-accelerated WhisperX transcription, PyAnnote
    speaker diarization, and pluggable local or remote LLMs for speaker
    identification, derived agendas, and summaries.

Dual-Use Architecture Summary (Human & LLM):
    - Entrypoint Function: `create_smart_transcript(...)`
    - Core Modules:
        * `speakerid.transcribe`: WhisperX ASR, Wav2Vec2 alignment, PyAnnote diarization.
        * `speakerid.schemas`: Pydantic schemas for Deepgram-compatible & LLM output structures.
        * `speakerid.llm`: Pluggable LLM adapter (OpenAI-compatible / Ollama / vLLM, Gemini, Anthropic, custom).
        * `speakerid.speaker_id`: Prompt construction, timestamp injection, speaker resolution.
        * `speakerid.html_renderer`: Standalone & multi-file interactive HTML SmartTranscript™ generator.
        * `speakerid.pipeline`: High-level orchestrator combining all stages.
        * `speakerid.cli`: Command-line interface (`speakerid`).
"""

from speakerid.pipeline import (
    create_smart_transcript,
    transcribe_and_diarize,
    identify_speakers_and_agenda,
)
from speakerid.llm import (
    LLMProvider,
    LLMConfig,
    create_llm_provider,
)
from speakerid.schemas import (
    DeepgramResponse,
    SpeakerIdentificationResult,
    SmartTranscriptOutput,
)

__version__ = "0.1.0"

__all__ = [
    "create_smart_transcript",
    "transcribe_and_diarize",
    "identify_speakers_and_agenda",
    "LLMProvider",
    "LLMConfig",
    "create_llm_provider",
    "DeepgramResponse",
    "SpeakerIdentificationResult",
    "SmartTranscriptOutput",
]
