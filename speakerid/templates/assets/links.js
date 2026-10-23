/**
 * links.js
 * Handles discovery and rendering of the "Related Links" pane.
 */

export async function initializeLinksPane(container) {
    try {
        // 1. Attempt to fetch links.json from the CURRENT directory
        // Since we are in a deep folder, we just fetch '/assets/links.json' relatively
        const response = await fetch('/assets/links.json');
        if (!response.ok) {
            console.log("No links.json found for this meeting.");
            return false; // Signal that no tab should be created
        }

        const data = await response.json();
        const links = data.links || [];

        if (links.length === 0) return false;

        renderLinks(links, container);
        return true; // Signal success to navigation.js
    } catch (e) {
        console.warn("Links Pane: Failed to load links.json", e);
        return false;
    }
}

function renderLinks(links, container) {
    container.innerHTML = `
        <div class="links-pane-content">
            <ul class="links-list">
                ${links.map(link => renderLinkItem(link)).join('')}
            </ul>
        </div>
    `;

    // Attach listeners for helper scripts
    container.querySelectorAll('.helper-link').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const scriptPath = el.dataset.helper;
            loadHelperScript(scriptPath);
        });
    });
}

function renderLinkItem(link) {
    if (link.url) {
        return `
            <li class="link-item">
                <a href="${link.url}" target="_blank" rel="noopener">
                    <span class="link-icon">🔗</span>
                    <span class="link-text">${link.label}</span>
                </a>
            </li>
        `;
    } else if (link.helper) {
        return `
            <li class="link-item">
                <a href="#" class="helper-link" data-helper="${link.helper}">
                    <span class="link-icon">⚙️</span>
                    <span class="link-text">${link.label}</span>
                </a>
            </li>
        `;
    }
    return '';
}

async function loadHelperScript(path) {
    console.log(`Links Pane: Invoking helper script: ${path}`);
    try {
        const module = await import(`/assets/${path}`);
        if (module && typeof module.execute === 'function') {
            module.execute();
        } else {
            console.warn(`Helper script ${path} does not export an 'execute' function.`);
        }
    } catch (e) {
        console.error(`Failed to load helper script: ${path}`, e);
    }
}
