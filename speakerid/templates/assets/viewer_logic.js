// San Francisco SmartTranscripts - Viewer Logic (Final Architecture)
// This script "hydrates" a static HTML page to make it interactive.

let selectionStartTime = 0;
let selectionEndTime = 0;
let textContainer = null;
// Global pointer to the active player (HTML5 video or YouTube)
window.activeVideoPlayer = null;

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function setupDraggableDivider() {
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('transcript-pane');
    const contentContainer = document.getElementById('content-container');

    const leftResizer = document.getElementById('resizer');
    const rightResizer = document.getElementById('resizer-right');

    if (!leftPane || !contentContainer || !rightPane) return;

    const savedLeftWidth = localStorage.getItem('testy_left_pane_width');
    const savedMiddleWidth = localStorage.getItem('testy_middle_pane_width');

    const playerControlsHeight = 76;
    const maxVideoHeight = window.innerHeight * 0.45;
    const maxMiddleWidth = (maxVideoHeight - playerControlsHeight) * (16 / 9);

    if (savedLeftWidth) {
        leftPane.style.width = `${savedLeftWidth}px`;
        leftPane.style.flex = `0 0 ${savedLeftWidth}px`;
        leftPane.style.minWidth = `${savedLeftWidth}px`;
    }

    if (savedMiddleWidth) {
        let validatedWidth = Math.min(parseFloat(savedMiddleWidth), maxMiddleWidth);
        validatedWidth = Math.max(300, validatedWidth);
        contentContainer.style.width = `${validatedWidth}px`;
        contentContainer.style.flex = `0 0 ${validatedWidth}px`;
        contentContainer.style.minWidth = `${validatedWidth}px`;
        rightPane.style.flex = `1`;
        rightPane.style.width = `auto`;
    } else {
        // By default, middle pane is no wider than needed for the video viewer 
        const startMiddleWidth = Math.max(300, maxMiddleWidth);
        contentContainer.style.width = `${startMiddleWidth}px`;
        contentContainer.style.flex = `0 0 ${startMiddleWidth}px`;
        rightPane.style.flex = `1`;
        rightPane.style.width = `auto`;
    }

    let isResizingLeft = false;
    let isResizingRight = false;

    if (leftResizer) {
        leftResizer.addEventListener('mousedown', (e) => {
            isResizingLeft = true;
            document.body.style.cursor = 'ew-resize';
            leftResizer.classList.add('resizing');
            document.body.classList.add('no-select');
        });
    }

    if (rightResizer) {
        rightResizer.addEventListener('mousedown', (e) => {
            isResizingRight = true;
            document.body.style.cursor = 'ew-resize';
            rightResizer.classList.add('resizing');
            document.body.classList.add('no-select');
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isResizingLeft && !isResizingRight) return;

        if (isResizingLeft) {
            const newWidth = Math.max(200, Math.min(e.clientX, 600));
            leftPane.style.width = `${newWidth}px`;
            leftPane.style.flex = `0 0 ${newWidth}px`;
        } else if (isResizingRight) {
            const leftPaneWidth = leftPane.getBoundingClientRect().width;
            const resizerWidth = leftResizer ? leftResizer.getBoundingClientRect().width : 10;

            const currentMaxMiddleWidth = (window.innerHeight * 0.45 - 76) * (16 / 9);
            const newWidth = Math.max(300, Math.min(e.clientX - leftPaneWidth - resizerWidth, window.innerWidth - leftPaneWidth - resizerWidth - 250, currentMaxMiddleWidth));

            contentContainer.style.width = `${newWidth}px`;
            contentContainer.style.flex = `0 0 ${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizingLeft || isResizingRight) {
            if (isResizingLeft) {
                localStorage.setItem('testy_left_pane_width', leftPane.getBoundingClientRect().width);
            }
            if (isResizingRight) {
                localStorage.setItem('testy_middle_pane_width', contentContainer.getBoundingClientRect().width);
            }

            isResizingLeft = false;
            isResizingRight = false;
            document.body.style.cursor = 'default';
            if (leftResizer) leftResizer.classList.remove('resizing');
            if (rightResizer) rightResizer.classList.remove('resizing');
            document.body.classList.remove('no-select');
        }
    });

    // ResizeObserver to keep the video pane at 16:9 based on middle pane's dynamic width
    const videoPane = document.getElementById('video-pane');
    if (videoPane) {
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const containerWidth = entry.contentRect.width;
                const windowHeight = window.innerHeight;
                const playerControlsHeight = 76;
                const targetVideoHeight = (containerWidth * (9 / 16)) + playerControlsHeight;
                const maxVideoHeight = windowHeight * 0.45; // slightly taller max to avoid tiny screens
                const finalVideoHeight = Math.min(targetVideoHeight, maxVideoHeight);
                videoPane.style.height = `${finalVideoHeight}px`;
            }
        });
        resizeObserver.observe(contentContainer);
    }
}

function setupDropdownMenus() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(menuItem => {
        const button = menuItem.querySelector('button');
        if (button && !button.dataset.listenerAttached) {
            button.dataset.listenerAttached = 'true';
            button.addEventListener('click', event => {
                event.stopPropagation();
                const isAlreadyOpen = menuItem.classList.contains('menu-open');
                document.querySelectorAll('.menu-item').forEach(item => {
                    item.classList.remove('menu-open');
                });
                if (!isAlreadyOpen) menuItem.classList.add('menu-open');
            });
        }
    });

    if (!window.dropdownCloseListenerAttached) {
        window.addEventListener('click', () => {
            document.querySelectorAll('.menu-item').forEach(item => {
                item.classList.remove('menu-open');
            });
        });
        window.dropdownCloseListenerAttached = true;
    }
}

function setupTabs() {
    const tabContainers = document.querySelectorAll('.pane-tabs');

    tabContainers.forEach(container => {
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('pane-tab')) {
                const targetTab = e.target.dataset.tab;
                if (!targetTab) return;

                // Remove active class from all tabs in this container
                container.querySelectorAll('.pane-tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                // Add active class to clicked tab
                e.target.classList.add('active');

                // Find the corresponding content pane
                // Assuming content panels share a parent container right below the tabs
                // We'll search for the closest pane-content or just globally match the ID
                const targetContentId = `${targetTab}-tab-content`;
                const targetContent = document.getElementById(targetContentId);

                if (targetContent) {
                    const contentContainer = targetContent.parentElement;
                    if (contentContainer) {
                        contentContainer.querySelectorAll('.tab-content').forEach(content => {
                            content.classList.remove('active');
                        });
                        targetContent.classList.add('active');
                    }
                }
            }
        });
    });
}

function updatePlayerForTime(startTimeParam, endTimeParam) {
    const tryUpdate = (retryCount = 0) => {
        const video = window.activeVideoPlayer || document.getElementById('videoElement');
        const allUtterances = Array.from(document.querySelectorAll('.utterance'));

        if (allUtterances.length === 0) {
            if (retryCount < 20) setTimeout(() => tryUpdate(retryCount + 1), 200);
            return;
        }

        const targetStartTime = parseFloat(startTimeParam);
        const targetEndTime = parseFloat(endTimeParam);
        const startSpan = allUtterances.slice().reverse().find(s => parseFloat(s.dataset.startTime) <= targetStartTime);

        if (startSpan) {
            const startSpanIndex = allUtterances.findIndex(s => s === startSpan);
            let endSpan;
            const nextSpanIndex = allUtterances.findIndex((s, index) => index >= startSpanIndex && parseFloat(s.dataset.startTime) > targetEndTime);

            if (nextSpanIndex !== -1) {
                endSpan = allUtterances[nextSpanIndex - 1];
                selectionEndTime = parseFloat(allUtterances[nextSpanIndex].dataset.startTime);
            } else {
                endSpan = allUtterances[allUtterances.length - 1];
                selectionEndTime = (video && video.duration) ? video.duration : (targetStartTime + 30);
            }

            if (endSpan) {
                selectionStartTime = parseFloat(startSpan.dataset.startTime);
                const timeRangeDisplay = document.getElementById('time-range');
                const playClipButton = document.getElementById('play-clip-button');

                if (timeRangeDisplay) timeRangeDisplay.textContent = `Clip: ${formatTime(selectionStartTime)} - ${formatTime(selectionEndTime)}`;
                if (playClipButton) playClipButton.disabled = false;

                const newRange = document.createRange();
                newRange.setStart(startSpan.firstChild, 0);
                newRange.setEnd(endSpan.lastChild, endSpan.lastChild.length);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(newRange);
                startSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });

                if (video && (typeof video.duration === 'number' || (video.player && typeof video.getCurrentTime === 'function'))) {
                    video.currentTime = selectionStartTime;
                    if (window.triggerSelectionOnboarding) window.triggerSelectionOnboarding();
                } else if (retryCount < 30) {
                    setTimeout(() => tryUpdate(retryCount + 1), 500);
                }
            }
        }
    };
    tryUpdate();
}

function updatePlayerForRange(range) {
    const video = window.activeVideoPlayer;
    const timeRangeDisplay = document.getElementById('time-range');
    const playClipButton = document.getElementById('play-clip-button');

    let startSpan = range.startContainer.parentElement.closest('.utterance');
    let endSpan = range.endContainer.parentElement.closest('.utterance');

    if (!startSpan) {
        const parentP = range.startContainer.parentElement.closest('p');
        if (parentP) startSpan = parentP.querySelector('.utterance');
    }
    if (!endSpan) {
        const parentP = range.endContainer.parentElement.closest('p');
        if (parentP) {
            const utterances = parentP.querySelectorAll('.utterance');
            if (utterances.length > 0) endSpan = utterances[utterances.length - 1];
        }
    }

    if (range.endOffset === 0 && endSpan && endSpan.previousElementSibling?.matches('.utterance')) {
        endSpan = endSpan.previousElementSibling;
    }

    if (startSpan && endSpan) {
        selectionStartTime = parseFloat(startSpan.dataset.startTime);
        const allUtterances = Array.from(document.querySelectorAll('.utterance'));
        const endSpanIndex = allUtterances.findIndex(span => span === endSpan);

        if (endSpanIndex !== -1 && endSpanIndex + 1 < allUtterances.length) {
            selectionEndTime = parseFloat(allUtterances[endSpanIndex + 1].dataset.startTime);
        } else {
            selectionEndTime = parseFloat(endSpan.dataset.endTime) || (video ? video.duration : 0);
        }

        if (video) video.currentTime = selectionStartTime;
        if (timeRangeDisplay) timeRangeDisplay.textContent = `Clip: ${formatTime(selectionStartTime)} - ${formatTime(selectionEndTime)}`;
        if (playClipButton) playClipButton.disabled = false;

        const newRange = document.createRange();
        newRange.setStart(startSpan.firstChild, 0);
        newRange.setEnd(endSpan.lastChild, endSpan.lastChild.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(newRange);

        if (window.triggerSelectionOnboarding) window.triggerSelectionOnboarding();
    }
}

// Fallback logic for clicking search results (similar to NYS)
function jumpToRange(startTimeParam, endTimeParam, delay = 0) {
    setTimeout(() => {
        const allUtterances = Array.from(document.querySelectorAll('.utterance'));
        if (allUtterances.length === 0) return;

        const videoElement = window.activeVideoPlayer;
        const timeRangeDisplay = document.getElementById('time-range');
        const playClipButton = document.getElementById('play-clip-button');

        const targetStartTime = parseFloat(startTimeParam);
        const targetEndTime = parseFloat(endTimeParam);

        const startSpan = allUtterances.slice().reverse()
            .find(s => parseFloat(s.dataset.startTime) <= targetStartTime);
        if (!startSpan) return;

        const startSpanIndex = allUtterances.findIndex(s => s === startSpan);

        let endSpan;
        const nextSpanIndex = allUtterances.findIndex(
            (s, index) => index >= startSpanIndex && parseFloat(s.dataset.startTime) > targetEndTime
        );

        selectionStartTime = parseFloat(startSpan.dataset.startTime);

        if (nextSpanIndex !== -1) {
            endSpan = allUtterances[nextSpanIndex - 1];
            selectionEndTime = parseFloat(allUtterances[nextSpanIndex].dataset.startTime);
        } else {
            endSpan = allUtterances[allUtterances.length - 1];
            selectionEndTime = (videoElement && typeof videoElement.duration === 'number') ? videoElement.duration : selectionStartTime + 30;
        }

        if (endSpan) {
            const nextSpanAfterEnd = allUtterances[allUtterances.findIndex(s => s === endSpan) + 1];
            if (nextSpanAfterEnd) {
                selectionEndTime = parseFloat(nextSpanAfterEnd.dataset.startTime);
            }

            if (timeRangeDisplay) {
                timeRangeDisplay.textContent = `Clip: ${formatTime(selectionStartTime)} - ${formatTime(selectionEndTime)}`;
            }
            if (playClipButton) playClipButton.disabled = false;
            if (videoElement && typeof videoElement.currentTime === 'number') videoElement.currentTime = selectionStartTime;

            const newRange = document.createRange();
            newRange.setStart(startSpan.firstChild, 0);
            newRange.setEnd(endSpan.lastChild, endSpan.lastChild.length);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(newRange);

            startSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, delay);
}

async function hydrateShell() {
    console.log("Hydrating Shell...");
    const styleLink = document.querySelector('link[href*="style.css"]');
    if (styleLink && !styleLink.href.includes('?v=')) {
        styleLink.href = '/assets/style.css?v=' + Date.now();
    }

    const dataIsland = document.getElementById('meeting-data');
    const meetingTitle = document.getElementById('meeting-title')?.textContent || "Untitled Meeting";

    // Extract Jurisdiction from the pre-hydrated DOM before we overwrite the body
    const appTitleElement = document.querySelector('header.page-header h1 a');
    let extractedJurisdiction = '';
    if (appTitleElement) {
        extractedJurisdiction = appTitleElement.textContent.replace(/SmartTranscripts.*/i, '').trim();
    }

    const agendaLinks = document.querySelector('#agenda ul')?.innerHTML || "";
    const transcriptHTML = document.getElementById('text-container')?.innerHTML || "";
    const meetingData = dataIsland ? JSON.parse(dataIsland.textContent) : null;

    if (!meetingData) return;

    try {
        const response = await fetch('/assets/viewer_shell.html?v=' + Date.now());
        const shellTemplate = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(shellTemplate, 'text/html');
        const shellBody = doc.body;

        const existingScripts = Array.from(document.body.querySelectorAll('script'));
        existingScripts.forEach(script => script.remove());

        document.body.innerHTML = shellBody.innerHTML;
        document.body.className = shellBody.className;

        const jurisdiction = extractedJurisdiction;

        // Populate new 3-tier header slots
        const globalJurisdictionSlot = document.getElementById('global-jurisdiction-name-slot');
        if (globalJurisdictionSlot) globalJurisdictionSlot.textContent = jurisdiction;

        const leftJurisdictionSlot = document.getElementById('left-column-jurisdiction-slot');
        if (leftJurisdictionSlot) leftJurisdictionSlot.textContent = jurisdiction;

        const rightMeetingSlot = document.getElementById('right-columns-meeting-slot');
        if (rightMeetingSlot) rightMeetingSlot.textContent = meetingTitle;

        // Legacy fallback
        const legacyMeetingTitleSlot = document.getElementById('meeting-title-slot');
        if (legacyMeetingTitleSlot) legacyMeetingTitleSlot.textContent = meetingTitle;
        if (document.getElementById('agenda-slot')) {
            document.getElementById('agenda-slot').innerHTML = `<ul>${agendaLinks}</ul>`;
        }
        if (document.getElementById('transcript-slot')) {
            document.getElementById('transcript-slot').innerHTML = transcriptHTML;
            // Ensure the overlay is correctly reparented or still visible
            const textContainer = document.getElementById('text-container');
            const overlay = document.getElementById('transcript-loading-overlay');
            if (textContainer && overlay && !textContainer.contains(overlay)) {
                 textContainer.insertBefore(overlay, textContainer.firstChild);
            }
        }

        const newDataIsland = document.createElement('script');
        newDataIsland.id = 'meeting-data';
        newDataIsland.type = 'application/json';
        newDataIsland.textContent = JSON.stringify(meetingData);
        document.body.appendChild(newDataIsland);

        existingScripts.forEach(script => {
            if (script.id !== 'meeting-data') document.body.appendChild(script);
        });

        const shellLinks = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
        shellLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href && !document.querySelector(`link[href="${href}"]`)) {
                const newLink = document.createElement('link');
                Array.from(link.attributes).forEach(attr => newLink.setAttribute(attr.name, attr.value));
                document.head.appendChild(newLink);
            }
        });

        const shellScripts = Array.from(doc.querySelectorAll('script'));
        shellScripts.forEach(shellScript => {
            const src = shellScript.getAttribute('src');
            if (src && document.querySelector(`script[src="${src}"]`)) return;

            const newScript = document.createElement('script');
            Array.from(shellScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.textContent = shellScript.textContent;
            if (shellScript.parentNode === doc.head) {
                document.head.appendChild(newScript);
            } else {
                document.body.appendChild(newScript);
            }
        });

        window.isShellHydrated = true;
    } catch (e) {
        console.error("Shell hydration failed:", e);
    }
}

async function initializeViewer() {
    console.log("Initializing Viewer...");
    if (!document.body.classList.contains('shell-active') && document.getElementById('meeting-data')) {
        await hydrateShell();
    }

    textContainer = document.getElementById('text-container') || document.getElementById('transcript-slot');

    try {
        const { initializeToc } = await import('./toc_viewer.js');
        if (typeof initializeToc === 'function') await initializeToc();
    } catch (e) {
        console.warn("viewer_logic: Could not load toc_viewer:", e);
    }

    if (!document.getElementById('onboarding-script')) {
        const script = document.createElement('script');
        script.id = 'onboarding-script';
        script.src = '/assets/onboarding.js?v=' + Date.now();
        script.defer = true;
        script.onload = () => {
            if (window.Onboarding) {
                setTimeout(() => window.Onboarding.checkFirstUse(), 100);
            }
        };
        document.body.appendChild(script);
    }

    const dataIsland = document.getElementById('meeting-data');
    if (dataIsland) {
        window.meetingData = JSON.parse(dataIsland.textContent);
    }

    buildMenusAndPlayer();
    setupDraggableDivider();
    setupTabs();
    setupSpeakersTab();

    try {
        const { initializeLinksPane } = await import('./links.js');
        const linksContainer = document.getElementById('links-container-slot');
        if (linksContainer && typeof initializeLinksPane === 'function') {
            const hasLinks = await initializeLinksPane(linksContainer);
            if (hasLinks) {
                const linksSection = document.getElementById('toc-links-section');
                if (linksSection) linksSection.style.display = 'block';
            }
        }
    } catch (e) {
        console.warn("viewer_logic: Could not load links.js:", e);
    }

    const contextualBtn = document.getElementById('contextual-search-button');
    const contextualInput = document.getElementById('contextual-search-input');
    if (contextualBtn && contextualInput) {
        contextualBtn.addEventListener('click', handleContextualSearch);
        contextualInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleContextualSearch(); });
    }

    const globalBtn = document.getElementById('global-search-button');
    const globalInput = document.getElementById('global-search-input');
    if (globalBtn && globalInput) {
        // Will be wired up in setupGlobalSearch after ToC is parsed
        setTimeout(() => setupGlobalSearch(), 100);
    }

    setupMenuAndModalListeners();
    handleUrlParameters();

    if (!window.meetingData) return;
    const videoUrl = window.meetingData.video_url;
    const isYouTube = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be');

    function extractYouTubeId(url) {
        const match = url.match(/[?&]v=([^&]+)|youtu\.be\/([^?&]+)/);
        return match ? (match[1] || match[2]) : null;
    }

    if (isYouTube) {
        const videoId = extractYouTubeId(videoUrl);
        document.body.classList.add('youtube-player-active');
        const hlsVideo = document.getElementById('videoElement');
        if (hlsVideo) hlsVideo.style.display = 'none';

        const wrapper = document.getElementById('player-wrapper');
        const targetId = 'playerContainer';
        if (wrapper) {
            wrapper.innerHTML = `<div id="${targetId}"></div>`;
            wrapper.style.display = 'block';
        }

        const initYT = () => {
            if (typeof VideoPlay === 'undefined') {
                setTimeout(initYT, 100);
                return;
            }
            const ytPlayer = new VideoPlay(videoId, targetId);
            ytPlayer.addEventListener('ready', () => {
                window.activeVideoPlayer = ytPlayer;
                setupInteractiveTranscript(ytPlayer);
                
                // Hide the loading overlay now that the API is ready to accept seek commands
                const overlay = document.getElementById('transcript-loading-overlay');
                if (overlay) overlay.style.display = 'none';
            });
        };
        initYT();
    } else {
        const videoElement = document.getElementById('videoElement');
        const wrapper = document.getElementById('player-wrapper');
        if (videoElement) {
            videoElement.style.display = 'block';
            if (wrapper) wrapper.style.display = 'block';
            window.activeVideoPlayer = videoElement;
            setupHlsPlayer(videoElement, window.meetingData.video_url);
            setupInteractiveTranscript(videoElement);
            
            // For HLS, we can dismiss it immediately after setup
            const overlay = document.getElementById('transcript-loading-overlay');
            if (overlay) overlay.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', initializeViewer);

let lastSearch = { query: "", startIndex: 0 };
let searchableTextMap = null;

function getSearchableTextMap() {
    if (searchableTextMap) return searchableTextMap;
    if (!textContainer) return null;

    let fullText = "";
    const map = [];
    const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement?.closest('.utterance') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    let node;
    while (node = walker.nextNode()) {
        const start = fullText.length;
        fullText += node.textContent;
        for (let i = start; i < fullText.length; i++) map[i] = { node, offset: i - start };
    }
    searchableTextMap = { fullText: fullText.toLowerCase(), map };
    return searchableTextMap;
}

function handleContextualSearch() {
    const input = document.getElementById('contextual-search-input');
    const slot = document.getElementById('contextual-search-results-slot');
    if (!input || !slot) return;

    const query = input.value.trim().toLowerCase();
    slot.innerHTML = '';
    if (!query) return;

    const textMap = getSearchableTextMap();
    if (!textMap) return;

    let idx = 0;
    const results = [];
    while ((idx = textMap.fullText.indexOf(query, idx)) !== -1) {
        const startPos = textMap.map[idx];
        const endPos = textMap.map[idx + query.length - 1];
        const utterance = textMap.map[idx].node.parentElement.closest('.utterance');

        if (utterance && startPos && endPos) {
            const startTime = parseFloat(utterance.dataset.startTime);
            const snippet = textMap.fullText.substring(Math.max(0, idx - 30), Math.min(textMap.fullText.length, idx + query.length + 30));
            results.push({ startTime, snippet: `...${snippet}...`, startPos, endPos });
        }
        idx += query.length;
        if (results.length >= 20) break;
    }

    if (results.length === 0) {
        slot.innerHTML = '<div class="search-no-results">No matches found.</div>';
    } else {
        results.forEach(res => {
            const div = document.createElement('div');
            div.className = 'search-results-item';
            div.innerHTML = `<span class="search-time">${formatTime(res.startTime)}</span>: <span class="search-snippet">${res.snippet}</span>`;
            div.addEventListener('click', () => {
                // Find nearest end utterance logic from the text Map offset
                let endUtterance = res.endPos.node.parentElement.closest('.utterance');
                if (!endUtterance) endUtterance = res.startPos.node.parentElement.closest('.utterance');

                let endTime = res.startTime;
                if (endUtterance) {
                    endTime = parseFloat(endUtterance.dataset.endTime) || parseFloat(endUtterance.dataset.startTime) || res.startTime;
                }

                jumpToRange(res.startTime, endTime);
            });
            slot.appendChild(div);
        });
    }
}

function setupGlobalSearch() {
    const globalBtn = document.getElementById('global-search-button');
    const globalInput = document.getElementById('global-search-input');
    const chamberFilter = document.getElementById('chamber-filter');
    const committeeFilter = document.getElementById('committee-filter');

    if (!globalBtn || !globalInput) return;

    // Parse ToC for filters using live DOM
    const rootList = document.querySelector('#toc-content-slot > ul.toc-list');
    const rootFolders = rootList ? rootList.querySelectorAll(':scope > li.toc-folder') : [];

    let hasChambers = false;
    const mockCommittees = {};

    rootFolders.forEach(folder => {
        const rawLabel = folder.querySelector('.toc-label')?.textContent?.trim() || "";
        if (!rawLabel || rawLabel === "Meetings of the Whole") return; // Skip virtual folders

        const folderValue = rawLabel.replace(/ /g, '_'); // Reconstruct exact S3 name

        const subFolders = folder.querySelectorAll(':scope > ul.nested > li.toc-folder');
        if (subFolders.length > 0) {
            hasChambers = true;
            mockCommittees[folderValue] = Array.from(subFolders)
                .map(sub => sub.querySelector('.toc-label')?.textContent?.trim() || "")
                .filter(Boolean)
                .map(lbl => lbl.replace(/ /g, '_'));
        } else {
            mockCommittees[folderValue] = [];
        }
    });

    if (hasChambers && chamberFilter && committeeFilter) {
        chamberFilter.innerHTML = '<option value="">Any Chamber</option>';
        Object.keys(mockCommittees).forEach(chamber => {
            const opt = document.createElement('option');
            opt.value = chamber;
            opt.textContent = chamber.replace(/_/g, ' ');
            chamberFilter.appendChild(opt);
        });

        chamberFilter.addEventListener('change', function () {
            committeeFilter.innerHTML = '<option value="" title="Any Committee">Any Committee</option>';
            if (this.value) {
                committeeFilter.disabled = false;
                const choices = mockCommittees[this.value] || [];
                choices.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c.replace(/_/g, ' ');
                    opt.title = opt.textContent;
                    committeeFilter.appendChild(opt);
                });
            } else {
                committeeFilter.disabled = true;
            }
        });
    } else if (chamberFilter && committeeFilter) {
        // Flat jurisdiction: hide chamber, promote committee
        chamberFilter.style.display = 'none';
        committeeFilter.disabled = false;
        committeeFilter.innerHTML = '<option value="" title="Any Committee">Any Committee</option>';
        Object.keys(mockCommittees).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c.replace(/_/g, ' ');
            opt.title = opt.textContent;
            committeeFilter.appendChild(opt);
        });
    }

    globalBtn.addEventListener('click', performVertexSearch);
    globalInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performVertexSearch(); });
}

function createDeepLink(rawLink, query, chamber, committee, sort, expandMeeting) {
    if (!rawLink || rawLink === '#') return '#';
    try {
        const url = new URL(rawLink, window.location.origin);
        url.searchParams.set('search', query);
        if (chamber) url.searchParams.set('chamber', chamber);
        if (committee) url.searchParams.set('committee', committee);
        if (sort && sort !== 'relevance') url.searchParams.set('sort', sort);
        if (expandMeeting) url.searchParams.set('expand_meeting', expandMeeting);
        const basePath = rawLink.split('?')[0].split('#')[0];
        return basePath + url.search + url.hash;
    } catch (e) {
        return rawLink;
    }
}

async function performVertexSearch() {
    const query = document.getElementById('global-search-input')?.value;
    const chamber = document.getElementById('chamber-filter')?.value;
    const committee = document.getElementById('committee-filter')?.value;
    const sort = document.getElementById('sort-filter')?.value;

    if (!query) return;

    const resultsList = document.getElementById('global-search-results-slot');
    const resultsInfo = document.getElementById('search-results-info');
    const loader = document.getElementById('search-loader');

    resultsList.innerHTML = '';
    resultsInfo.innerText = '';
    if (loader) loader.style.display = 'block';

    const jurisdictionElem = document.getElementById('global-jurisdiction-name-slot');
    const parsedJurisdiction = jurisdictionElem ? jurisdictionElem.textContent.toLowerCase() : "vermont";

    let finalCommittee = committee || undefined;
    if (finalCommittee === "Meetings_of_the_Whole" && !parsedJurisdiction.includes("new york")) {
        finalCommittee = "General";
    }

    const payload = {
        query,
        jurisdiction: parsedJurisdiction,
        chamber: chamber || undefined,
        committee: finalCommittee,
        sort,
        max_results: 100 // Fallback limit
    };

    let GCF_URL = '';

    try {
        const paramResponse = await fetch(`/assets/parameters.json?t=${Date.now()}`);
        if (!paramResponse.ok) throw new Error("Missing parameters structure.");
        const params = await paramResponse.json();

        if (params['gcf-address']) GCF_URL = params['gcf-address'];
        if (params['max_results']) payload.max_results = parseInt(params['max_results']);

        if (params['index-name']) {
            if (params['index-name'].includes(':')) {
                const parts = params['index-name'].split(':');
                payload.region = parts[0];
                payload.index_name = parts[1];
            } else {
                payload.index_name = params['index-name'];
            }
        }
    } catch (err) {
        if (loader) loader.style.display = 'none';
        resultsInfo.innerText = 'Search is temporarily unavailable.';
        console.warn('Parameter-driven execution aborted. Could not locate operational parameters.json.', err);
        return;
    }

    if (!GCF_URL) {
        if (loader) loader.style.display = 'none';
        resultsInfo.innerText = 'Search is temporarily unavailable.';
        return;
    }

    try {
        const response = await fetch(GCF_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': 'smart-search-2026'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (loader) loader.style.display = 'none';

        if (data.error) {
            resultsInfo.innerText = 'Error: ' + data.error;
            return;
        }

        const results = data.results || [];

        const meetings = {};
        for (const res of results) {
            if (!meetings[res.meeting_id]) {
                meetings[res.meeting_id] = { meta: res, snippets: [] };
            }
            meetings[res.meeting_id].snippets.push(res);
        }

        let sortedMeetingIds = Object.keys(meetings);
        sortedMeetingIds.sort((a, b) => {
            return results.findIndex(r => r.meeting_id === a) - results.findIndex(r => r.meeting_id === b);
        });

        resultsInfo.innerText = `Found ${results.length} matches across ${sortedMeetingIds.length} meetings`;

        const url = new URL(window.location);
        const expandMeetingId = url.searchParams.get('expand_meeting');
        if (expandMeetingId) {
            url.searchParams.delete('expand_meeting');
            window.history.replaceState({}, '', url);
        }

        sortedMeetingIds.forEach(mId => {
            const m = meetings[mId];
            const bestSnippet = m.snippets[0];

            m.snippets.sort((a, b) => a.timestamp - b.timestamp);
            const bestIdx = m.snippets.indexOf(bestSnippet);
            if (bestIdx > -1) {
                m.snippets.splice(bestIdx, 1);
                m.snippets.unshift(bestSnippet);
            }

            const card = document.createElement('div');
            if (expandMeetingId === m.meta.meeting_id) {
                card.className = 'meeting-result-card expanded';
            } else {
                card.className = 'meeting-result-card collapsed';
            }

            // Reconstruct accordion behavior manually avoiding innerHTML risks if event listeners are better
            // Or explicitly add Event listener to header:
            let dateTimeStr = '';
            const mtgIdMatch = m.meta.meeting_id.match(/(\d{4}[-_]\d{2}[-_]\d{2})(?:_(\d{2}-\d{2}))?/);
            if (mtgIdMatch) {
                let datePart = mtgIdMatch[1].replace(/_/g, '-');
                let timePart = mtgIdMatch[2];
                if (timePart && timePart !== '00-00') {
                    timePart = timePart.replace('-', ':');
                    dateTimeStr = `${datePart} @ ${timePart}`;
                } else {
                    dateTimeStr = datePart;
                }
            } else {
                dateTimeStr = m.meta.date || m.meta.meeting_id;
            }

            const headerHtml = `
                <div class="meeting-card-header">
                    <div class="accordion-caret">▶</div>
                    <div class="meeting-meta">
                        <h4 class="meeting-title">${m.meta.meeting_title || 'Unknown Meeting'}</h4>
                        <div class="meeting-date">${dateTimeStr} <span class="match-badge">${m.snippets.length} match${m.snippets.length > 1 ? 'es' : ''}</span></div>
                    </div>
                </div>
            `;
            card.innerHTML = headerHtml;
            const headerElem = card.querySelector('.meeting-card-header');
            headerElem.addEventListener('click', () => {
                if (card.classList.contains('collapsed')) {
                    card.classList.remove('collapsed');
                    card.classList.add('expanded');
                } else {
                    card.classList.remove('expanded');
                    card.classList.add('collapsed');
                }
            });

            const snippetsWrapper = document.createElement('div');
            snippetsWrapper.className = 'snippets-wrapper';

            m.snippets.forEach(s => {
                const finalLink = createDeepLink(s.deep_link, query, chamber, committee, sort, m.meta.meeting_id);
                const snipContainer = document.createElement('div');
                snipContainer.className = 'snippet-item';

                const agendaBadge = s.agenda_item ? `<span class="tag" style="background-color: #0f766e; color: #ccfbf1; border: 1px solid #14b8a6; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; vertical-align: middle; margin-right: 6px;">Item ${s.agenda_item}</span>` : '';

                snipContainer.innerHTML = `
                    <a href="${finalLink}">
                        <span class="snippet-time">${formatTime(s.timestamp)}</span>${agendaBadge}${s.snippet || 'No snippet available.'}
                    </a>
                `;
                snippetsWrapper.appendChild(snipContainer);
            });

            card.appendChild(snippetsWrapper);
            resultsList.appendChild(card);
        });

    } catch (err) {
        if (loader) loader.style.display = 'none';
        resultsInfo.innerText = 'Request failed.';
        console.error("Vertex query error:", err);
    }
}

function loadChoicesLibrary() {
    return new Promise((resolve, reject) => {
        if (window.Choices) return resolve();
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css';
        document.head.appendChild(css);
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Choices.js'));
        document.head.appendChild(script);
    });
}

async function setupSpeakersTab() {
    const slot = document.getElementById('speakers-slot');
    if (!slot || !window.meetingData?.speakers) return;

    slot.innerHTML = `
        <select id="speaker-dropdown" placeholder="Select or type a speaker...">
        </select>
        <div id="speaker-search-results-slot" class="search-results"></div>
    `;

    await loadChoicesLibrary();
    const dropdown = document.getElementById('speaker-dropdown');

    const speakers = Array.from(
        new Set(window.meetingData.speakers.map(s => s.speaker_name).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    for (const name of speakers) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        dropdown.appendChild(opt);
    }

    window.speakerChoices = new Choices(dropdown, {
        searchEnabled: true,
        placeholderValue: 'Select or type speaker...',
        itemSelectText: '',
        shouldSort: true,
        position: 'bottom'
    });

    dropdown.addEventListener('change', (e) => handleSpeakerSearch(e.target.value));
}

function handleSpeakerSearch(speakerName) {
    const slot = document.getElementById('speaker-search-results-slot');
    if (!slot) return;
    slot.innerHTML = '';

    if (!speakerName) return;

    const query = `[${speakerName}]`;
    const results = [];
    const paragraphs = textContainer.querySelectorAll('p');

    paragraphs.forEach(p => {
        const speaker = p.querySelector('strong');
        if (speaker && speaker.textContent.includes(speakerName)) {
            const utterances = p.querySelectorAll('.utterance');
            const firstUtterance = utterances[0];
            const lastUtterance = utterances[utterances.length - 1];

            if (firstUtterance && lastUtterance) {
                const startTime = parseFloat(firstUtterance.dataset.startTime);
                // Extract snippet, approx 80 characters
                let snippetText = "";
                for (let i = 0; i < utterances.length && snippetText.length < 80; i++) {
                    snippetText += utterances[i].textContent + " ";
                }
                if (snippetText.length > 80) snippetText = snippetText.substring(0, 80) + "...";

                results.push({ startTime, snippet: `${query}: ${snippetText}`, firstUtterance, lastUtterance });
            }
        }
    });

    if (results.length === 0) {
        slot.innerHTML = '<div class="search-no-results">No spoken lines found.</div>';
    } else {
        results.forEach(res => {
            const div = document.createElement('div');
            div.className = 'search-results-item';
            div.innerHTML = `<span class="search-time">${formatTime(res.startTime)}</span>: <span class="search-snippet">${res.snippet}</span>`;
            div.addEventListener('click', () => {
                let endTime = parseFloat(res.lastUtterance.dataset.endTime);
                if (isNaN(endTime)) {
                    endTime = parseFloat(res.lastUtterance.dataset.startTime);
                }
                jumpToRange(res.startTime, endTime);
            });
            slot.appendChild(div);
        });
    }
}

function setupHlsPlayer(video, url) {
    const isM3U8 = url.toLowerCase().split('?')[0].endsWith('.m3u8');
    if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
    } else {
        video.src = url;
    }
}

function generateTranscriptText() {
    let text = `${document.getElementById('meeting-title')?.textContent || ""}\n\n`;
    if (!textContainer) return text;
    textContainer.querySelectorAll('p').forEach(p => {
        const speaker = p.querySelector('strong');
        if (speaker) text += speaker.textContent + ' ';
        p.querySelectorAll('.utterance').forEach(u => { text += u.textContent; });
        text += '\n\n';
    });
    return text.trim();
}

function buildMenusAndPlayer() {
    const menuContainer = document.getElementById('viewer-menu');
    const videoContainer = document.getElementById('video-player-container');
    const playerWrapper = document.getElementById('player-wrapper');
    if (!menuContainer || !videoContainer || !playerWrapper) return;

    if (document.body.classList.contains('shell-active')) {
        if (!document.getElementById('videoElement')) {
            playerWrapper.innerHTML = '<video id="videoElement" style="display:none; width:100%; height:100%;"></video>';
        }
        buildShareButtons();
        setupDropdownMenus();
        return;
    }

    // Legacy Fallback
    menuContainer.innerHTML = `
        <div class="menu-item"><button>File</button>
            <ul class="dropdown-menu">
                <li id="print-button">Print Transcript</li>
                <li id="save-button">Download Transcript (.txt)</li>
            </ul>
        </div>
        <button id="share-button">Share</button>
        <button id="ai-analysis-button">AI Analysis</button>
        <button id="about-button">Help</button>
    `;
    videoContainer.innerHTML = `
        <div id="time-range">Select text to play a clip.</div>
        <div id="player-controls">
            <button id="play-clip-button" class="icon-button" disabled>Play</button>
            <button id="play-full-video-button" class="icon-button">Restart</button>
        </div>
        <div id="player-wrapper"><video id="videoElement" style="width:100%; height:100%;"></video></div>
    `;
}

function buildShareButtons() {
    const container = document.getElementById('share-buttons');
    if (!container) return;
    container.innerHTML = '';
    for (const [site, config] of Object.entries(shareTargets)) {
        const btn = document.createElement('button');
        btn.dataset.site = site;
        btn.innerHTML = `${config.svg}<span>${config.label}</span>`;
        container.appendChild(btn);
    }
}

const shareTargets = {
    email: { label: "Email", svg: `<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`, action: (url, sub) => `mailto:?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(url)}` },
    copy: { label: "Copy", svg: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`, action: (url, sub, btn) => { navigator.clipboard.writeText(url); return null; } },
    facebook: { label: "Facebook", svg: `<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m13 2h-2.5a3.5 3.5 0 0 0-3.5 3.5V11h-2v3h2v7h3v-7h3v-3h-3V8.5A1.5 1.5 0 0 1 15 7h3V5z"/></svg>`, action: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    x: { label: "X", svg: `<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`, action: (url, sub) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(sub)}` },
    linkedin: { label: "LinkedIn", svg: `<svg viewBox="0 0 24 24"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-11 4H5v11h3V7m-1.5-2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 2h-2.5c-2 0-2.5 1-2.5 2.5V11h3v3h-3v5h-3v-5H9v-3h2.5V9.5C11.5 7 13 6 15 6h2.5v3z"/></svg>`, action: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
    whatsapp: { label: "WhatsApp", svg: `<svg viewBox="0 0 24 24"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zM12.04 20.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31c-.82-1.31-1.26-2.83-1.26-4.38 0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24zm4.52-6.13c-.25-.12-1.47-.72-1.7-.81-.23-.09-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.06-.39-2.02-1.25-.75-.67-1.25-1.5-1.4-1.75-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.43s-.56-1.34-.76-1.84c-.2-.48-.41-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.88 2.4 1 2.56.12.17 1.76 2.67 4.25 3.73.59.25 1.05.41 1.41.52.6.19 1.14.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.05-.12-.2-.19-.44-.31z"/></svg>`, action: (url, sub) => `https://api.whatsapp.com/send?text=${encodeURIComponent(sub + ": " + url)}` }
};

function setupMenuAndModalListeners() {
    const agendaNav = document.getElementById('agenda-slot'); // Updated to use slot
    const shareModal = document.getElementById('share-modal');
    const closeModalBtns = document.querySelectorAll('.close-button');
    const shareButtons = document.getElementById('share-buttons');
    const printBtn = document.getElementById('print-button');
    const saveBtn = document.getElementById('save-button');
    const shareBtn = document.getElementById('share-button');
    const aiBtn = document.getElementById('ai-analysis-button');
    const aboutBtn = document.getElementById('about-button');
    const demoBtn = document.getElementById('demo-button');
    const contactBtn = document.getElementById('contact-button');

    closeModalBtns.forEach(btn => btn.addEventListener('click', () => {
        if (shareModal) shareModal.style.display = 'none';
        const aboutModal = document.getElementById('about-modal');
        if (aboutModal) aboutModal.style.display = 'none';
    }));

    const aboutOkBtn = document.getElementById('about-ok-button');
    if (aboutOkBtn) {
        aboutOkBtn.addEventListener('click', () => {
            const aboutModal = document.getElementById('about-modal');
            if (aboutModal) aboutModal.style.display = 'none';
        });
    }

    if (shareButtons) shareButtons.addEventListener('click', handleShare);

    if (demoBtn) {
        demoBtn.addEventListener('click', () => {
            if (typeof startTour === 'function') {
                startTour(true);
            } else {
                const css = document.createElement('link');
                css.rel = 'stylesheet';
                css.href = '/assets/tour.css';
                document.head.appendChild(css);
                const script = document.createElement('script');
                script.src = '/assets/tour.js?v=' + Date.now();
                script.onload = () => { if (typeof startTour === 'function') startTour(true); };
                document.body.appendChild(script);
            }
        });
    }

    if (contactBtn) {
        contactBtn.addEventListener('click', () => {
            window.location.href = 'mailto:contact@smarttranscripts.com';
        });
    }

    if (aboutBtn) {
        aboutBtn.addEventListener('click', () => {
            const modal = document.getElementById('about-modal');
            const content = document.getElementById('about-content');
            if (modal && content) {
                // Fetch the real about.html content like vermont does instead of hardcoding
                fetch('/about.html')
                    .then(response => {
                        if (!response.ok) throw new Error('Not found');
                        return response.text();
                    })
                    .then(html => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(html, 'text/html');
                        const bodyContent = doc.body.innerHTML;
                        content.innerHTML = `<div id="about-modal-content">${bodyContent}</div>`;
                        modal.style.display = 'flex';
                    })
                    .catch(err => {
                        content.innerHTML = `<h2>About SmartTranscripts</h2><p>Select text to play or share clips.</p>`;
                        modal.style.display = 'flex';
                    });
            }
        });
    }

    if (printBtn) printBtn.addEventListener('click', () => window.print());
    if (saveBtn) saveBtn.addEventListener('click', () => {
        const text = generateTranscriptText();
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${document.title}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const sel = window.getSelection();
            const isClip = !sel.isCollapsed && sel.rangeCount > 0;
            if (isClip) updatePlayerForRange(sel.getRangeAt(0));
            showShareModal(isClip);
        });
    }

    if (aiBtn) {
        aiBtn.addEventListener('click', () => {
            showAiAnalysisModal();
        });
    }

    const aiModal = document.getElementById('ai-analysis-modal');
    if (aiModal) {
        const closeBtns = aiModal.querySelectorAll('.ai-close');
        const cancelBtn = aiModal.querySelector('.ai-cancel-button');
        const goBtn = aiModal.querySelector('.ai-go-button');
        const backBtn = aiModal.querySelector('.ai-back-button');
        const proceedBtn = aiModal.querySelector('.ai-proceed-button');

        if (closeBtns) closeBtns.forEach(btn => btn.addEventListener('click', () => aiModal.style.display = 'none'));
        if (cancelBtn) cancelBtn.addEventListener('click', () => aiModal.style.display = 'none');
        if (goBtn) goBtn.addEventListener('click', handleAiAnalysisGo);
        if (backBtn) backBtn.addEventListener('click', () => {
            document.getElementById('ai-confirmation-view').style.display = 'none';
            document.getElementById('ai-selection-view').style.display = 'block';
        });
        if (proceedBtn) proceedBtn.addEventListener('click', executeAiAnalysis);
    }

    if (agendaNav) {
        agendaNav.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') {
                e.preventDefault();
                const video = window.activeVideoPlayer;
                const allUtterances = Array.from(document.querySelectorAll('.utterance'));
                const timeStringToSeconds = (s) => {
                    const p = s.split(':').map(Number);
                    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
                };

                const startTimeMatch = e.target.textContent.match(/\((\d{2}:\d{2}:\d{2})\)/);
                const startTime = startTimeMatch ? timeStringToSeconds(startTimeMatch[1]) : 0;

                const clickedLi = e.target.closest('li');
                let endTime = video ? video.duration : 0;
                const nextLi = clickedLi?.nextElementSibling;
                if (nextLi) {
                    const nextMatch = nextLi.querySelector('a')?.textContent.match(/\((\d{2}:\d{2}:\d{2})\)/);
                    if (nextMatch) endTime = timeStringToSeconds(nextMatch[1]);
                }

                const span = allUtterances.find(s => parseFloat(s.dataset.startTime) >= startTime);
                if (span) {
                    jumpToRange(startTime, endTime);
                }
            }
        });
    }
}

function showShareModal(isClip) {
    const modal = document.getElementById('share-modal');
    const options = document.getElementById('share-clip-options');
    const checkbox = document.getElementById('share-clip-checkbox');
    const range = document.getElementById('share-time-range');

    if (isClip && options && checkbox && range) {
        options.style.display = 'block';
        checkbox.checked = true;
        range.textContent = `(${formatTime(selectionStartTime)} - ${formatTime(selectionEndTime)})`;
    } else if (options) {
        options.style.display = 'none';
        if (checkbox) checkbox.checked = false;
    }
    if (modal) modal.style.display = 'flex';
}

function handleShare(e) {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.site || !shareTargets[btn.dataset.site]) return;
    let url = window.location.href.split('?')[0];
    if (document.getElementById('share-clip-checkbox')?.checked) {
        url += `?startTime=${selectionStartTime}&endTime=${selectionEndTime}`;
    }
    const target = shareTargets[btn.dataset.site].action(url, document.title, btn);
    if (target) window.open(target, '_blank');
    if (btn.dataset.site !== 'copy') document.getElementById('share-modal').style.display = 'none';
}

function handleUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const start = params.get('startTime');
    const end = params.get('endTime');
    const agenda = params.get('agenda');
    const search = params.get('search');
    const q = params.get('q'); // Local contextual search query
    const speakerParam = params.get('speaker') || params.get('sp');

    if (q) {
        // Focus contextual search tab
        const middleTabs = document.querySelectorAll('#middle-nav-tabs .pane-tab');
        const contextualTabBtn = document.querySelector('#middle-nav-tabs .pane-tab[data-tab="contextual-search"]');
        if (contextualTabBtn && middleTabs) {
            middleTabs.forEach(t => t.classList.remove('active'));
            contextualTabBtn.classList.add('active');
        }

        document.querySelectorAll('#middle-pane-content .tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === 'contextual-search-tab-content') content.classList.add('active');
        });

        // Trigger contextual search after UI parsing completes
        setTimeout(() => {
            const contextualInput = document.getElementById('contextual-search-input');
            if (contextualInput) {
                contextualInput.value = q;
                if (typeof handleContextualSearch === 'function') {
                    handleContextualSearch();
                }
            }
        }, 500);
    } else if (speakerParam) {
        const speakerName = decodeURIComponent(speakerParam).trim();

        // Focus speakers tab
        const middleTabs = document.querySelectorAll('#middle-nav-tabs .pane-tab');
        const speakerTabBtn = document.querySelector('#middle-nav-tabs .pane-tab[data-tab="speakers"]');
        if (speakerTabBtn && middleTabs) {
            middleTabs.forEach(t => t.classList.remove('active'));
            speakerTabBtn.classList.add('active');
        }

        document.querySelectorAll('#middle-pane-content .tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === 'speakers-tab-content') content.classList.add('active');
        });

        // Trigger speaker search after UI parsing completes
        setTimeout(() => {
            const dropdown = document.getElementById('speaker-dropdown');
            if (dropdown && window.speakerChoices) {
                const searchStr = speakerName.toLowerCase();
                
                // Find all options that loosely match the speaker parameter
                const matchedOptions = Array.from(dropdown.options).filter(opt => 
                    opt.value.toLowerCase().includes(searchStr)
                );
                
                if (matchedOptions.length === 1) {
                    // Exactly one match: select it and search
                    window.speakerChoices.setChoiceByValue(matchedOptions[0].value);
                    if (typeof handleSpeakerSearch === 'function') {
                        handleSpeakerSearch(matchedOptions[0].value);
                        // Automatically select the first spoken clip
                        setTimeout(() => {
                            const firstResult = document.querySelector('#speaker-search-results-slot .search-results-item');
                            if (firstResult) firstResult.click();
                        }, 50);
                    }
                } else {
                    // Multiple matches or zero matches:
                    // Open the dropdown and populate the search field so the user can choose
                    window.speakerChoices.showDropdown();
                    const choicesInput = dropdown.parentNode.querySelector('.choices__input--cloned');
                    if (choicesInput) {
                        choicesInput.value = speakerName;
                        // Dispatch input event to trigger Choices.js filtering
                        choicesInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            }
        }, 500);
    }

    if (search) {
        const chamber = params.get('chamber');
        const committee = params.get('committee');
        const sort = params.get('sort');

        // Focus search tab
        const tabs = document.querySelectorAll('#left-nav-tabs .pane-tab');
        const searchTabBtn = document.querySelector('#left-nav-tabs .pane-tab[data-tab="global-search"]');
        if (searchTabBtn && tabs) {
            tabs.forEach(t => t.classList.remove('active'));
            searchTabBtn.classList.add('active');
        }

        document.querySelectorAll('#left-pane .tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === 'global-search-tab-content') content.classList.add('active');
        });

        // Trigger search after UI parsing completes
        setTimeout(() => {
            const searchInput = document.getElementById('global-search-input');
            const chamberFilter = document.getElementById('chamber-filter');
            const committeeFilter = document.getElementById('committee-filter');
            const sortFilter = document.getElementById('sort-filter');
            const searchBtn = document.getElementById('global-search-button');

            if (searchInput) searchInput.value = search;

            if (chamberFilter && chamber) {
                const opt = chamberFilter.querySelector(`option[value="${chamber}"]`);
                if (opt) {
                    chamberFilter.value = chamber;
                    chamberFilter.dispatchEvent(new Event('change'));
                }
            }
            if (committeeFilter && committee) {
                const opt = committeeFilter.querySelector(`option[value="${committee}"]`);
                if (opt) committeeFilter.value = committee;
            }
            if (sortFilter && sort) {
                const opt = sortFilter.querySelector(`option[value="${sort}"]`);
                if (opt) sortFilter.value = sort;
            }

            if (searchBtn) searchBtn.click();
        }, 500); // Wait for TOC population
    }

    if (agenda) {
        setTimeout(() => {
            const link = document.querySelector(`#agenda-slot a[href="#${agenda}"]`);
            if (link) link.click();
        }, 100);
    } else if (start && end) {
        updatePlayerForTime(start, end);
    }
}

function setupInteractiveTranscript(video) {
    if (!textContainer) return;
    const playClipBtn = document.getElementById('play-clip-button');
    const playFullBtn = document.getElementById('play-full-video-button');
    let clipPlaying = false;

    textContainer.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        if (!sel.isCollapsed) {
            updatePlayerForRange(sel.getRangeAt(0));
        }
    });

    document.addEventListener('selectionchange', () => {
        const btn = document.getElementById('share-button');
        const isCollapsed = window.getSelection().isCollapsed;
        if (btn) btn.textContent = isCollapsed ? 'Share Transcript' : 'Share Clip';
    });

    if (playClipBtn) {
        playClipBtn.addEventListener('click', () => {
            if (video.paused) {
                video.currentTime = selectionStartTime;
                video.play();
            } else {
                video.pause();
            }
        });
    }

    if (playFullBtn) {
        playFullBtn.addEventListener('click', () => {
            if (video) {
                video.currentTime = 0;
                video.play();
            }
        });
    }

    video.addEventListener('timeupdate', () => {
        if (clipPlaying && video.currentTime >= selectionEndTime) video.pause();
    });

    function togglePlayIcon(isPlaying) {
        const playD = "M8 5v14l11-7z";
        const pauseD = "M6 19h4V5H6v14zm8-14v14h4V5h-4z";
        const targetD = isPlaying ? pauseD : playD;

        const clipPath = playClipBtn?.querySelector('path');
        if (clipPath) clipPath.setAttribute('d', targetD);

        // Update titles for accessibility / tooltips
        if (playClipBtn) playClipBtn.title = isPlaying ? "Pause Clip" : "Play Clip";
    }

    video.addEventListener('play', () => {
        clipPlaying = true;
        togglePlayIcon(true);
    });
    video.addEventListener('pause', () => {
        clipPlaying = false;
        togglePlayIcon(false);
    });
}

function showAiAnalysisModal() {
    const modal = document.getElementById('ai-analysis-modal');
    if (modal) {
        document.getElementById('ai-confirmation-view').style.display = 'none';
        document.getElementById('ai-selection-view').style.display = 'block';
        modal.style.display = 'flex';
    }
}

function handleAiAnalysisGo() {
    const service = document.querySelector('input[name="ai-service"]:checked')?.value;
    if (!service) return;
    if (service === 'grok') { executeAiAnalysis(); }
    else {
        document.getElementById('ai-confirm-title').textContent = `${service} Analysis`;
        document.getElementById('ai-confirm-message').textContent = `Paste the clipboard URL into ${service} when it opens.`;
        document.getElementById('ai-selection-view').style.display = 'none';
        document.getElementById('ai-confirmation-view').style.display = 'block';
    }
}

function executeAiAnalysis() {
    const service = document.querySelector('input[name="ai-service"]:checked').value;
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        let target = '';
        if (service === 'chatgpt') target = 'https://chatgpt.com/g/g-69596c172990819192d032c66b67a03a-smarttranscript-analyzer';
        else if (service === 'gemini') target = 'https://gemini.google.com';
        else if (service === 'grok') target = `https://grok.com?q=${encodeURIComponent(url)}`;
        if (target) window.open(target, '_blank');
        document.getElementById('ai-analysis-modal').style.display = 'none';
    });
}
