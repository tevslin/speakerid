
import { initializeDirectory } from './directory.js';

document.addEventListener('DOMContentLoaded', () => {
    const meetingList = document.getElementById('meeting-list');
    const agendaDisplay = document.getElementById('agenda-display');
    const agendaTitle = document.getElementById('agenda-title');
    const agendaItems = document.getElementById('agenda-items');
    const openTranscriptButton = document.getElementById('open-transcript-button');
    const openOfficialTranscriptButton = document.getElementById('open-official-transcript-button');

    const agendaPlaceholder = document.getElementById('agenda-placeholder');
    const agendaContent = document.getElementById('agenda-content');

    // Initialize Directory
    initializeDirectory(meetingList, {
        onLinkClick: (e, path) => {
            e.preventDefault();
            displayMeetingDetails(path);
        },
        linkHrefGenerator: (path) => '#' // Keep href as # for the index page to prevent navigation
    });

    function displayMeetingDetails(filePath) {
        openTranscriptButton.dataset.path = filePath;

        fetch(filePath)
            .then(response => response.text())
            .then(htmlString => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlString, 'text/html');

                const title = doc.querySelector('#meeting-title').textContent;
                const agendaHtml = doc.querySelector('#agenda ul').innerHTML;
                const officialTranscriptLink = doc.querySelector('a[href*="official-transcript"]');

                agendaTitle.textContent = title;
                agendaItems.innerHTML = agendaHtml;

                agendaItems.querySelectorAll('a').forEach(a => {
                    const originalHref = a.getAttribute('href');
                    const anchor = originalHref.substring(1);
                    // Construct absolute path for the transcript link
                    const transcriptUrl = new URL(filePath, window.location.origin).pathname;
                    a.href = `${transcriptUrl}?agenda=${anchor}`;
                    a.target = '_blank';
                });

                if (officialTranscriptLink) {
                    openOfficialTranscriptButton.href = officialTranscriptLink.href;
                    openOfficialTranscriptButton.style.display = 'inline-block';
                } else {
                    openOfficialTranscriptButton.style.display = 'none';
                }

                agendaPlaceholder.style.display = 'none';
                agendaContent.style.display = 'block';
            });
    }

    openTranscriptButton.addEventListener('click', (e) => {
        if (e.target.dataset.path) {
            window.open(e.target.dataset.path, '_blank');
        }
    });
});