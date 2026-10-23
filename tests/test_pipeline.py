"""
Unit and Integration Tests for `speakerid` (`tests/test_pipeline.py`).

Purpose (BoM):
    Verifies the end-to-end SmartTranscript™ pipeline, hints parsing, Deepgram schema
    mapping, pluggable LLM adapter, speaker override resolution, and HTML/JSON
    output generation without requiring a live GPU or remote API key.
"""

import json
import os
import tempfile
import unittest
from typing import Any, Dict

from unittest.mock import patch

from speakerid import (
    LLMProvider,
    create_smart_transcript,
)
from speakerid.speaker_id import (
    parse_hints_input,
    process_deepgram_output,
    resolve_speaker_mappings,
)
from speakerid.transcribe import (
    has_mlx_whisper,
    map_to_deepgram_response,
    resolve_compute_device_and_type,
    resolve_mlx_model_repo,
)


class MockLLMProvider(LLMProvider):
    """Deterministic mock LLM provider for testing speaker ID, overrides, and agenda generation."""

    def generate_json(self, prompt: str, system_prompt: str = "") -> Dict[str, Any]:
        """Validates that timestamps and speaker tags are present in the prompt and returns structured JSON."""
        assert "[Speaker 0]:" in prompt
        assert "[0.50]" in prompt
        return {
            "speakers": [
                {
                    "speaker_id": "Speaker 0",
                    "speaker_name": "Sen. Richard Westman (Chair)",
                    "reason": "Opens the meeting.",
                    "confidence_level": 9,
                },
                {
                    "speaker_id": "Speaker 1",
                    "speaker_name": "Patrick Murphy (AOT)",
                    "reason": "Presents the agency report.",
                    "confidence_level": 10,
                },
                {
                    "speaker_id": "Speaker 1",
                    "speaker_name": "Claire Nelson (UVM)",
                    "reason": "Overlapping presentation turn.",
                    "confidence_level": 9,
                    "start_time": 20.0,
                    "end_time": 40.0,
                },
            ],
            "agenda_items": [
                {
                    "title": "Call to Order",
                    "start_time": 0.5,
                    "summary": "Chair Westman opens the transportation committee hearing.",
                },
                {
                    "title": "UVM Research Presentation",
                    "start_time": 25.0,
                    "summary": "Claire Nelson walks through the mileage-based user fee timeline.",
                },
            ],
        }


class TestSpeakerIdPipeline(unittest.TestCase):
    """Tests for hints extraction, schema mapping, speaker resolution, and HTML/JSON rendering."""

    def setUp(self) -> None:
        """Creates a synthetic WhisperX output structure for testing."""
        self.sample_whisper_result = {
            "segments": [
                {
                    "start": 0.5,
                    "end": 4.2,
                    "text": "Welcome to the Senate Transportation Committee.",
                    "speaker": "SPEAKER_00",
                    "words": [
                        {"word": "Welcome", "start": 0.5, "end": 1.0, "score": 0.98, "speaker": "SPEAKER_00"},
                        {"word": "to", "start": 1.1, "end": 1.2, "score": 0.99, "speaker": "SPEAKER_00"},
                    ],
                },
                {
                    "start": 5.0,
                    "end": 12.0,
                    "text": "Thank you Mr. Chair, I am Patrick Murphy from AOT.",
                    "speaker": "SPEAKER_01",
                    "words": [
                        {"word": "Thank", "start": 5.0, "end": 5.5, "score": 0.95, "speaker": "SPEAKER_01"},
                    ],
                },
                {
                    "start": 25.0,
                    "end": 32.0,
                    "text": "And I am Claire Nelson presenting the timeline chart.",
                    "speaker": "SPEAKER_01",
                    "words": [
                        {"word": "And", "start": 25.0, "end": 25.4, "score": 0.96, "speaker": "SPEAKER_01"},
                    ],
                },
            ],
            "diagnostics": {
                "transcribe_time": 1.2,
                "align_time": 0.4,
                "diarize_time": 0.8,
            },
        }

    def test_hints_parsing_from_dict(self) -> None:
        """Verifies that structured member & proper-noun hints are properly extracted."""
        info = {
            "jurisdiction": "Vermont Legislature",
            "parent_committee": "Senate",
            "committee": "Transportation",
            "members": [
                {"name": "Richard Westman", "title": "Chair", "district": "Lamoille District"}
            ],
            "proper_nouns": ["MBUF", "AOT"],
        }
        hint_text, nouns = parse_hints_input(info)
        self.assertIn("Richard Westman (Chair, Lamoille District)", hint_text)
        self.assertIn("Westman", nouns)
        self.assertIn("Lamoille", nouns)
        self.assertIn("MBUF", nouns)

    def test_end_to_end_from_precomputed_with_custom_llm(self) -> None:
        """Verifies that `create_smart_transcript` generates both JSON and HTML with speaker overrides."""
        dg_model = map_to_deepgram_response(
            whisper_result=self.sample_whisper_result,
            model_name="large-v3",
            duration=35.0,
            request_id="test-req-123",
            include_paragraphs=True,
        )
        dg_dict = dg_model.model_dump()

        with tempfile.TemporaryDirectory() as tmpdir:
            json_out = os.path.join(tmpdir, "out.json")
            html_out = os.path.join(tmpdir, "out.html")

            result = create_smart_transcript(
                precomputed_transcription=dg_dict,
                output_json_path=json_out,
                output_html_path=html_out,
                title="Test Hearing",
                jurisdiction="Vermont Legislature",
                media_url="https://www.youtube.com/watch?v=T8uEA-lphcE",
                llm_provider=MockLLMProvider(),
            )

            self.assertEqual(result.status, "success")
            self.assertTrue(os.path.exists(json_out))
            self.assertTrue(os.path.exists(html_out))

            with open(json_out, "r", encoding="utf-8") as f:
                saved_json = json.load(f)
            self.assertEqual(len(saved_json["speaker_id_analysis"]["speakers"]), 3)
            self.assertEqual(len(saved_json["speaker_id_analysis"]["agenda_items"]), 2)

            with open(html_out, "r", encoding="utf-8") as f:
                saved_html = f.read()
            self.assertIn("[Sen. Richard Westman (Chair)]:", saved_html)
            self.assertIn("[Patrick Murphy (AOT)]:", saved_html)
            self.assertIn("[Claire Nelson (UVM)]:", saved_html)
            self.assertIn("Call to Order (00:00:00)", saved_html)

    def test_device_resolution_and_mlx_helpers(self) -> None:
        """Verifies CUDA, CPU, and Apple Silicon MLX/MPS device resolution and MLX repo mapping."""
        self.assertEqual(resolve_mlx_model_repo("large-v3"), "mlx-community/whisper-large-v3-mlx")
        self.assertEqual(resolve_mlx_model_repo("turbo"), "mlx-community/whisper-large-v3-turbo")
        self.assertEqual(resolve_mlx_model_repo("custom/org-model"), "custom/org-model")
        self.assertIsInstance(has_mlx_whisper(), bool)

        # Simulated Apple Silicon with MLX available
        with patch("torch.cuda.is_available", return_value=False), \
             patch("torch.backends.mps.is_available", return_value=True), \
             patch("speakerid.transcribe.has_mlx_whisper", return_value=True):
            (w_dev, w_comp), t_dev = resolve_compute_device_and_type("auto", "auto")
            self.assertEqual((w_dev, w_comp), ("mlx", "float16"))
            self.assertEqual(t_dev, "mps")

        # Simulated Apple Silicon without MLX installed (fallback to CPU/int8 + MPS)
        with patch("torch.cuda.is_available", return_value=False), \
             patch("torch.backends.mps.is_available", return_value=True), \
             patch("speakerid.transcribe.has_mlx_whisper", return_value=False):
            (w_dev, w_comp), t_dev = resolve_compute_device_and_type("auto", "auto")
            self.assertEqual((w_dev, w_comp), ("cpu", "int8"))
            self.assertEqual(t_dev, "mps")

        # Simulated Windows/Linux with NVIDIA CUDA available
        with patch("torch.cuda.is_available", return_value=True):
            (w_dev, w_comp), t_dev = resolve_compute_device_and_type("auto", "auto")
            self.assertEqual((w_dev, w_comp), ("cuda", "float16"))
            self.assertEqual(t_dev, "cuda")


if __name__ == "__main__":
    unittest.main()
