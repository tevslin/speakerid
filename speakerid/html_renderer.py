"""
HTML SmartTranscript™ Renderer (`speakerid.html_renderer`).

Purpose (BoM):
    Renders interactive HTML SmartTranscript™ pages from Deepgram-compatible
    transcription data and LLM speaker/agenda analysis. Supports both:
    1. A self-contained, single-file standalone HTML viewer (works directly via
       `file://` or any local browser with local audio/video files or YouTube URLs).
    2. The full SmartTranscripts™ web template (`viewer_template.html` + `assets/`)
       for multi-meeting site deployments.

Dual-Use Rendering Specification (Human & LLM):
    - Utterance DOM Format:
        `<p><strong>[Resolved Speaker Name]:</strong> <span class="utterance" data-start-time="123.45">Sentence text </span>...</p>`
    - Agenda DOM Format:
        `<nav id="agenda"><ul><li><a href="#item-0" data-start-time="0">Title (00:00:00)</a><div class="agenda-summary">...</div></li></ul></nav>`
    - Embedded Data Island:
        `<script id="meeting-data" type="application/json">{ "title": ..., "video_url": ..., "speakers": [...] }</script>`
    - Deep-Linking Protocol:
        Supports `?startTime=XXX&endTime=YYY`, `?q=search_term`, and `?speaker=Name`.
"""

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from speakerid.speaker_id import resolve_speaker_mappings

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


def format_time(seconds: float) -> str:
    """Formats seconds into HH:MM:SS string."""
    sec = max(0, int(seconds))
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def build_transcript_and_agenda_fragments(
    paragraphs: List[Dict[str, Any]],
    agenda_items: List[Dict[str, Any]],
    speaker_map: Dict[int, str],
    speaker_overrides: List[Dict[str, Any]],
) -> Tuple[str, str]:
    """
    Constructs `(agenda_html, transcript_html)` from paragraphs, agenda items,
    and resolved speaker mappings (including time-bound overrides).
    """
    agenda_html = ""
    for i, item in enumerate(agenda_items):
        title = item.get("title", "Untitled")
        start_time = float(item.get("start_time", 0.0))
        summary = item.get("summary", "")
        agenda_html += (
            f'<li><a href="#item-{i}" data-start-time="{start_time}">'
            f"{title} ({format_time(start_time)})</a>"
            f'<div class="agenda-summary">{summary}</div></li>\n'
        )

    rebuilt_transcript_html = ""
    current_speaker = -1
    current_speaker_name = ""

    for para in paragraphs:
        speaker_id = para.get("speaker", 0)
        para_start = para.get("start", 0.0)

        resolved_name = speaker_map.get(speaker_id, f"Speaker {speaker_id}")
        for override in speaker_overrides:
            if (
                override["id"] == speaker_id
                and override["start"] <= para_start <= override["end"]
            ):
                resolved_name = override["name"]
                break

        if speaker_id != current_speaker or resolved_name != current_speaker_name:
            if current_speaker != -1:
                rebuilt_transcript_html += "</p>\n"
            rebuilt_transcript_html += f"<p><strong>[{resolved_name}]:</strong> "
            current_speaker = speaker_id
            current_speaker_name = resolved_name
        else:
            rebuilt_transcript_html += "\n"

        for sentence in para.get("sentences", []):
            start_time_sec = sentence.get("start", 0.0)
            end_time_sec = sentence.get("end", start_time_sec)
            sentence_text = sentence.get("text", "").strip() + " "
            rebuilt_transcript_html += (
                f'<span class="utterance" data-start-time="{start_time_sec}" '
                f'data-end-time="{end_time_sec}">{sentence_text}</span>'
            )

    if paragraphs:
        rebuilt_transcript_html += "</p>\n"

    return agenda_html, rebuilt_transcript_html


STANDALONE_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{PAGE_TITLE}}</title>
    <meta property="og:title" content="{{OG_TITLE}}" />
    <meta property="og:description" content="{{OG_DESCRIPTION}}" />
    <style>
        :root {
            --primary: #005a9c;
            --primary-hover: #004578;
            --bg-light: #f4f5f7;
            --border: #d8dde6;
            --highlight: #fff3cd;
            --selection: #cce5ff;
        }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0; padding: 0;
            background: var(--bg-light); color: #222;
            display: flex; flex-direction: column; height: 100vh; overflow: hidden;
        }
        header.page-header {
            background: #fff; border-bottom: 1px solid var(--border);
            padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;
            flex-shrink: 0;
        }
        .header-title-group { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .header-title-group h1 { margin: 0; font-size: 1.35rem; color: var(--primary); }
        .header-title-group h2 { margin: 0; font-size: 1.15rem; font-weight: 500; color: #444; }
        .toolbar { display: flex; gap: 8px; }
        .toolbar button {
            background: var(--primary); color: #fff; border: none; border-radius: 4px;
            padding: 7px 12px; cursor: pointer; font-size: 0.85rem; font-weight: 500;
        }
        .toolbar button:hover { background: var(--primary-hover); }
        #workspace {
            display: flex; flex: 1; min-height: 0; overflow: hidden;
        }
        #left-pane {
            width: 420px; min-width: 280px; max-width: 600px;
            background: #fff; border-right: 1px solid var(--border);
            display: flex; flex-direction: column; min-height: 0;
        }
        #player-section {
            padding: 12px; border-bottom: 1px solid var(--border); background: #fafafa;
        }
        #time-range {
            font-size: 0.85rem; font-weight: 600; color: #333; margin-bottom: 8px;
        }
        #player-controls {
            display: flex; gap: 8px; margin-bottom: 8px;
        }
        #player-controls button {
            padding: 6px 12px; border: 1px solid var(--border); background: #fff;
            border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 500;
        }
        #player-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
        #player-wrapper {
            width: 100%; background: #000; border-radius: 6px; overflow: hidden;
        }
        #player-wrapper video, #player-wrapper audio {
            width: 100%; display: block;
        }
        #player-wrapper iframe {
            width: 100%; aspect-ratio: 16 / 9; border: none; display: block;
        }
        .pane-tabs {
            display: flex; border-bottom: 1px solid var(--border); background: #f0f2f5;
        }
        .pane-tab {
            flex: 1; padding: 10px 8px; border: none; background: transparent;
            cursor: pointer; font-size: 0.85rem; font-weight: 500; color: #555;
            border-bottom: 2px solid transparent;
        }
        .pane-tab.active {
            background: #fff; color: var(--primary); font-weight: 700;
            border-bottom-color: var(--primary);
        }
        .tab-content {
            display: none; flex: 1; overflow-y: auto; padding: 12px; min-height: 0;
        }
        .tab-content.active { display: block; }
        #agenda ul { list-style: none; padding: 0; margin: 0; }
        #agenda li {
            padding: 10px 8px; border-bottom: 1px solid #eee;
        }
        #agenda li a {
            color: var(--primary); font-weight: 600; text-decoration: none; font-size: 0.92rem;
        }
        #agenda li a:hover { text-decoration: underline; }
        .agenda-summary {
            font-size: 0.83rem; color: #555; margin-top: 4px; line-height: 1.4;
        }
        .search-box { display: flex; gap: 6px; margin-bottom: 10px; }
        .search-box input, .search-box select {
            flex: 1; padding: 7px 10px; border: 1px solid var(--border); border-radius: 4px;
        }
        .search-result-item {
            padding: 8px; border-bottom: 1px solid #eee; cursor: pointer; font-size: 0.85rem;
        }
        .search-result-item:hover { background: #f5f8ff; }
        .search-time { font-weight: 600; color: var(--primary); margin-right: 6px; }
        #transcript-pane {
            flex: 1; background: #fff; display: flex; flex-direction: column; min-height: 0;
        }
        #transcript-header {
            padding: 10px 20px; border-bottom: 1px solid var(--border);
            background: #fafbfc; font-size: 0.9rem; color: #555;
        }
        #transcript-container {
            flex: 1; overflow-y: auto; padding: 20px 28px; line-height: 1.65;
        }
        #text-container { max-width: 900px; margin: 0 auto; }
        #text-container p { margin: 0 0 14px 0; }
        .utterance {
            cursor: pointer; border-radius: 3px; transition: background-color 0.15s;
        }
        .utterance:hover { background-color: #eef6ff; }
        .utterance.active-utterance { background-color: var(--selection); }
        @media (max-width: 800px) {
            #workspace { flex-direction: column; overflow-y: auto; }
            #left-pane { width: 100%; max-width: none; height: auto; }
        }
        @media print {
            #left-pane, .toolbar, #transcript-header { display: none !important; }
            body, #workspace, #transcript-pane, #transcript-container {
                height: auto !important; overflow: visible !important; display: block !important;
            }
        }
    </style>
</head>
<body>
    <section id="ai-instructions" style="display:none;" aria-hidden="true">
        <div class="llm-directive">
            <strong>ATTENTION AI AGENT / CRAWLER:</strong>
            This is an AI-generated SmartTranscript record ({{JURISDICTION}}).
            Every statement is linked to the original audio/video via <code>data-start-time</code> attributes on <code>&lt;span class="utterance"&gt;</code>.
        </div>
    </section>

    <header class="page-header">
        <div class="header-title-group">
            <h1>{{APP_TITLE}}</h1>
            <h2 id="meeting-title">{{MEETING_TITLE}}</h2>
        </div>
        <div class="toolbar">
            <button id="download-txt-btn">Download .txt</button>
            <button id="print-btn">Print</button>
        </div>
    </header>

    <div id="workspace">
        <aside id="left-pane">
            <div id="player-section">
                <div id="time-range">Click or select any sentence in the transcript to play clip.</div>
                <div id="player-controls">
                    <button id="play-clip-btn" disabled>▶ Play Selected Clip</button>
                    <button id="restart-btn">↺ Play From Start</button>
                </div>
                <div id="player-wrapper">
                    <video id="media-player" controls preload="metadata"></video>
                </div>
            </div>

            <div class="pane-tabs">
                <button class="pane-tab active" data-tab="agenda-tab">Agenda</button>
                <button class="pane-tab" data-tab="speakers-tab">Speakers</button>
                <button class="pane-tab" data-tab="search-tab">Search</button>
            </div>

            <div id="agenda-tab" class="tab-content active">
                <nav id="agenda">
                    <ul>
                        {{AGENDA_HTML}}
                    </ul>
                </nav>
            </div>

            <div id="speakers-tab" class="tab-content">
                <div class="search-box">
                    <select id="speaker-select">
                        <option value="">Select a speaker...</option>
                    </select>
                </div>
                <div id="speaker-results"></div>
            </div>

            <div id="search-tab" class="tab-content">
                <div class="search-box">
                    <input type="text" id="search-input" placeholder="Search transcript...">
                </div>
                <div id="search-results"></div>
            </div>
        </aside>

        <main id="transcript-pane">
            <div id="transcript-header">
                Tip: Click any sentence or highlight a range of text to cue and play the corresponding audio/video clip.
            </div>
            <div id="transcript-container">
                <div id="text-container">
                    {{TRANSCRIPT_HTML}}
                </div>
            </div>
        </main>
    </div>

    <script id="meeting-data" type="application/json">
{{MEETING_DATA_JSON}}
    </script>

    <script>
    (function() {
        const meetingData = JSON.parse(document.getElementById('meeting-data').textContent);
        const mediaUrl = meetingData.video_url || "";
        const playerWrapper = document.getElementById('player-wrapper');
        let mediaEl = document.getElementById('media-player');
        const timeRangeEl = document.getElementById('time-range');
        const playClipBtn = document.getElementById('play-clip-btn');
        const restartBtn = document.getElementById('restart-btn');
        const utterances = Array.from(document.querySelectorAll('.utterance'));

        let selStart = 0;
        let selEnd = 0;
        let clipMode = false;

        function fmtTime(sec) {
            sec = Math.max(0, Math.floor(sec || 0));
            const h = String(Math.floor(sec / 3600)).padStart(2, '0');
            const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
            const s = String(sec % 60).padStart(2, '0');
            return `${h}:${m}:${s}`;
        }

        // Configure media source (local audio/video or YouTube embed)
        const ytMatch = mediaUrl.match(/[?&]v=([^&]+)|youtu\\.be\\/([^?&]+)/);
        if (ytMatch) {
            const videoId = ytMatch[1] || ytMatch[2];
            playerWrapper.innerHTML = `<iframe id="yt-iframe" src="https://www.youtube.com/embed/${videoId}?enablejsapi=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
            mediaEl = null;
        } else if (mediaUrl) {
            mediaEl.src = mediaUrl;
        }

        function selectTimeWindow(startSec, endSec, autoPlay) {
            selStart = startSec;
            selEnd = endSec > startSec ? endSec : startSec + 15;
            timeRangeEl.textContent = `Clip: ${fmtTime(selStart)} - ${fmtTime(selEnd)}`;
            playClipBtn.disabled = false;

            utterances.forEach(u => {
                const t = parseFloat(u.dataset.startTime);
                if (t >= selStart && t < selEnd) u.classList.add('active-utterance');
                else u.classList.remove('active-utterance');
            });

            const firstMatch = utterances.find(u => parseFloat(u.dataset.startTime) >= selStart);
            if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

            if (mediaEl) {
                mediaEl.currentTime = selStart;
                if (autoPlay) {
                    clipMode = true;
                    mediaEl.play().catch(() => {});
                }
            } else {
                const ytIframe = document.getElementById('yt-iframe');
                if (ytIframe && ytIframe.contentWindow) {
                    ytIframe.contentWindow.postMessage(JSON.stringify({
                        event: 'command', func: 'seekTo', args: [selStart, true]
                    }), '*');
                    if (autoPlay) {
                        ytIframe.contentWindow.postMessage(JSON.stringify({
                            event: 'command', func: 'playVideo', args: []
                        }), '*');
                    }
                }
            }
        }

        if (mediaEl) {
            mediaEl.addEventListener('timeupdate', () => {
                if (clipMode && selEnd > selStart && mediaEl.currentTime >= selEnd) {
                    mediaEl.pause();
                    clipMode = false;
                }
            });
        }

        playClipBtn.addEventListener('click', () => selectTimeWindow(selStart, selEnd, true));
        restartBtn.addEventListener('click', () => {
            clipMode = false;
            if (mediaEl) { mediaEl.currentTime = 0; mediaEl.play().catch(() => {}); }
        });

        // Click or text-selection on utterances
        document.getElementById('text-container').addEventListener('mouseup', () => {
            const sel = window.getSelection();
            if (!sel.isCollapsed && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const startSpan = range.startContainer.parentElement.closest('.utterance');
                const endSpan = range.endContainer.parentElement.closest('.utterance');
                if (startSpan && endSpan) {
                    const s = parseFloat(startSpan.dataset.startTime);
                    const e = parseFloat(endSpan.dataset.endTime) || (parseFloat(endSpan.dataset.startTime) + 10);
                    selectTimeWindow(s, e, false);
                    return;
                }
            }
        });

        utterances.forEach((span, idx) => {
            span.addEventListener('click', () => {
                if (!window.getSelection().isCollapsed) return;
                const s = parseFloat(span.dataset.startTime);
                const nextSpan = utterances[idx + 1];
                const e = parseFloat(span.dataset.endTime) || (nextSpan ? parseFloat(nextSpan.dataset.startTime) : s + 10);
                selectTimeWindow(s, e, true);
            });
        });

        // Agenda links
        document.querySelectorAll('#agenda a').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const s = parseFloat(a.dataset.startTime || '0');
                const nextLi = a.closest('li')?.nextElementSibling;
                const nextA = nextLi ? nextLi.querySelector('a') : null;
                const end = nextA ? parseFloat(nextA.dataset.startTime) : s + 300;
                selectTimeWindow(s, end, true);
            });
        });

        // Tabs
        document.querySelectorAll('.pane-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pane-tab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Populate Speakers dropdown
        const speakerSelect = document.getElementById('speaker-select');
        const speakerResults = document.getElementById('speaker-results');
        const uniqueSpeakers = Array.from(new Set(
            (meetingData.speakers || []).map(s => s.speaker_name).filter(Boolean)
        )).sort();
        uniqueSpeakers.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            speakerSelect.appendChild(opt);
        });
        speakerSelect.addEventListener('change', () => {
            speakerResults.innerHTML = '';
            const target = speakerSelect.value;
            if (!target) return;
            document.querySelectorAll('#text-container p').forEach(p => {
                const strong = p.querySelector('strong');
                if (strong && strong.textContent.includes(target)) {
                    const pUtterances = p.querySelectorAll('.utterance');
                    if (pUtterances.length > 0) {
                        const s = parseFloat(pUtterances[0].dataset.startTime);
                        const lastU = pUtterances[pUtterances.length - 1];
                        const e = parseFloat(lastU.dataset.endTime) || ( parseFloat(lastU.dataset.startTime) + 10 );
                        const snippet = p.textContent.slice(0, 110) + '...';
                        const div = document.createElement('div');
                        div.className = 'search-result-item';
                        div.innerHTML = `<span class="search-time">${fmtTime(s)}</span>${snippet}`;
                        div.addEventListener('click', () => selectTimeWindow(s, e, true));
                        speakerResults.appendChild(div);
                    }
                }
            });
        });

        // Search input
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            searchResults.innerHTML = '';
            if (q.length < 2) return;
            let count = 0;
            for (const u of utterances) {
                if (u.textContent.toLowerCase().includes(q)) {
                    const s = parseFloat(u.dataset.startTime);
                    const e = parseFloat(u.dataset.endTime) || (s + 10);
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `<span class="search-time">${fmtTime(s)}</span>${u.textContent}`;
                    div.addEventListener('click', () => selectTimeWindow(s, e, true));
                    searchResults.appendChild(div);
                    if (++count >= 40) break;
                }
            }
        });

        // Toolbar buttons
        document.getElementById('print-btn').addEventListener('click', () => window.print());
        document.getElementById('download-txt-btn').addEventListener('click', () => {
            let txt = (meetingData.title || 'Transcript') + '\\n\\n';
            document.querySelectorAll('#text-container p').forEach(p => {
                txt += p.textContent.trim() + '\\n\\n';
            });
            const blob = new Blob([txt], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (meetingData.title || 'transcript') + '.txt';
            a.click();
        });

        // Handle URL query params (?startTime=...&endTime=...)
        const params = new URLSearchParams(window.location.search);
        if (params.has('startTime')) {
            const st = parseFloat(params.get('startTime'));
            const et = parseFloat(params.get('endTime') || (st + 30));
            setTimeout(() => selectTimeWindow(st, et, false), 300);
        }
    })();
    </script>
</body>
</html>
"""


def render_smart_transcript_html(
    deepgram_data: Dict[str, Any],
    structured_data: Optional[Dict[str, Any]],
    output_path: str,
    meeting_title: str = "SmartTranscript",
    media_url: str = "",
    jurisdiction: str = "",
    base_url: str = "http://localhost:8000",
    template_path: Optional[str] = None,
    standalone: bool = True,
    copy_assets: bool = False,
) -> str:
    """
    Generates an interactive HTML SmartTranscript file and writes it to `output_path`.

    Parameters:
        - `standalone=True` (default): Produces a single self-contained HTML file that works
          immediately in any browser (`file://` or HTTP) without external asset dependencies.
        - `standalone=False`: Uses `viewer_template.html` (or custom `template_path`) from the
          multi-meeting SmartTranscripts web suite, optionally copying `assets/` alongside the output.
    """
    if "results" in deepgram_data:
        dg_results = deepgram_data["results"]
    else:
        dg_results = deepgram_data

    paragraphs = (
        dg_results.get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("paragraphs", {})
        .get("paragraphs", [])
    )

    speakers = (structured_data or {}).get("speakers", [])
    agenda_items = (structured_data or {}).get("agenda_items", [])
    speaker_map, speaker_overrides = resolve_speaker_mappings(structured_data)

    agenda_html, transcript_html = build_transcript_and_agenda_fragments(
        paragraphs=paragraphs,
        agenda_items=agenda_items,
        speaker_map=speaker_map,
        speaker_overrides=speaker_overrides,
    )

    meeting_data_for_island = {
        "title": meeting_title,
        "video_url": media_url,
        "speakers": speakers,
    }

    if standalone and not template_path:
        template_content = STANDALONE_HTML_TEMPLATE
    else:
        resolved_tpl = Path(template_path) if template_path else (TEMPLATES_DIR / "viewer_template.html")
        with open(resolved_tpl, "r", encoding="utf-8") as f:
            template_content = f.read()

    jur_clean = jurisdiction.strip()
    jur_prefix = f"{jur_clean} " if jur_clean else ""
    og_description = (
        agenda_items[0].get("summary", "A SmartTranscript recording.")
        if agenda_items
        else "A SmartTranscript recording."
    )

    content = template_content
    content = content.replace("{{JURISDICTION}}", jur_clean)
    content = content.replace("{{BASE_URL}}", base_url)
    content = content.replace("{{PAGE_PATH}}", "")
    content = content.replace("{{PAGE_TITLE}}", jur_prefix + meeting_title)
    content = content.replace("{{OG_TITLE}}", jur_prefix + meeting_title)
    content = content.replace("{{OG_DESCRIPTION}}", og_description)
    content = content.replace("{{APP_TITLE}}", jur_prefix + "SmartTranscripts")
    content = content.replace("{{MEETING_TITLE}}", meeting_title)
    content = content.replace("{{AGENDA_HTML}}", agenda_html)
    content = content.replace("{{TRANSCRIPT_HTML}}", transcript_html)
    content = content.replace("{{MEETING_DATA_JSON}}", json.dumps(meeting_data_for_island, indent=2, ensure_ascii=False))

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(content)

    if (not standalone or copy_assets) and (TEMPLATES_DIR / "assets").is_dir():
        target_assets = out_file.parent / "assets"
        shutil.copytree(TEMPLATES_DIR / "assets", target_assets, dirs_exist_ok=True)

    logger.info(f"Generated HTML SmartTranscript -> {out_file}")
    return content
