// SmartTranscripts Guided Tour (parameterized version)
// Defines global startTour(force = false)

const PAUSE_TIME=1000


function startTour(force = false) {
  // --- cleanup from any previous tour ---
  document.querySelectorAll('.tour-tip, .tour-backdrop').forEach(el => el.remove());

  // --- required DOM elements ---
  const textContainer = document.querySelector('#text-container');
  const agenda = document.getElementById('agenda');
  const speakerDropdown = document.getElementById('speaker-dropdown');


  // --- helpers ------------------------------------------------------------
	function showIntroDialog(force) {
		const backdrop = document.createElement('div');
		backdrop.className = 'tour-backdrop';
		const tip = document.createElement('div');
		tip.className = 'tour-tip';
		tip.style.maxWidth = '500px'; // wider for long intro text
		tip.className = 'tour-tip tour-intro';


		tip.innerHTML = `
		  <h3>Welcome to SmartTranscripts</h3>
		  <p>
			You are using a SmartTranscript of a meeting which was created by AI. SmartTranscripts give you
			the searchability and speed of text while allowing quick access to the depth of video and audio.
			Because AI transcription may have errors, you should always verify quotes of significance by playing
			the associated video clip, which is very easy to do.
		  </p>
		  <p>
			This tutorial will show you how to find and select clips and how to search by agenda item,
			keyword, and speaker name. You can always watch the tutorial again by accessing it from the Help Menu.
		  </p>
		  <div class="tour-buttons">
			<button class="skip">Skip tutorial</button>
			<button class="next">Show tutorial</button>
		  </div>
		`;

		// optional "Don't show again" checkbox
		if (!force) {
		  const checkboxDiv = document.createElement('div');
		  checkboxDiv.className = 'tour-checkbox';
		  checkboxDiv.innerHTML = `
			<label><input type="checkbox" id="tour-intro-hide" checked>
			Don’t show this message again</label>`;
		  tip.appendChild(checkboxDiv);
		}

		document.body.append(backdrop, tip);

		// --- button logic ---
		const skipBtn = tip.querySelector('.skip');
		const nextBtn = tip.querySelector('.next');

		skipBtn.onclick = () => {
		  if (!force) {
			const hide = document.getElementById('tour-intro-hide')?.checked;
			if (hide) localStorage.setItem('smartTourSkip', '1');
		  }
		  backdrop.remove();
		  tip.remove();
		  console.log('Tutorial skipped.');
		};

		nextBtn.onclick = () => {
		  if (!force) {
			const hide = document.getElementById('tour-intro-hide')?.checked;
			if (hide) localStorage.setItem('smartTourSkip', '1');
		  }
		  backdrop.remove();
		  tip.remove();
		  showStep(0); // start the actual tutorial
		};
	}

	function highlight(el) {
		clearHighlight();
		if (el) {
		  el.dataset.tourHighlight = '1';
		  el.style.outline = '3px solid orange';
		  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}
	function clearHighlight() {
		document.querySelectorAll('[data-tour-highlight]').forEach(e => {
		  e.style.outline = '';
		  delete e.dataset.tourHighlight;
		});
	}
	  
	function resetView() {
	  window.getSelection().removeAllRanges();
	  const firstSpan = document.querySelector('.utterance');
	  if (firstSpan) {
		firstSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
	  }
	  const video = document.getElementById('videoElement');
	  if (video && !video.paused) video.pause();
	  const agendaButton = document.querySelector('.nav-tab-button[data-mode="agenda"]');
	  if (agendaButton) {
		agendaButton.click();
	  } else {
		console.warn('resetView: agenda button not found.');
	  }
	}


  // --- step list ----------------------------------------------------------
  const steps = [
    {
      sel: '#text-container',
      title: 'Tutorial: Play a clip',
      text: `This transcript was created by AI. To see and hear a video clip for added depth or verification:
		1. select the text of the clip you want to see
		2. click ▶ above the viewer on the left
	`,
      action: simulateSelectionAndPlay
    },
    {
      sel: '#agenda',
      title: 'Tutorial: see an agenda item',
      text: `To jump to a specific agenda item:
		1.click the Agenda tab in the Navigation pane
		2.click the specific item you are interested in
		The transcript will scroll to and hilight the agenda item.
		You can click ▶ to see and hear that part of the transcript.
	`,	

      action: simulateAgendaClick
    },
    {
      sel: '#agenda',
      title: 'Tutorial: search by keyword or phrase',
      text: `To search for a keyword or phrase in the transcript:
		1.click the Text tab in the Navigation pane
		2.type the word or phrase you are looking for
		3.click on a particular instance of the words
		The transcript will scroll to and hilight that instance.
		You can click ▶ to see and hear that part of the transcript.
	`,
      action: simulateKeywordSearch
    },

    {
      sel: '#agenda',
      title: 'Tutorial: earch by speaker',
      text: `To search for all the comments by a particular speaker:
		1.click the Speaker tab in the Navigation pane
		2.select the speaker from the dropdown or begin typing a name
		3.click on whatever comment interests you
		The transcript will scroll to and hilight that comment.
		You can click ▶ to see and hear that comment.
	`,
      action: simulateSpeakerSearch
    }
  ];

  let stepIndex = 0;
  const checkboxDiv = document.createElement('div');
  checkboxDiv.className = 'tour-checkbox';
  checkboxDiv.innerHTML =
    '<label><input type="checkbox" id="tour-hide" checked> Don’t show this tour again</label>';
  if (force) checkboxDiv.style.display = 'none'; // hide if manual


  function endTour() {

    clearHighlight();
	document.querySelectorAll('.tour-tip, .tour-backdrop').forEach(el => el.remove());

    // only respect checkbox if auto demo
    if (!force) {
      const hide = document.getElementById('tour-hide')?.checked;
      if (hide) localStorage.setItem('smartTourSkip', '1');
    }

    // final dialog for auto demo
    if (!force && stepIndex >= steps.length) {
      tip.innerHTML = `
        <h3>Tutorial complete</h3>
        <p>You can replay this Tutorial anytime from the Help menu.</p>
        <div class="tour-buttons">
          <button class="next">Finish</button>
        </div>
      `;
      tip.querySelector('.next').onclick = () => {
        tip.remove();
        backdrop.remove();
      };
      return;
    };
  }

  function showStep(i) {
	  // 🔹 Remove any previous step overlay
	  document.querySelectorAll('.tour-tip, .tour-backdrop').forEach(el => el.remove());

	  // 🔹 Create new backdrop + tooltip for this step
	  const backdrop = document.createElement('div');
	  backdrop.className = 'tour-backdrop';
	  const tip = document.createElement('div');
	  tip.className = 'tour-tip';
	  document.body.append(backdrop, tip);

    const step = steps[i];
    if (!step) {
      stepIndex = i;
      return endTour();
    }

    const target = document.querySelector(step.sel);
    if (!target) {
      stepIndex = i;
      return endTour();
    }

    highlight(target);
    const rect = target.getBoundingClientRect();
    tip.innerHTML = `
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <div class="tour-buttons">
        <button class="showme">Show me</button>
        <button class="skip">Exit Tutorial</button>
        <button class="next">${i === steps.length - 1 ? 'Finish' : 'Next →'}</button>
      </div>
    `;
    if (!force) tip.appendChild(checkboxDiv);
    const tipHeight =  tip.offsetHeight || 180; // estimated before append
	let top = rect.bottom + 10;
	if (top + tipHeight > window.innerHeight - 10) {
	  top = window.innerHeight - tipHeight - 10; // push up if overflowing
	}
	if (top < 10) top = 10; // ensure not above the viewport
	tip.style.top = `${top}px`;
    tip.style.left = `${Math.max(rect.left, 10)}px`;

	const showBtn = tip.querySelector('.showme');
	const skipBtn = tip.querySelector('.skip');
	const nextBtn = tip.querySelector('.next');

// Initial default: Show me
	showBtn.classList.add('is-default');
	nextBtn.classList.remove('is-default');
	showBtn.focus();

	skipBtn.onclick = endTour;

	nextBtn.onclick = () => {
	  resetView();
	  stepIndex = i + 1;
	  showStep(stepIndex);
	};

	let shownOnce = false;

	showBtn.onclick = () => {
	  if (typeof step.action === 'function') {
	  	  resetView();                          // 🔹 reset *after* finishing step
		  setTimeout(()=>{
			step.action(target);
		  },PAUSE_TIME);
	  }
	  if (!shownOnce) {
		shownOnce = true;
		showBtn.textContent = 'Show me again';

		// After first run, Next becomes the default
		showBtn.classList.remove('is-default');
		nextBtn.classList.add('is-default');
		nextBtn.focus();
	  }
	};
  }

  // --- demo actions -------------------------------------------------------
  async function simulateSelectionAndPlay(target) {
    updatePlayerForTime(100, 110);
    const video = document.getElementById('videoElement');
    const playBtn = document.getElementById('play-clip-button');
    if (!video || !playBtn) return null;
    function playWhenReady() {
      if (video.readyState >= 2) playBtn.click();
      else {
        video.addEventListener('loadedmetadata', () => playBtn.click(), { once: true });
        video.addEventListener('canplay', () => playBtn.click(), { once: true });
      }
    }
    setTimeout(playWhenReady, PAUSE_TIME);
    return null;
  }

  async function simulateAgendaClick() {
    const agendaButton = document.querySelector('.nav-tab-button[data-mode="agenda"]');
    if (agendaButton) agendaButton.click();
    setTimeout(() => {
      const agendaLink = document.querySelector('#agenda a[href="#item-2"]');
      if (agendaLink) agendaLink.click();
    }, 100);
    return null;
  }

  async function simulateKeywordSearch() {
    const textButton = document.querySelector('.nav-tab-button[data-mode="text"]');
    if (textButton) textButton.click();
    const field = document.getElementById('text-search-input');
    if (!field) return null;
    field.value = 'public comment';
    runSearch(field.value);
    await new Promise(r => setTimeout(r, PAUSE_TIME)); // wait
	const firstResult = document.querySelector('.nav-tab-content[data-mode="text"] .search-results li');
    if (firstResult) firstResult.click();
    return null;
  }



  async function simulateSpeakerSearch() {
	const speakerButton = document.querySelector('.nav-tab-button[data-mode="speaker"]');
    if (speakerButton) speakerButton.click();
	const dropdown = document.getElementById('speaker-dropdown');
	if (!dropdown) return;

	  // If Choices.js is active
	  if (window.speakerChoices && typeof window.speakerChoices.setChoiceByValue === 'function') {
		const opts = dropdown.options;
		if (opts.length > 3) {
		  const thirdValue = opts[3].value; // index 0 = placeholder
		  console.log(`Selecting via Choices: ${thirdValue}`);
		  window.speakerChoices.setChoiceByValue(thirdValue);
		  // trigger the same change event runSpeakerSearch() would handle
		  await new Promise(r => setTimeout(r, PAUSE_TIME)); // wait
		  dropdown.dispatchEvent(new Event('change', { bubbles: true }));
		}
	  } else {
	  // Fallback if Choices.js isn't active yet
		  if (dropdown.options.length > 3) {
			dropdown.selectedIndex = 3;
			const event = new Event('change', { bubbles: true });
			dropdown.dispatchEvent(event);
		
		}
	  }
	  await new Promise(r => setTimeout(r, PAUSE_TIME)); // wait
	  const firstResult = document.querySelector('.nav-tab-content[data-mode="speaker"] .search-results li');
	  if (firstResult) firstResult.click();
	  return null;
  }

  // --- start the first step -----------------------------------------------
  showIntroDialog(force);
}

// export entry point
window.startTour = startTour;
