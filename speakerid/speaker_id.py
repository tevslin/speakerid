"""
Speaker Identification, Overlap Overrides, and Agenda Generation (`speakerid.speaker_id`).

Purpose (BoM):
    Converts Deepgram-compatible speaker-segmented transcripts into timestamp-injected
    prompts, calls the localized `LLMProvider` to deduce real speaker identities
    (including time-bound overlap overrides) and <=15-minute agenda chapters and
    summaries, and parses structured metadata files (`info.json`) into proper-noun hints.

Dual-Use Logic & Data Flow (Human & LLM):
    1. `parse_hints_input(hints)` -> `(hint_text, proper_nouns)`:
       - Accepts either plain text, a path to a `.txt` or `.json` file, or a Python `dict`.
       - If given a structured `info.json` dict (with `jurisdiction`, `committee`, `members`,
         `participants`), automatically extracts `hint_text` for the LLM and `proper_nouns`
         for WhisperX `initial_prompt`.
    2. `process_deepgram_output(result_dict)` -> `(transcript_text, sentence_timings)`:
       - Formats speaker paragraphs as `[Speaker 0]: sentence 1 sentence 2...`
       - Records character offsets and millisecond start/end times for each sentence.
    3. `identify_speakers_and_agenda(...)` -> `dict`:
       - Injects `[seconds.cc]` timestamps at the start of every sentence.
       - Sends the unified legislative-aide prompt to `llm_provider.generate_json(...)`.
       - Returns `{"speakers": [...], "agenda_items": [...]}`.
    4. `resolve_speaker_mappings(structured_data)` -> `(speaker_map, speaker_overrides)`:
       - Maps generic integer speaker IDs to primary names (`speaker_map`) and
         time-windowed overrides (`speaker_overrides`).
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple, Union

from speakerid.llm import LLMConfig, LLMProvider, create_llm_provider

logger = logging.getLogger(__name__)


def parse_hints_input(
    hints: Optional[Union[str, Dict[str, Any]]] = None,
    extra_proper_nouns: Optional[List[str]] = None,
) -> Tuple[str, List[str]]:
    """
    Parses a hints input (JSON file path, text file path, raw string, or dict)
    into `(hint_text, proper_nouns)`.
    """
    hint_text = ""
    proper_nouns: List[str] = list(extra_proper_nouns or [])

    if not hints:
        return hint_text, sorted(set(proper_nouns))

    info_dict: Optional[Dict[str, Any]] = None
    if isinstance(hints, dict):
        info_dict = hints
    elif isinstance(hints, str):
        if os.path.exists(hints):
            with open(hints, "r", encoding="utf-8") as f:
                raw_content = f.read().strip()
            if hints.lower().endswith(".json") or raw_content.startswith("{"):
                try:
                    info_dict = json.loads(raw_content)
                except json.JSONDecodeError:
                    hint_text = raw_content
            else:
                hint_text = raw_content
        else:
            # Check if raw JSON string
            stripped = hints.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                try:
                    info_dict = json.loads(stripped)
                except json.JSONDecodeError:
                    hint_text = hints
            else:
                hint_text = hints

    if info_dict is not None:
        jurisdiction = info_dict.get("jurisdiction", "")
        parent_comm = info_dict.get("parent_committee", "")
        committee = info_dict.get("committee", "")
        members = info_dict.get("members", [])
        witnesses = info_dict.get("witnesses") or info_dict.get("participants") or []
        custom_hint = info_dict.get("hint_text", "")
        custom_nouns = info_dict.get("proper_nouns") or info_dict.get("keywords") or []

        if isinstance(custom_nouns, list):
            proper_nouns.extend([str(x) for x in custom_nouns])
        elif isinstance(custom_nouns, str):
            proper_nouns.extend([x.strip() for x in custom_nouns.split(",") if x.strip()])

        member_hints = []
        for m in members:
            if isinstance(m, str):
                member_hints.append(m)
                proper_nouns.append(m)
                continue
            name = m.get("name", "")
            title = m.get("title", "")
            district = m.get("district", "")
            clean_name = name.replace('"', "").strip()
            name_parts = clean_name.split()
            last_name = name_parts[-1] if name_parts else ""

            if clean_name:
                meta_parts = [p for p in (title, district) if p]
                if meta_parts:
                    member_hints.append(f"{clean_name} ({', '.join(meta_parts)})")
                else:
                    member_hints.append(clean_name)
                proper_nouns.append(clean_name)
                if last_name and len(last_name) > 2:
                    proper_nouns.append(last_name)

            if district:
                dist_parts = district.replace("District", "").strip().split()
                proper_nouns.extend(dist_parts)

        header_parts = [p for p in (jurisdiction, parent_comm, committee) if p]
        prefix = " ".join(header_parts)
        built_parts = []
        if member_hints:
            label = f"{prefix} Committee members: " if prefix else "Members: "
            built_parts.append(label + ", ".join(member_hints) + ".")
        if witnesses:
            if isinstance(witnesses, list):
                w_str = ", ".join([str(w) for w in witnesses])
            else:
                w_str = str(witnesses)
            built_parts.append(f"Witnesses/Participants: {w_str}.")
        if custom_hint:
            built_parts.append(str(custom_hint))

        hint_text = " ".join(built_parts).strip()

    deduped_nouns = sorted(
        set([pn.strip() for pn in proper_nouns if len(pn.strip()) > 1])
    )
    return hint_text, deduped_nouns


def process_deepgram_output(result_dict: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]]]:
    """Processes Deepgram-compatible JSON output into speaker-labeled text and sentence timings."""
    if "results" in result_dict:
        result_dict = result_dict["results"]

    final_text = ""
    sentence_timings: List[Dict[str, Any]] = []

    paragraphs = (
        result_dict.get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("paragraphs", {})
        .get("paragraphs", [])
    )

    for p in paragraphs:
        speaker_label = f"[Speaker {p.get('speaker', 'Unknown')}]: "
        final_text += speaker_label

        for s in p.get("sentences", []):
            sentence_text = s.get("text", "") + " "
            start_char = len(final_text)
            end_char = start_char + len(sentence_text)

            sentence_timings.append(
                {
                    "text": sentence_text.strip(),
                    "start_time": s.get("start", 0) * 1000.0,
                    "end_time": s.get("end", 0) * 1000.0,
                    "start_char": start_char,
                    "end_char": end_char,
                }
            )
            final_text += sentence_text

        final_text += "\n\n"

    return final_text.strip(), sentence_timings


def build_timestamped_transcript_prompt(
    transcript_text: str,
    sentence_timings: List[Dict[str, Any]],
    hint_text: str = "",
) -> Tuple[str, str]:
    """
    Injects `[seconds.cc]` timestamps into the transcript text and constructs
    the `(user_prompt, system_prompt)` pair for the LLM.
    """
    insertions = []
    for sentence in sentence_timings:
        start_char = sentence.get("start_char")
        if start_char is not None:
            timestamp = f"[{sentence['start_time'] / 1000.0:.2f}] "
            insertions.append((start_char, timestamp))

    insertions.sort(key=lambda x: x[0], reverse=True)
    text_parts = list(transcript_text)
    for pos, stamp in insertions:
        text_parts.insert(pos, stamp)
    prompt_transcript = "".join(text_parts)

    prompt = f"""
You are an expert legislative aide. Your task is to analyze the provided transcript of a public meeting and generate a single, valid JSON object containing a list of all identified speakers and a detailed, timestamped agenda.

**Input Transcript Details:**
- The transcript is a raw text dump from a transcription service.
- Speakers are initially labeled `[Speaker 0]`, `[Speaker 1]`, etc.
- Timestamps in the format `[123.45]` are injected at the start of each sentence, representing the start time in seconds.

**Rules for Speaker Identification:**
1.  Analyze the entire transcript to deduce the real names of the speakers.
2.  Use context, roll calls, introductions, and direct address (e.g., "Supervisor Walton," "President Mandelman") to map the generic speaker ID number to a specific person's name and title.
3.  Use the provided hint list of official members to help identify and correctly spell the names of regular participants.
4.  For each unique speaker, create an object in the `speakers` array.
5.  Provide a concise `reason` for each name assignment and a `confidence_level` from 0 to 10.
6.  CRITICAL: If the <hint> section is provided and lists official members, any speaker responding to a roll call vote (e.g., "Aye", "Nay", "Present") MUST be identified as one of those listed members.
7.  **Overlaps/Context Shifts:** If a single `speaker_id` (e.g., `[Speaker 3]`) is assigned to multiple different people at different times (due to diarization errors or overlap), create **multiple entries** for that `speaker_id` in the `speakers` array.
    - For the "main" speaker associated with that ID, omit `start_time` and `end_time`.
    - For the "temporary" or "overlapping" speaker, you MUST provide `start_time` and `end_time` (in seconds) defining the specific range where this person is speaking.
    - Only create these time-bound overrides if your `confidence_level` is **8 or higher**. If unsure, default to the main speaker or a generic label.

**Rules for Agenda Generation:**
1.  Identify the topics discussed during the meeting to create navigable video chapters. While chapters often correspond to distinct topics introduced by the chair (e.g., "Item twenty four"), **for video playback purposes, no chapter may be longer than 15 minutes in duration.**
2.  For each chapter, create an object in the `agenda_items` array.
3.  The `title` should be a concise description of the item. **CRITICAL: If a single topic spans more than 15 minutes, you MUST split it into multiple sequential chapters appended with "(Part 1)", "(Part 2)", etc.**
4.  The `start_time` must be the exact start time in seconds, taken from the timestamp (e.g., `[327.895]`) where the item or part begins.
5.  The `summary` should be a brief, neutral, one-sentence description of what was discussed.

**Example of a good `agenda_items` array showing a split topic:**
```json
[
  {{
    "title": "Unfinished Business (Items 24–26)",
    "start_time": 327.895,
    "summary": "Three ordinances were finally passed, covering emergency procurement, HSS plans for CY2026, and a legal settlement."
  }},
  {{
    "title": "Annual Budget Hearing (Part 1)",
    "start_time": 750.000,
    "summary": "The committee began discussing the proposed municipal budget for the upcoming fiscal year, focusing on the education sector."
  }},
  {{
    "title": "Annual Budget Hearing (Part 2)",
    "start_time": 1600.000,
    "summary": "Continuation of the municipal budget discussion, shifting focus into infrastructure and transportation funding."
  }}
]
```

**Output Format:**
The output MUST be a single, valid JSON object with two top-level keys: `speakers` and `agenda_items`. The keys within each object (`speaker_id`, `speaker_name`, `reason`, `confidence_level`, `start_time`, `end_time`, `title`, `summary`) must be named exactly as specified. Do not include any other text or explanations outside of the JSON object.

<transcript>
{prompt_transcript}
</transcript>

<hint>
{hint_text}
</hint>
"""
    system_prompt = (
        "You are an expert legislative aide. Your output must be a single, valid JSON object "
        "containing 'speakers' and 'agenda_items' keys. Do not output any markdown formatting "
        "or code blocks, just the raw JSON."
    )
    if hint_text:
        system_prompt += f" Use the following context to help identify speakers: {hint_text}"

    return prompt, system_prompt


def identify_speakers_and_agenda(
    deepgram_data: Dict[str, Any],
    hint_text: str = "",
    llm_provider: Optional[LLMProvider] = None,
    llm_config: Optional[LLMConfig] = None,
    debug_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Runs speaker identification and agenda generation on a Deepgram-formatted
    transcription dictionary using the provided `LLMProvider` (or `LLMConfig`).
    """
    transcript_text, sentence_timings = process_deepgram_output(deepgram_data)
    prompt, system_prompt = build_timestamped_transcript_prompt(
        transcript_text=transcript_text,
        sentence_timings=sentence_timings,
        hint_text=hint_text,
    )

    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        with open(os.path.join(debug_dir, "llm_prompt.txt"), "w", encoding="utf-8") as f:
            f.write(prompt)

    provider = llm_provider or create_llm_provider(llm_config)
    structured_data = provider.generate_json(prompt=prompt, system_prompt=system_prompt)

    if debug_dir:
        with open(os.path.join(debug_dir, "llm_response.json"), "w", encoding="utf-8") as f:
            json.dump(structured_data, f, indent=2, ensure_ascii=False)

    return structured_data


def resolve_speaker_mappings(
    structured_data: Optional[Dict[str, Any]]
) -> Tuple[Dict[int, str], List[Dict[str, Any]]]:
    """
    Extracts `(speaker_map, speaker_overrides)` from the LLM's `speakers` list.
    `speaker_map` maps integer speaker IDs to primary names.
    `speaker_overrides` is a list of `{"id": int, "name": str, "start": float, "end": float}`.
    """
    speaker_map: Dict[int, str] = {}
    speaker_overrides: List[Dict[str, Any]] = []

    if not structured_data:
        return speaker_map, speaker_overrides

    for sp in structured_data.get("speakers", []):
        speaker_id_val = sp.get("speaker_id") if sp.get("speaker_id") is not None else sp.get("id")
        speaker_name = sp.get("speaker_name") or sp.get("name")
        start_time = sp.get("start_time")
        end_time = sp.get("end_time")

        if speaker_id_val is not None and speaker_name:
            try:
                speaker_id_str = str(speaker_id_val).replace("[", "").replace("]", "").strip()
                speaker_id_int = int(float(speaker_id_str.split(" ")[-1]))

                if start_time is not None and end_time is not None:
                    speaker_overrides.append(
                        {
                            "id": speaker_id_int,
                            "name": speaker_name,
                            "start": float(start_time),
                            "end": float(end_time),
                        }
                    )
                else:
                    speaker_map[speaker_id_int] = speaker_name
            except (ValueError, IndexError):
                logger.warning(f"Could not parse speaker_id: '{speaker_id_val}'")

    return speaker_map, speaker_overrides
