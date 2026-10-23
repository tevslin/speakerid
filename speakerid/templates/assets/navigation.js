const textContainer = document.getElementById('text-container');
let searchableTextMap = null;

// --- Dynamically load Choices.js if not already loaded ---
function loadChoicesLibrary() {
  return new Promise((resolve, reject) => {
    // If already loaded, resolve immediately
    if (window.Choices) {
      resolve();
      return;
    }

    // Load CSS
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css';
    document.head.appendChild(css);

    // Load JS
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Choices.js'));
    document.head.appendChild(script);
  });
}

function runTour(forceRun = false) {
  let skipFlag = false;
  try {
    skipFlag = localStorage.getItem('smartTourSkip') === '1';
  } catch (e) {
    // Ignore
  }
  if (!forceRun && skipFlag) {
    console.log('Tour skipped by flag.');
    return;
  }
  startTour(forceRun)

}




function initializeNavigationPane() {
  const agendaPane = document.getElementById('agenda');
  if (!agendaPane) {
    console.error("Original agenda pane not found. Cannot build navigation.");
    return;
  }

  const redundantAgendaTitle = agendaPane.querySelector('h3');
  if (redundantAgendaTitle) {
    redundantAgendaTitle.remove();
  }

  const navHeader = document.createElement('div');
  navHeader.className = 'nav-header';
  navHeader.innerHTML = `
        <h3>Navigation</h3>
        <div class="nav-tabs">
            <button class="nav-tab-button active" data-mode="agenda">Agenda</button>
            <button class="nav-tab-button" data-mode="text">Text</button>
            <button class="nav-tab-button" data-mode="speaker">Speaker</button>
        </div>
    `;

  const agendaContent = document.createElement('div');
  agendaContent.className = 'nav-tab-content active';
  agendaContent.dataset.mode = 'agenda';
  while (agendaPane.firstChild) {
    agendaContent.appendChild(agendaPane.firstChild);
  }

  const textContent = document.createElement('div');
  textContent.className = 'nav-tab-content';
  textContent.dataset.mode = 'text';
  textContent.innerHTML = `
        <input type="text" id="text-search-input" placeholder="Search transcript...">
        <button id="text-search-button">Search</button>
		<div class="search-results"></div>
    `;

  const searchButton = textContent.querySelector("#text-search-button");
  const textSearchInput = textContent.querySelector("#text-search-input");
  searchButton.addEventListener("click", (e) => {
    e.preventDefault();
    const query = textContent.querySelector("#text-search-input").value.trim();
    if (!query) return;
    runSearch(query);   // your existing search function
  });
  textSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = textContent.querySelector("#text-search-input").value.trim();
      if (!query) return;
      runSearch(query);   // your existing search function
    }
  });

  agendaPane.prepend(navHeader);
  agendaPane.appendChild(agendaContent);
  agendaPane.appendChild(textContent);

  const navTabs = navHeader.querySelector('.nav-tabs');
  navTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('nav-tab-button')) {
      const mode = e.target.dataset.mode;

      navTabs.querySelectorAll('.nav-tab-button').forEach(button => button.classList.remove('active'));
      e.target.classList.add('active');

      agendaPane.querySelectorAll('.nav-tab-content').forEach(content => {
        if (content.dataset.mode === mode) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    }
  });
  // --- Navigation boot logic: initialize speaker tab, then handle URL params ---
  (async () => {
    // Wait for the speaker tab and its Choices.js dependency to be ready
    await initializeSpeakerTab();

    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const qParam = urlParams.get('q');
    const speakerParam = urlParams.get('sp') || urlParams.get('speaker');

    if (qParam) {
      // --- TEXT MODE SEARCH ---
      const query = decodeURIComponent(qParam).trim();

      // 1️⃣ Activate Text mode
      const textTabButton = document.querySelector('.nav-tab-button[data-mode="text"]');
      if (textTabButton) textTabButton.click();

      // 2️⃣ Optionally populate any visible text search input
      const searchInput = document.querySelector('.search-input, #search-input');
      if (searchInput) searchInput.value = query;

      // 3️⃣ Run the search
      if (typeof runSearch === 'function') {
        runSearch(query, 'text');
      } else {
        console.warn('runSearch() not available when handling ?q=');
      }

    } else if (speakerParam) {
      // --- SPEAKER MODE SEARCH ---
      const speakerName = decodeURIComponent(speakerParam).trim();

      // 1️⃣ Switch to Speaker mode
      const speakerTabButton = document.querySelector('.nav-tab-button[data-mode="speaker"]');
      if (speakerTabButton) speakerTabButton.click();

      // 2️⃣ Attempt to select the speaker in the dropdown
      const dropdown = document.getElementById('speaker-dropdown');
      if (dropdown) {
        const match = Array.from(dropdown.options).find(opt => opt.value === speakerName);
        if (match) {
          dropdown.value = speakerName;
          dropdown.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (typeof runSpeakerSearch === 'function') {
          runSpeakerSearch(speakerName); // fallback diagnostic
        }
      } else {
        console.warn('Speaker dropdown not found when handling ?speaker=');
      }
    }

    // No URL params → normal UI flow
  })();


  // --- Add Help menu (Demo + About + Contact) if viewer_logic has already built menus ---
  (function addHelpMenu() {
    const menuContainer = document.getElementById('viewer-menu');
    if (!menuContainer) return; // nothing to do if no menus exist

    // --- 1️⃣ Create Help dropdown identical to other menus ---
    const helpMenu = document.createElement('div');
    helpMenu.className = 'menu-item';
    helpMenu.innerHTML = `
    <button>Help</button>
    <ul class="dropdown-menu">
      <li id="demo-button">Tutorial</li>
      <li id="about-button">About</li>
      <li id="contact-button">Contact&nbsp;Us</li>
    </ul>
  `;

    // --- 2️⃣ Append it after any existing menus built by viewer_logic.js ---
    menuContainer.appendChild(helpMenu);

    // --- 3️⃣ Re-run dropdown setup so this menu behaves like the others ---
    if (typeof setupDropdownMenus === 'function') {
      setupDropdownMenus();
    } else {
      setTimeout(() => {
        if (typeof setupDropdownMenus === 'function') setupDropdownMenus();
      }, 500);
    }

    // --- Optional Guided Tour Loader ---
    (function loadGuidedTourIfEligible() {
      const hasParams = window.location.search.length > 0;
      let hasSeenTour = false;
      try {
        hasSeenTour = localStorage.getItem('smartTourSkip') === '1';
      } catch (e) {
        // Ignore
      }
      document.querySelectorAll('.tour-tip, .tour-backdrop').forEach(el => el.remove());

      if (hasSeenTour) return;

      if (hasParams) {
        // If Deep Link, Onboarding Popups (Play/Share) take precedence over Welcome Dialog.
        // Only show Welcome if user has already seen the selection popups.
        const playSeen = localStorage.getItem('smartTranscript_playOnboardingSeen');
        const shareSeen = localStorage.getItem('smartTranscript_shareOnboardingSeen');

        if (!playSeen || !shareSeen) return;
      }

      runTour();
    })();

    // --- 4️⃣ Button handlers ---
    const demoButton = helpMenu.querySelector('#demo-button');
    if (demoButton) {
      demoButton.addEventListener('click', () => {
        if (typeof runTour === 'function') runTour(true);
        else console.warn('runTour() is not defined yet.');
      });
    }

    const aboutButton = helpMenu.querySelector('#about-button');
    if (aboutButton) {
      aboutButton.addEventListener('click', () => showAboutModal());
    }

    const contactButton = helpMenu.querySelector('#contact-button');
    if (contactButton) {
      contactButton.addEventListener('click', () => {
        window.location.href = 'mailto:contact@goldendomevt.com';
      });
    }
  })();




  function showAboutModal() {
    let aboutModal = document.getElementById('about-modal');
    if (!aboutModal) {
      aboutModal = document.createElement('div');
      aboutModal.id = 'about-modal';
      aboutModal.className = 'modal';
      document.body.appendChild(aboutModal);
    }

    fetch('/about.html')
      .then(response => response.text())
      .then(html => {
        // Parse the HTML to extract only the body content
        // This prevents <style> tags in head from leaking into the main page
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const bodyContent = doc.body.innerHTML;

        aboutModal.innerHTML = `
				<div class="modal-content">
					<div id="about-modal-content">${bodyContent}</div>
					<div class="modal-footer">
						<button id="about-ok-button">OK</button>
					</div>
				</div>
			`;
        aboutModal.style.display = 'block';

        document.getElementById('about-ok-button').addEventListener('click', () => {
          aboutModal.style.display = 'none';
        });
      })
      .catch(error => console.error('Error fetching about.html:', error));
  }
}
// New runSearch in navigation.js
function getSearchableTextMap() {
  if (searchableTextMap) return searchableTextMap;

  let fullText = "";
  const map = []; // Maps character index to its corresponding text node
  const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_TEXT);

  let node;
  while (node = walker.nextNode()) {
    const start = fullText.length;
    fullText += node.textContent;
    for (let i = start; i < fullText.length; i++) {
      map[i] = { node: node, offset: i - start };
    }
  }
  searchableTextMap = { fullText: fullText.toLowerCase(), map };
  return searchableTextMap;
}

function normalizeText(str) {
  return str.trim().toLowerCase().replace(/\s+/g, " ");
}

// === PATCH: text search results now clickable with jumpToRange ===

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSpeakerForElement(el) {
  const root = document.getElementById('text-container');
  let node = el;
  while (node && node !== root) {
    let sib = node.previousSibling;
    while (sib) {
      const txt = sib.textContent || "";
      const matches = txt.match(/\[[^\]]+\]/g);
      if (matches && matches.length) {
        const last = matches[matches.length - 1];
        return last.slice(1, -1);
      }
      sib = sib.previousSibling;
    }
    node = node.parentNode;
  }
  return "Unknown";
}

function getAllUtterances() {
  return Array.from(document.querySelectorAll('.utterance'));
}

function runSearch(query) {
  if (!query) return;

  const { fullText, map } = getSearchableTextMap();
  const lowerCaseQuery = query.trim().toLowerCase();

  const results = [];
  let searchIndex = 0;

  while (true) {
    const foundIndex = fullText.indexOf(lowerCaseQuery, searchIndex);
    if (foundIndex === -1) break;
    const endIndex = foundIndex + lowerCaseQuery.length;

    const entry = map[foundIndex];
    if (!entry) break;
    const utterance = entry.node.parentElement.closest('.utterance');
    if (!utterance) {
      searchIndex = endIndex;
      continue;
    }

    let speaker = findSpeakerForElement(utterance);

    const hitUtterances = [];
    let current = utterance;
    while (current) {
      const uttText = current.textContent;
      if (uttText.toLowerCase().includes(lowerCaseQuery)) {
        hitUtterances.push(current);
        current = current.nextElementSibling && current.nextElementSibling.classList.contains("utterance")
          ? current.nextElementSibling
          : null;
      } else {
        break;
      }
    }

    const allUtts = getAllUtterances();
    const firstUtt = hitUtterances[0];
    const lastUtt = hitUtterances[hitUtterances.length - 1];

    const startTime = Math.floor(parseFloat(firstUtt.dataset.startTime));
    let endTime;
    if (lastUtt.dataset.endTime) {
      endTime = Math.ceil(parseFloat(lastUtt.dataset.endTime));
    } else {
      const lastIdx = allUtts.indexOf(lastUtt);
      if (lastIdx !== -1 && lastIdx + 1 < allUtts.length) {
        endTime = Math.ceil(parseFloat(allUtts[lastIdx + 1].dataset.startTime));
      } else {
        const video = document.getElementById('videoElement');
        endTime = (video && !Number.isNaN(video.duration)) ? Math.ceil(video.duration) : startTime;
      }
    }

    const phraseRe = new RegExp(escapeRegExp(lowerCaseQuery), 'gi');
    const snippet = `[${speaker}] ` + hitUtterances
      .map(u => u.textContent.replace(phraseRe, '<b>$&</b>'))
      .join(' ');

    results.push({
      snippet,
      start: startTime,
      end: endTime,
      utterances: hitUtterances
    });

    searchIndex = foundIndex + 1;
  }

  renderSearchResults(results, query);
}

// === New helper: jumpToRange ===
function jumpToRange(startTimeParam, endTimeParam, delay = 0) {
  setTimeout(() => {
    const allUtterances = Array.from(document.querySelectorAll('.utterance'));
    if (allUtterances.length === 0) return;

    const videoElement = document.getElementById('videoElement');
    const timeRangeDisplay = document.getElementById('time-range');
    const playClipButton = document.getElementById('play-clip-button');

    const targetStartTime = Math.floor(parseFloat(startTimeParam));
    const targetEndTime = Math.ceil(parseFloat(endTimeParam));

    const startSpan = allUtterances.slice().reverse()
      .find(s => parseFloat(s.dataset.startTime) <= targetStartTime);
    if (!startSpan) return;

    const startSpanIndex = allUtterances.findIndex(s => s === startSpan);

    let endSpan;
    const nextSpanIndex = allUtterances.findIndex(
      (s, index) => index >= startSpanIndex && parseFloat(s.dataset.startTime) > targetEndTime
    );

    let selectionStartTime = parseFloat(startSpan.dataset.startTime);
    let selectionEndTime;

    if (nextSpanIndex !== -1) {
      endSpan = allUtterances[nextSpanIndex - 1];
      selectionEndTime = parseFloat(allUtterances[nextSpanIndex].dataset.startTime);
    } else {
      endSpan = allUtterances[allUtterances.length - 1];
      selectionEndTime = videoElement.duration;
    }

    if (endSpan) {
      const nextSpanAfterEnd = allUtterances[allUtterances.findIndex(s => s === endSpan) + 1];
      if (nextSpanAfterEnd) {
        selectionEndTime = parseFloat(nextSpanAfterEnd.dataset.startTime);
      } else {
        selectionEndTime = videoElement.duration;
      }

      if (timeRangeDisplay) {
        timeRangeDisplay.textContent = `Clip: ${formatTime(selectionStartTime)} - ${formatTime(selectionEndTime)}`;
      }
      if (playClipButton) playClipButton.disabled = false;
      if (videoElement) videoElement.currentTime = selectionStartTime;

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

function renderSearchResults(results, query) {
  const container = document.querySelector('.search-results');
  if (!container) return;

  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = `<p>No results found for "<b>${query}</b>"</p>`;
    return;
  }

  const ul = document.createElement('ul');
  results.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `${r.snippet} <span class="timecode">(${r.start}–${r.end}s)</span>`;
    li.dataset.start = r.start;
    li.dataset.end = r.end;

    // 🔹 Clickable: jump to transcript/video range
    li.addEventListener('click', () => {
      jumpToRange(r.start, r.end);
    });

    ul.appendChild(li);
  });
  container.appendChild(ul);
}
// === Unified Search Logic using updatePlayerForRange ===
// Both text and speaker searches now store startPos/endPos and call updatePlayerForRange(range)
// Time ranges are displayed using nearest utterance timestamps for user readability.

function buildSpeakerDropdown() {
  const dropdown = document.getElementById('speaker-dropdown');
  if (!dropdown || !window.meetingData?.speakers) return;

  // Clear existing
  dropdown.innerHTML = '<option value="">Select speaker...</option>';

  const speakers = Array.from(
    new Set(meetingData.speakers.map(s => s.speaker_name).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  for (const name of speakers) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    dropdown.appendChild(opt);
  }

  // Initialize Choices.js if not already applied
  if (!dropdown.classList.contains('choices__input')) {
    window.speakerChoices = new Choices(dropdown, {
      searchEnabled: true,
      placeholderValue: 'Select or type speaker...',
      searchPlaceholderValue: 'Search speakers...',
      itemSelectText: '',
      shouldSort: true,
      allowHTML: true,
      duplicateItemsAllowed: false,
      fuseOptions: { threshold: 0.4 }, // fuzzy match
    });

    dropdown.addEventListener('change', e => runSpeakerSearch(e.target.value));
  }
}


function runSpeakerSearch(speakerName) {
  if (!speakerName) return;

  // --- Update the visible selection in the Choices.js dropdown ---
  if (window.speakerChoices && typeof window.speakerChoices.setChoiceByValue === 'function') {
    const currentValue = window.speakerChoices.getValue(true);
    if (currentValue !== speakerName) {
      // Set the dropdown to this speaker name visually
      window.speakerChoices.setChoiceByValue(speakerName);
    }
  } else {
    // Fallback if Choices.js isn’t active yet
    const dropdown = document.getElementById('speaker-dropdown');
    if (dropdown && dropdown.value !== speakerName) {
      dropdown.value = speakerName;
    }
  }

  // --- Run the actual speaker-mode search ---
  runSearch(`[${speakerName}]:`, 'speaker');
}


function runSearch(query, mode = "text") {
  if (!query) return;
  const { fullText, map } = getSearchableTextMap();
  const lowerCaseQuery = query.trim().toLowerCase();
  const results = [];
  let searchIndex = 0;

  // Safely coerce any Node → Element (or null)
  const toElement = (n) => {
    if (!n) return null;
    return n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement || null;
  };

  while (true) {
    const foundIndex = fullText.indexOf(lowerCaseQuery, searchIndex);
    if (foundIndex === -1) break;
    const endIndex = foundIndex + lowerCaseQuery.length;

    const startPos = map[foundIndex];
    const endPos = map[endIndex - 1];

    // --- Common setup for utterance lookup ---
    const startElem = toElement(startPos?.node);
    const endElem = toElement(endPos?.node);
    const startSpan = startElem?.closest?.(".utterance") || null;
    const endSpan = endElem?.closest?.(".utterance") || startSpan;

    if (mode === "text" && !startSpan) {
      searchIndex = endIndex;
      continue;
    }

    let snippet = "";
    let startTime = 0;
    let endTime = 0;

    if (mode === "text") {
      // ---- TEXT MODE ----
      const utterances = [];
      let current = startSpan;
      while (current) {
        utterances.push(current);
        if (current === endSpan) break;
        current = current.nextElementSibling;
      }

      // --- Find the speaker name ---
      let speakerSpan = startSpan ? startSpan.previousElementSibling : null;
      let speakerName = "";
      while (speakerSpan) {
        if (!speakerSpan.classList?.contains("utterance")) {
          const text = speakerSpan.textContent?.trim() || "";
          if (text.startsWith("[")) {
            speakerName = text; // e.g. "[Florence Smith]"
            break;
          }
        }
        speakerSpan = speakerSpan.previousElementSibling;
      }

      // --- Determine if this is the first utterance by this speaker ---
      let prev = startSpan?.previousElementSibling;
      let isFirstInSpeech = true;
      while (prev && prev.classList?.contains("utterance")) {
        isFirstInSpeech = false; // found a previous utterance → not first
        break;
      }

      // --- Build snippet text ---
      const combinedText = utterances
        .map(u => (u.textContent || "").trim())
        .join(" ");

      const regex = new RegExp(lowerCaseQuery, "gi");
      let highlighted = combinedText.replace(regex, m => `<b>${m}</b>`);

      // Prepend speaker and ellipsis if needed
      let prefix = speakerName ? `${speakerName} ` : "";
      if (!isFirstInSpeech) prefix += "…";

      snippet = prefix + highlighted;

      // --- Timing as before ---
      startTime = parseFloat(startSpan?.dataset.startTime || 0);
      endTime = parseFloat(endSpan?.dataset.endTime || endSpan?.dataset.startTime || startTime);
    } else {
      // ---- NON-TEXT MODE ----
      const anchor = toElement(startPos?.node);

      // Find the first following utterance after the anchor
      let cursor = anchor ? anchor.nextElementSibling : null;
      while (cursor && !cursor.classList?.contains("utterance")) {
        cursor = cursor.nextElementSibling;
      }

      if (cursor) {
        const firstUtter = cursor;
        let texts = [];
        let chars = 0;
        let lastUtter = cursor;

        // Collect contiguous utterances up to 80 chars
        while (cursor && cursor.classList?.contains("utterance")) {
          const t = (cursor.textContent || "").trim().replace(/\s+/g, " ");
          if (!t) break;

          texts.push(t);
          chars += t.length;
          lastUtter = cursor;

          if (chars >= 80) break;

          const next = cursor.nextElementSibling;
          if (!next || !next.classList?.contains("utterance")) break;
          cursor = next;
        }

        snippet = texts.join(" ");
        if (snippet.length > 80) snippet = snippet.slice(0, 80) + "…";

        // Highlight first visible query term
        snippet = snippet.replace(new RegExp(lowerCaseQuery, "i"), m => `<b>${m}</b>`);

        // Compute display time range
        startTime = parseFloat(firstUtter?.dataset.startTime || 0);
        // If we stopped early due to the 80-char limit, we still treat 'lastUtter' as the end
        endTime = parseFloat(lastUtter?.dataset.endTime || lastUtter?.dataset.startTime || startTime);
      }
    }

    results.push({
      snippet,
      startTimeDisplay: `${Math.floor(startTime)}–${Math.ceil(endTime)}s`,
      startPos,
      endPos
    });

    searchIndex = endIndex;
  }

  renderSearchResults(results, query, mode);
}

function renderSearchResults(results, query, mode = "text") {
  let container;
  if (mode == 'text') {
    container = document.querySelector('.search-results');
  } else {
    container = document.querySelector('.nav-tab-content[data-mode="speaker"] .search-results');
  }
  if (!container) return;
  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = `<p>No results found for "<b>${query}</b>"</p>`;
    return;
  }

  const ul = document.createElement('ul');
  results.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `${r.snippet} <span class="timecode">(${r.startTimeDisplay})</span>`;
    li.addEventListener('click', () => {
      const range = document.createRange();
      range.setStart(r.startPos.node, r.startPos.offset);
      range.setEnd(r.endPos.node, r.endPos.offset);
      updatePlayerForRange(range);
      const element = r.startPos.node.nodeType === 3 ? r.startPos.node.parentElement : r.startPos.node;
      console.log(r.startPos.node.isConnected, r.startPos.node);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

async function initializeSpeakerTab() {
  const speakerContent = document.createElement('div');
  speakerContent.className = 'nav-tab-content';
  speakerContent.dataset.mode = 'speaker';
  speakerContent.innerHTML = `
    <select id="speaker-dropdown" placeholder="Select or type a speaker...">
      <option value="">Select speaker...</option>
    </select>
    <div class="search-results"></div>
  `;

  const agendaPane = document.getElementById('agenda');
  if (agendaPane) agendaPane.appendChild(speakerContent);

  await loadChoicesLibrary();   // ⬅️ ensure Choices.js is ready before building
  buildSpeakerDropdown();
}

