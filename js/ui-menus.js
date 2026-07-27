import {
    importMenuBtn, importMenu, settingsMenuBtn, settingsMenu,
    sidebar, mobileLabelsToggle, closeMobileLabelsBtn,
    doneMobileLabelsBtn, labelSearchInput
} from './dom.js';

export function closeImportMenu() {
    importMenu.hidden = true;
    importMenuBtn.setAttribute('aria-expanded', 'false');
}

export function closeSettingsMenu() {
    settingsMenu.hidden = true;
    settingsMenuBtn.setAttribute('aria-expanded', 'false');
}

export function initializeMenus({ renderLabels }) {
    function openMobileLabels() {
        sidebar.classList.add('mobile-expanded');
        mobileLabelsToggle.setAttribute('aria-expanded', 'true');
        document.body.classList.add('labels-panel-open');
        labelSearchInput.focus();
    }

    function closeMobileLabels() {
        sidebar.classList.remove('mobile-expanded');
        mobileLabelsToggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('labels-panel-open');
        labelSearchInput.value = '';
        renderLabels();
    }

    importMenuBtn.addEventListener('click', () => {
        const willOpen = importMenu.hidden;
        closeSettingsMenu();
        importMenu.hidden = !willOpen;
        importMenuBtn.setAttribute('aria-expanded', String(willOpen));
    });

    settingsMenuBtn.addEventListener('click', () => {
        const willOpen = settingsMenu.hidden;
        closeImportMenu();
        settingsMenu.hidden = !willOpen;
        settingsMenuBtn.setAttribute('aria-expanded', String(willOpen));
    });

    mobileLabelsToggle.addEventListener('click', openMobileLabels);
    closeMobileLabelsBtn.addEventListener('click', closeMobileLabels);
    doneMobileLabelsBtn.addEventListener('click', closeMobileLabels);
    labelSearchInput.addEventListener('input', renderLabels);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && sidebar.classList.contains('mobile-expanded')) {
            closeMobileLabels();
        }
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.dropdown')) {
            closeImportMenu();
            closeSettingsMenu();
        }
    });
}
