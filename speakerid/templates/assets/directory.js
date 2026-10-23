/**
 * directory.js
 * Shared logic for discovering and rendering the meeting directory.
 * Hybrid Version: Uses S3 XML for data (no JSON index), but retains V1 UI/UX/State logic.
 */

export async function initializeDirectory(container, options = {}) {
    // Default: Fetch config.json to get bucket name
    let configBucketUrl = null;
    try {
        const configResp = await fetch('/config.json');
        if (configResp.ok) {
            const config = await configResp.json();
            if (config.bucketName) {
                configBucketUrl = `https://s3.us-east-1.amazonaws.com/${config.bucketName}/`;
                console.log("Directory: Loaded configuration from config.json", configBucketUrl);
            }
        }
    } catch (e) {
        console.warn("Directory: Could not load config.json, will use provided options or default.", e);
    }

    const {
        isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
        meetingsRoot = '/meetings/',
        // Use configured URL if available, otherwise expects caller to provide it or fails
        bucketUrl = configBucketUrl,
        onLinkClick = null,
        linkHrefGenerator = (path) => path,
        activePath = null
    } = options;

    let hierarchy = {};

    try {
        if (isLocal) {
            console.log("Directory: Running in LOCAL mode.");
            const paths = await discoverMeetingsLocal(meetingsRoot);
            hierarchy = buildHierarchyFromPaths(paths);
        } else {
            console.log("Directory: Running in S3 mode (XML Discovery).");
            // Use the new XML discovery with NO json index dependency
            const paths = await discoverMeetingsS3Xml(bucketUrl);
            hierarchy = buildHierarchyFromPaths(paths);
        }

        renderDirectory(hierarchy, container, linkHrefGenerator, onLinkClick);
        restoreDirectoryState();

        // Enforce active path visibility *after* attempting to restore state
        if (activePath) {
            revealActivePath(container, activePath);
        }

    } catch (error) {
        console.error("Directory initialization failed:", error);
        container.innerHTML = '<li>Error loading meetings.</li>';
    }
}


function revealActivePath(container, activePath) {
    if (!activePath) return;

    // Normalize: remove query params, decode, and strip leading/trailing slashes for comparison
    const normalize = (p) => decodeURIComponent(p.split('?')[0]).replace(/^\/+|\/+$/g, "");
    const target = normalize(activePath);

    const links = container.querySelectorAll('a.toc-link');

    for (const link of links) {
        const rawPath = link.dataset.path;
        if (!rawPath) continue;

        const current = normalize(rawPath);

        // Match if identical OR if one ends with the other (handling potential relative/absolute mismatches)
        if (current === target || (current.length > 5 && target.endsWith(current)) || (target.length > 5 && current.endsWith(target))) {

            link.classList.add('active-meeting');

            // Expand all parent folders up to the root
            let curr = link.closest('li');
            while (curr && container.contains(curr)) {
                // If we hit a nested list, expand it
                if (curr.tagName === 'UL' && curr.classList.contains('nested')) {
                    curr.classList.add('active');

                    // Also flip the toggle arrow on the parent folder LI
                    const parentLi = curr.parentElement;
                    if (parentLi && parentLi.classList.contains('toc-folder')) {
                        const toggle = parentLi.querySelector('.toc-toggle');
                        if (toggle) toggle.classList.add('open');
                    }
                }
                curr = curr.parentElement;
            }

            // Scroll the active link into view so user sees it
            setTimeout(() => {
                link.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);

            break; // Found and handled the active link
        }
    }
}

async function discoverMeetingsLocal(baseUrl) {
    // Ensure baseUrl ends with /
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    try {
        const response = await fetch(baseUrl);
        const htmlString = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));

        const promises = links.map(link => {
            const href = link.getAttribute('href');
            const text = link.textContent;

            // Ignore parent directory links and non-relative links
            if (text === '../' || href.startsWith('/') || href.includes(':')) return Promise.resolve([]);

            const fullPath = `${baseUrl}${href}`;

            if (text.endsWith('/')) {
                return discoverMeetingsLocal(fullPath);
            } else if (text === 'transcript.html') {
                return Promise.resolve([fullPath]);
            }
            return Promise.resolve([]);
        });

        const results = await Promise.all(promises);
        return results.flat();
    } catch (e) {
        console.warn(`Failed to fetch ${baseUrl}:`, e);
        return [];
    }
}

// --- NEW FUNCTION: XML Discovery ---
async function discoverMeetingsS3Xml(bucketUrl) {
    const allKeys = [];
    let continuationToken = '';

    try {
        if (!bucketUrl) throw new Error("Bucket URL missing for XML discovery.");

        while (true) {
            let url = `${bucketUrl}?list-type=2&max-keys=1000`;
            if (continuationToken) {
                url += `&continuation-token=${encodeURIComponent(continuationToken)}`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error(`S3 Fetch Failed: ${response.status}`);

            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "application/xml");

            const contents = xml.getElementsByTagName('Contents');
            for (let i = 0; i < contents.length; i++) {
                const key = contents[i].getElementsByTagName('Key')[0].textContent;
                // Only collect relevant transcript files
                if (key.endsWith('transcript.html') && key.includes('meetings/')) {
                    // CRITICAL FIX: Prepend slash to ensure absolute path
                    allKeys.push('/' + key);
                }
            }

            const isTruncated = xml.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
            const nextToken = xml.getElementsByTagName('NextContinuationToken')[0]?.textContent;

            if (!isTruncated) break;
            continuationToken = nextToken;
        }
        return allKeys;
    } catch (e) {
        console.error("XML Discovery Error:", e);
        return [];
    }
}

function buildHierarchyFromPaths(paths) {
    const root = { name: "root", type: "folder", children: {} };

    paths.forEach(fullPath => {
        // Remove leading slash
        const cleanPath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
        const parts = cleanPath.split('/').filter(p => p);

        // Skip "meetings" if it's the first part
        const relevantParts = parts[0] === 'meetings' ? parts.slice(1) : parts;

        let currentNode = root;

        relevantParts.forEach((part, index) => {
            const isLast = index === relevantParts.length - 1;

            if (isLast && part === 'transcript.html') {
                // This path ends in transcript.html. 
                // The CURRENT node (parent of this part) is the meeting folder.
                currentNode.isMeeting = true;
                currentNode.linkPath = fullPath; // Use the provided fullPath (which should be absolute now)

                // Double check for absolute path safety
                if (!currentNode.linkPath.startsWith('/')) {
                    currentNode.linkPath = '/' + currentNode.linkPath;
                }
            } else {
                // It's a folder or a file not named transcript.html
                if (!currentNode.children[part]) {
                    currentNode.children[part] = {
                        name: part,
                        type: "folder",
                        children: {}
                    };
                }
                currentNode = currentNode.children[part];
            }
        });
    });

    return root;
}


function renderDirectory(rootNode, container, linkHrefGenerator, onLinkClick) {
    container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'toc-list';

    // Retrieve saved "expanded list" state
    let expandedLists = {};
    try {
        expandedLists = JSON.parse(localStorage.getItem('expandedListsState')) || {};
    } catch (e) {
        // ignore
    }

    const sortChildren = (children) => {
        return Object.values(children).sort((a, b) => {
            if (a.isMeeting && b.isMeeting) {
                // Descending for meetings (newest first)
                return b.name.localeCompare(a.name);
            }
            // Ascending for folders/committees
            return a.name.localeCompare(b.name);
        });
    };

    const buildTree = (node, parentElement, pathKey = 'root') => {
        const sortedNodes = sortChildren(node.children);

        // Split nodes into meetings and folders
        const meetings = sortedNodes.filter(n => n.isMeeting);
        const folders = sortedNodes.filter(n => !n.isMeeting);

        // Logic: Group meetings into "Meetings of the Whole" iff there are BOTH meetings AND subfolders
        if (meetings.length > 0 && folders.length > 0) {
            const virtualFolder = {
                name: "Meetings of the Whole",
                type: "folder",
                isMeetingsOfTheWhole: true,
                children: meetings.reduce((acc, m) => { acc[m.name] = m; return acc; }, {})
            };

            const combinedFolders = [...folders, virtualFolder].sort((a, b) => a.name.localeCompare(b.name));
            combinedFolders.forEach(child => renderFolderNode(child, parentElement, pathKey + '/' + child.name));
        } else {
            // Normal case: Render meetings (if any) then folders (if any)
            renderMeetingsList(meetings, parentElement, pathKey);
            folders.forEach(child => renderFolderNode(child, parentElement, pathKey + '/' + child.name));
        }
    };

    const renderMeetingsList = (meetings, parentElement, pathKey) => {
        const MAX_VISIBLE = 5;
        const totalMeetings = meetings.length;
        let isExpanded = expandedLists[pathKey] === true;

        meetings.forEach((child, index) => {
            const li = document.createElement('li');
            li.className = 'toc-item';

            if (!isExpanded && index >= MAX_VISIBLE) {
                li.style.display = 'none';
                li.classList.add('hidden-toc-item');
            }

            const a = document.createElement('a');
            a.className = 'toc-link';
            a.href = linkHrefGenerator(child.linkPath);
            a.dataset.path = child.linkPath;

            const spacer = document.createElement('span');
            spacer.className = 'toc-toggle-spacer';
            a.appendChild(spacer);

            const icon = document.createElement('span');
            icon.className = 'toc-icon document-icon';

            const text = document.createElement('span');
            text.className = 'toc-text';
            text.textContent = decodeURIComponent(child.name).replace(/_/g, ' ');

            a.appendChild(icon);
            a.appendChild(text);
            li.appendChild(a);

            if (onLinkClick) {
                a.addEventListener('click', (e) => onLinkClick(e, child.linkPath));
            }
            parentElement.appendChild(li);

            if (index === MAX_VISIBLE - 1 && totalMeetings > MAX_VISIBLE) {
                const toggleLi = document.createElement('li');
                toggleLi.className = 'toc-show-more';
                toggleLi.textContent = isExpanded ? '[ Show Less ]' : `[ Show ${totalMeetings - MAX_VISIBLE} More... ]`;
                toggleLi.onclick = (e) => {
                    e.stopPropagation();
                    const hiddenItems = parentElement.querySelectorAll('.hidden-toc-item');
                    isExpanded = !isExpanded;
                    hiddenItems.forEach(item => item.style.display = isExpanded ? '' : 'none');
                    toggleLi.textContent = isExpanded ? '[ Show Less ]' : `[ Show ${totalMeetings - MAX_VISIBLE} More... ]`;
                    expandedLists[pathKey] = isExpanded;
                    localStorage.setItem('expandedListsState', JSON.stringify(expandedLists));
                };
                parentElement.appendChild(toggleLi);
            }
        });
    };

    const renderFolderNode = (child, parentElement, pathKey) => {
        const li = document.createElement('li');
        li.className = 'toc-folder';
        if (child.isMeetingsOfTheWhole) li.classList.add('virtual-folder');

        const row = document.createElement('div');
        row.className = 'toc-folder-row';

        const toggle = document.createElement('span');
        toggle.className = 'toc-toggle';

        const icon = document.createElement('span');
        icon.className = 'toc-icon folder-icon';

        const label = document.createElement('span');
        label.className = 'toc-label';
        label.textContent = decodeURIComponent(child.name).replace(/_/g, ' ');

        row.appendChild(toggle);
        row.appendChild(icon);
        row.appendChild(label);
        li.appendChild(row);

        const nestedUl = document.createElement('ul');
        nestedUl.className = 'nested';
        li.appendChild(nestedUl);

        buildTree(child, nestedUl, pathKey);
        parentElement.appendChild(li);
    };

    buildTree(rootNode, ul);
    container.appendChild(ul);

    // Event Delegation for Toggles
    container.addEventListener('click', (e) => {
        const folderRow = e.target.closest('.toc-folder-row');
        if (folderRow) {
            const li = folderRow.parentElement;
            const nested = li.querySelector('.nested');
            const toggle = folderRow.querySelector('.toc-toggle');

            if (nested) {
                nested.classList.toggle('active');
                toggle.classList.toggle('open');
                saveDirectoryState();
            }
        }
    });
}

function saveDirectoryState() {
    try {
        const state = {};
        document.querySelectorAll('.toc-folder').forEach((folder, index) => {
            const toggle = folder.querySelector('.toc-toggle');
            if (toggle && toggle.classList.contains('open')) {
                state[index] = true;
            }
        });
        localStorage.setItem('directoryState', JSON.stringify(state));
    } catch (e) {
        // Ignore write errors
    }
}

function restoreDirectoryState() {
    try {
        const state = JSON.parse(localStorage.getItem('directoryState')) || {};
        document.querySelectorAll('.toc-folder').forEach((folder, index) => {
            if (state[index]) {
                const toggle = folder.querySelector('.toc-toggle');
                const nested = folder.querySelector('.nested');
                if (toggle) toggle.classList.add('open');
                if (nested) nested.classList.add('active');
            }
        });
    } catch (e) {
        console.warn('Failed to restore directory state:', e);
    }
}
