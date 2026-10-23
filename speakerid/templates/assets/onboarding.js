
const Onboarding = {
    playKey: 'smartTranscript_playOnboardingSeen',
    shareKey: 'smartTranscript_shareOnboardingSeen',
    sessionPlayShown: false,
    sessionShareShown: false,

    // Graphics
    playSvg: `<svg viewBox="0 0 24 24" class="inline-icon"><path d="M8 5v14l11-7z"/></svg>`,

    // Share Icons
    emailSvg: `<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
    copySvg: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    facebookSvg: `<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m13 2h-2.5a3.5 3.5 0 0 0-3.5 3.5V11h-2v3h2v7h3v-7h3v-3h-3V8.5A1.5 1.5 0 0 1 15 7h3V5z"/></svg>`,
    xSvg: `<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
    linkedinSvg: `<svg viewBox="0 0 24 24"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-11 4H5v11h3V7m-1.5-2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 2h-2.5c-2 0-2.5 1-2.5 2.5V11h3v3h-3v5h-3v-5H9v-3h2.5V9.5C11.5 7 13 6 15 6h2.5v3z"/></svg>`,
    whatsappSvg: `<svg viewBox="0 0 24 24"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zM12.04 20.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31c-.82-1.31-1.26-2.83-1.26-4.38 0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24zm4.52-6.13c-.25-.12-1.47-.72-1.7-.81-.23-.09-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.06-.39-2.02-1.25-.75-.67-1.25-1.5-1.4-1.75-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.43s-.56-1.34-.76-1.84c-.2-.48-.41-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.88 2.4 1 2.56.12.17 1.76 2.67 4.25 3.73.59.25 1.05.41 1.41.52.6.19 1.14.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.05-.12-.2-.19-.44-.31z"/></svg>`,

    init() {
        window.triggerSelectionOnboarding = () => this.checkAndShow();
    },

    checkFirstUse() {
        const modal = document.getElementById('about-modal');
        const content = document.getElementById('about-content');
        if (!modal || !content) return; // Prevent checking and burning flag on index.html

        const firstUseKey = 'smartTranscript_onboarding_started';
        const params = new URLSearchParams(window.location.search);

        if (!localStorage.getItem(firstUseKey)) {
            localStorage.setItem(firstUseKey, '1');

            if (params.get('startTime')) {
                // Accessed via deep link first-time:
                // Exception requested: allow Play popup (do not suppress)
                // but suppress Welcome Modal entirely and Share popup.
                this.sessionShareShown = true;
            } else {
                if (typeof startTour === 'function') {
                    startTour(false);
                } else {
                    const css = document.createElement('link');
                    css.rel = 'stylesheet';
                    css.href = '/assets/tour.css';
                    document.head.appendChild(css);

                    const script = document.createElement('script');
                    script.src = '/assets/tour.js?v=' + Date.now();
                    script.onload = () => { if (typeof startTour === 'function') startTour(false); };
                    document.body.appendChild(script);
                }
            }
        } else if (params.get('startTime')) {
            // Not a first time user. If opened with parameters, suppress ALL popups
            this.sessionPlayShown = true;
            this.sessionShareShown = true;
        }
    },

    checkAndShow() {
        const playSeen = localStorage.getItem(this.playKey);

        if (!playSeen) {
            if (!this.sessionPlayShown) {
                this.showPlayPopup();
                return;
            }
        }

        if (!localStorage.getItem(this.shareKey)) {
            if (this.sessionShareShown) return;
            this.showSharePopup();
        }
    },

    createPopup(options) {
        // Cleanup existing
        const existing = document.querySelector('.onboarding-popup');
        if (existing) existing.remove();
        const existingBackdrop = document.querySelector('.onboarding-backdrop');
        if (existingBackdrop) existingBackdrop.remove();

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'onboarding-backdrop';
        const killEvent = (e) => { e.preventDefault(); e.stopPropagation(); };
        backdrop.addEventListener('mousedown', killEvent);
        backdrop.addEventListener('mouseup', killEvent);
        backdrop.addEventListener('click', killEvent);
        backdrop.addEventListener('wheel', killEvent, { passive: false });
        document.body.appendChild(backdrop);

        // Fetch Template
        const template = document.getElementById('onboarding-popup-template');
        if (!template) return;
        const popup = template.content.cloneNode(true).querySelector('.onboarding-popup');

        // Prevent interactions from bubbling AND prevent focus-stealing
        const handlePopupEvent = (e) => {
            e.stopPropagation();

            if (e.type === 'mousedown') {
                const tag = e.target.tagName.toLowerCase();
                // Prevent focus-stealing for almost everything in the popup
                // This keeps the transcript selection alive.
                if (tag !== 'input' && tag !== 'textarea') {
                    e.preventDefault();
                }
            }
        };
        popup.addEventListener('mousedown', handlePopupEvent);
        popup.addEventListener('mouseup', handlePopupEvent);
        popup.addEventListener('click', handlePopupEvent);
        popup.addEventListener('wheel', handlePopupEvent, { passive: false });
        let top, left;

        if (options.isIllustration) {
            // Center
            popup.className = 'onboarding-popup no-arrow';
            left = (window.innerWidth - 300) / 2;
            top = (window.innerHeight - 340) / 2;
        } else {
            // Relative
            const rect = options.targetElement.getBoundingClientRect();
            let isArrowTop = true;
            top = rect.bottom + 15;
            left = rect.left;

            if (top + 200 > window.innerHeight) {
                top = rect.top - 230;
                isArrowTop = false;
            }
            popup.className = isArrowTop ? 'onboarding-popup arrow-top' : 'onboarding-popup';

            if (left + 280 > window.innerWidth) left = window.innerWidth - 300;
            if (left < 10) left = 10;

            const targetCenter = rect.left + (rect.width / 2);
            let arrowLeft = targetCenter - left;
            arrowLeft = Math.max(12, Math.min(268, arrowLeft));
            popup.style.setProperty('--arrow-left', `${arrowLeft}px`);
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        // Populate Content
        popup.querySelector('.popup-title').textContent = options.title;
        popup.querySelector('.popup-content').innerHTML = options.contentHtml;

        if (options.storageKey) {
            popup.querySelector('.onboarding-checkbox').style.display = 'flex';
        }

        // Configure Buttons
        const btnShowAgain = popup.querySelector('#btn-show-again');
        const btnShowMe = popup.querySelector('#btn-show-me');
        const btnGotIt = popup.querySelector('#btn-got-it');
        const btnOk = popup.querySelector('#btn-ok');

        if (options.onRetry) {
            if (btnShowAgain) btnShowAgain.style.display = 'block';
            if (btnOk) btnOk.style.display = 'block';
        } else if (options.onShowMe) {
            if (btnGotIt) btnGotIt.style.display = 'block';
            if (btnShowMe) btnShowMe.style.display = 'block';
        } else {
            if (btnGotIt) btnGotIt.style.display = 'block';
        }

        document.body.appendChild(popup);

        // Close Logic
        const handleClose = (action, triggerElement) => {
            let startPos = null;
            if (triggerElement && triggerElement.isConnected) {
                const r = triggerElement.getBoundingClientRect();
                startPos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            } else {
                startPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            }

            const checkbox = document.querySelector('.onboarding-popup #onboarding-dont-show');
            if (checkbox && checkbox.checked) {
                if (options.storageKey) localStorage.setItem(options.storageKey, '1');
            }

            const activePopup = document.querySelector('.onboarding-popup');
            if (activePopup) activePopup.remove();
            backdrop.remove();

            if (action === 'showMe' && options.onShowMe) options.onShowMe(startPos);
            if (action === 'gotIt' && options.onGotIt) options.onGotIt();
            if (action === 'retry' && options.onRetry) options.onRetry(startPos);
        };

        if (btnShowMe) btnShowMe.addEventListener('click', (e) => handleClose('showMe', e.target));
        if (btnGotIt) btnGotIt.addEventListener('click', () => handleClose('gotIt'));
        if (btnShowAgain) btnShowAgain.addEventListener('click', (e) => handleClose('retry', e.target));
        if (btnOk) btnOk.addEventListener('click', () => handleClose('gotIt'));

        const checkboxPopup = document.querySelector('.onboarding-popup #onboarding-dont-show');
        if (checkboxPopup) {
            checkboxPopup.addEventListener('click', (e) => e.stopPropagation());
        }
    },

    showPlayPopup() {
        this.sessionPlayShown = true;
        const target = document.getElementById('play-clip-button');
        if (!target) return;

        this.createPopup({
            targetElement: target,
            title: "Play Clip",
            contentHtml: `Click ${this.playSvg} to see and hear a video clip of the selected text.`,
            onShowMe: (startPos) => this.simulateAction(target, true, null, startPos),
            onGotIt: () => { },
            storageKey: this.playKey
        });
    },

    showSharePopup() {
        this.sessionShareShown = true;
        const target = document.getElementById('share-button');
        if (!target) return;

        this.createPopup({
            targetElement: target,
            title: "Share Clip",
            contentHtml: `Click <span class="inline-btn-ref">Share Clip</span> to open the share dialog.`,
            onShowMe: (startPos) => this.runShareDemo(target, startPos),
            onGotIt: () => { },
            storageKey: this.shareKey
        });
    },

    runShareDemo(targetElement, startPos) {
        this.simulateAction(targetElement, false, () => {
            this.showShareIllustration(targetElement);
        }, startPos);
    },

    showShareIllustration(targetElement) {
        let timeRange = "(00:00 - 00:00)";
        const timeEl = document.getElementById('time-range');
        if (timeEl && timeEl.textContent.includes('Clip:')) {
            timeRange = `(${timeEl.textContent.replace('Clip: ', '').trim()})`;
        } else if (timeEl) {
            timeRange = `(${timeEl.textContent.trim()})`;
        }

        const template = document.getElementById('share-illustration-template');
        let contentHtml = '';
        if (template) {
            const clone = template.content.cloneNode(true);
            const rangeSpan = clone.querySelector('.mock-time-range');
            if (rangeSpan) rangeSpan.textContent = timeRange;

            const tempDiv = document.createElement('div');
            tempDiv.appendChild(clone);
            contentHtml = tempDiv.innerHTML;
        }

        this.createPopup({
            targetElement: null,
            title: "Share Dialog",
            contentHtml: contentHtml,
            onGotIt: () => { },
            storageKey: this.shareKey,
            isIllustration: true
        });
    },

    simulateAction(targetElement, doRealClick, onComplete, startPos) {
        const cursor = document.createElement('div');
        cursor.className = 'onboarding-cursor';

        let startX, startY;
        if (startPos) {
            startX = startPos.x;
            startY = startPos.y;
        } else {
            // Default center
            startX = window.innerWidth / 2;
            startY = window.innerHeight / 2;
        }

        cursor.style.left = `${startX}px`;
        cursor.style.top = `${startY}px`;
        cursor.classList.add('blinking');
        document.body.appendChild(cursor);

        // Target center
        const rect = targetElement.getBoundingClientRect();
        const targetX = rect.left + (rect.width / 2) - 12; // -12 center offs
        const targetY = rect.top + (rect.height / 2) - 12;

        // Force reflow
        cursor.getBoundingClientRect();

        // 1. Blink at Button (1.5s)
        setTimeout(() => {
            cursor.classList.remove('blinking');

            // 2. Move to Target (2.0s)
            cursor.style.left = `${targetX}px`;
            cursor.style.top = `${targetY}px`;

            // 3. Click
            setTimeout(() => {
                targetElement.classList.add('active-click');
                if (doRealClick) {
                    targetElement.click();
                }
                setTimeout(() => targetElement.classList.remove('active-click'), 200);

                // Cleanup
                cursor.style.opacity = '0';
                setTimeout(() => {
                    cursor.remove();
                    if (onComplete) onComplete();
                }, 500);
            }, 2000);

        }, 1500);
    }
};

Onboarding.init();
window.Onboarding = Onboarding;
// Trigger First-time user onboarding check automatically when loaded
Onboarding.checkFirstUse();
