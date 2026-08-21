const ENABLED_KEY = 'contagsBirthdayNotifications';
const PERIODIC_TAG = 'contags-birthday-check';

function isEnabled() {
    return 'Notification' in window &&
        localStorage.getItem(ENABLED_KEY) === 'true' &&
        Notification.permission === 'granted';
}

function updateLabel(label) {
    if (!label) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        label.textContent = 'Birthday reminders unavailable';
        return;
    }
    label.textContent = isEnabled() ? 'Disable birthday reminders' : 'Enable birthday reminders';
}

async function sendBirthdays(contacts, checkNow = false) {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting;
    if (!worker) return;
    worker.postMessage({
        type: 'SYNC_BIRTHDAYS',
        enabled: isEnabled(),
        checkNow,
        birthdays: contacts
            .filter(contact => contact.name && contact.birthday)
            .map(contact => ({ name: contact.name, birthday: contact.birthday }))
    });
}

async function registerPeriodicCheck() {
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return;
    try {
        await registration.periodicSync.register(PERIODIC_TAG, { minInterval: 24 * 60 * 60 * 1000 });
    } catch (error) {
        console.info('Periodic birthday checks are not available:', error);
    }
}

async function unregisterPeriodicCheck() {
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return;
    try { await registration.periodicSync.unregister(PERIODIC_TAG); } catch (error) { /* unsupported */ }
}

export async function initializeBirthdayNotifications(contacts, label) {
    updateLabel(label);
    if (!isEnabled()) return;
    await sendBirthdays(contacts, true);
    await registerPeriodicCheck();
}

export async function toggleBirthdayNotifications(contacts, label) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        alert('Birthday reminders are not supported by this browser.');
        return;
    }
    if (isEnabled()) {
        localStorage.setItem(ENABLED_KEY, 'false');
        await sendBirthdays(contacts);
        await unregisterPeriodicCheck();
        updateLabel(label);
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        updateLabel(label);
        alert('Please allow notifications in the browser settings to enable birthday reminders.');
        return;
    }
    localStorage.setItem(ENABLED_KEY, 'true');
    await sendBirthdays(contacts, true);
    await registerPeriodicCheck();
    updateLabel(label);
}

export async function syncBirthdayNotifications(contacts) {
    if (isEnabled()) await sendBirthdays(contacts, true);
}
