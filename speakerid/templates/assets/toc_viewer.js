import { initializeDirectory } from './directory.js';

export async function initializeToc() {
    console.log("toc_viewer: Initializing TOC...");
    const tocPane = document.getElementById('left-pane'); // Changed from toc-pane to left-pane to match shell
    const tocContentSlot = document.getElementById('toc-content-slot');
    const pinButton = document.getElementById('toc-pin-button');
    const resizeHandle = document.getElementById('toc-resize-handle');

    if (!tocPane || !tocContentSlot) {
        console.warn("toc_viewer: Required elements not found. Postponing or skipping.");
        return;
    }

    const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');

    if (!isIndexPage) {
        localStorage.setItem('lastOpenedTranscript', window.location.pathname);
    }

    // --- Directory Initialization ---
    await initializeDirectory(tocContentSlot, {
        activePath: window.location.pathname,
        linkHrefGenerator: (path) => path
    });

    // --- Links Pane Initialization ---
    const linksSlot = document.getElementById('links-container-slot');
    if (linksSlot) {
        try {
            const { initializeLinksPane } = await import('/assets/links.js');
            const hasLinks = await initializeLinksPane(linksSlot);
            if (hasLinks) {
                const linksSection = document.getElementById('toc-links-section');
                if (linksSection) linksSection.style.display = 'block';
            }
        } catch (e) {
            console.warn("toc_viewer: Could not initialize links pane:", e);
        }
    }

    // --- Tab Setup ---
    setupLeftPaneTabs();

    // --- Redirection (Index Only) ---
    if (isIndexPage) {
        handleRedirection(tocContentSlot);
    }

    // --- Pinning & Resizing ---
    setupPinning(tocPane, pinButton, isIndexPage);
    // Note: Resizing for left pane is now shared with setupDraggableDivider in viewer_logic
}


async function handleRedirection(container) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('no_redirect')) return;

    let targetUrl = null;
    const lastOpened = localStorage.getItem('lastOpenedTranscript');

    if (lastOpened && lastOpened !== 'null') {
        try {
            const response = await fetch(lastOpened, { method: 'HEAD' });
            if (response.ok) targetUrl = lastOpened;
        } catch (e) { }
    }

    if (!targetUrl) {
        const firstLink = container.querySelector('a.toc-link');
        if (firstLink) targetUrl = firstLink.href;
    }

    if (targetUrl) {
        window.location.href = targetUrl;
    }
}

function setupPinning(tocPane, pinButton, isIndexPage) {
    let savedState = localStorage.getItem('tocPinned');
    let isPinned = savedState === null ? true : savedState === 'true';
    if (isIndexPage) isPinned = true;

    function update() {
        if (isPinned) {
            tocPane.classList.add('pinned');
            tocPane.classList.remove('unpinned', 'expanded');
            if (pinButton) {
                pinButton.textContent = '📌';
                pinButton.title = "Unpin ToC";
            }
        } else {
            tocPane.classList.remove('pinned');
            tocPane.classList.add('unpinned');
            if (pinButton) {
                pinButton.textContent = '📍';
                pinButton.title = "Pin ToC";
            }
        }
        if (!isIndexPage) localStorage.setItem('tocPinned', isPinned);
    }

    if (pinButton) {
        if (isIndexPage) pinButton.style.display = 'none';
        pinButton.addEventListener('click', (e) => {
            e.stopPropagation();
            isPinned = !isPinned;
            update();
        });
    }

    tocPane.addEventListener('click', (e) => {
        if (tocPane.classList.contains('unpinned') && e.target !== pinButton) {
            tocPane.classList.toggle('expanded');
        }
    });

    document.addEventListener('click', (e) => {
        if (tocPane.classList.contains('unpinned') && tocPane.classList.contains('expanded')) {
            if (!tocPane.contains(e.target)) tocPane.classList.remove('expanded');
        }
    });

    update();
}

function setupLeftPaneTabs() {
    const tabs = document.querySelectorAll('#left-nav-tabs .pane-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('#left-pane .tab-content').forEach(content => {
                content.classList.remove('active');
                if (content.id === `${targetTab}-tab-content`) content.classList.add('active');
            });
        });
    });
}
