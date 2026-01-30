const DARK_MODE_KEY = 'darkModeEnabled';

function applyDarkMode(isEnabled) {
    document.documentElement.classList.toggle('dark-mode', isEnabled);
    if (document.body) {
        document.body.classList.toggle('dark-mode', isEnabled);
    }
}

function initDarkModeFromStorage() {
    const isEnabled = localStorage.getItem(DARK_MODE_KEY) === 'true';
    applyDarkMode(isEnabled);
}

function setDarkMode(isEnabled) {
    localStorage.setItem(DARK_MODE_KEY, String(isEnabled));
    applyDarkMode(isEnabled);
}

(function bootstrapTheme() {
    const isEnabled = localStorage.getItem(DARK_MODE_KEY) === 'true';
    document.documentElement.classList.toggle('dark-mode', isEnabled);
    if (document.body) {
        document.body.classList.toggle('dark-mode', isEnabled);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.classList.toggle('dark-mode', isEnabled);
        });
    }
})();

window.applyDarkMode = applyDarkMode;
window.initDarkModeFromStorage = initDarkModeFromStorage;
window.setDarkMode = setDarkMode;

