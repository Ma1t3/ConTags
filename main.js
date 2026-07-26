// State
let contacts = [];
let allLabels = new Set();
let selectedLabels = new Set();
let currentDataSource = '';
let lastUpdated = null;

const DB_NAME = 'contags';
const DB_VERSION = 1;
const STORE_NAME = 'appData';
const CONTACTS_KEY = 'contacts';

// DOM Elements
const csvFileInput = document.getElementById('csvFileInput');
const searchInput = document.getElementById('searchInput');
const labelsList = document.getElementById('labelsList');
const contactsGrid = document.getElementById('contactsGrid');
const statusMessage = document.getElementById('statusMessage');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const googleImportBtn = document.getElementById('googleImportBtn');
const deleteContactsBtn = document.getElementById('deleteContactsBtn');
const storageInfo = document.getElementById('storageInfo');
const importMenuBtn = document.getElementById('importMenuBtn');
const importMenu = document.getElementById('importMenu');
const createContactBtn = document.getElementById('createContactBtn');
const contactDialog = document.getElementById('contactDialog');
const contactForm = document.getElementById('contactForm');
const closeContactDialogBtn = document.getElementById('closeContactDialogBtn');
const cancelContactBtn = document.getElementById('cancelContactBtn');
const contactFormError = document.getElementById('contactFormError');
const contactPhotoInput = document.getElementById('contactPhoto');
const contactPhotoPreview = document.getElementById('contactPhotoPreview');
const syncGoogleBtn = document.getElementById('syncGoogleBtn');
const syncCount = document.getElementById('syncCount');
const contactDialogTitle = document.getElementById('contactDialogTitle');
const contactDialogDescription = document.getElementById('contactDialogDescription');
const contactSubmitLabel = document.getElementById('contactSubmitLabel');
const settingsMenuBtn = document.getElementById('settingsMenuBtn');
const settingsMenu = document.getElementById('settingsMenu');
const openMapBtn = document.getElementById('openMapBtn');
const mapDialog = document.getElementById('mapDialog');
const closeMapBtn = document.getElementById('closeMapBtn');
const mapStatus = document.getElementById('mapStatus');
const unmappedContacts = document.getElementById('unmappedContacts');
const unmappedContactsList = document.getElementById('unmappedContactsList');
const mapProgress = document.getElementById('mapProgress');

const photoObjectUrls = new WeakMap();
let previewObjectUrl = null;
let editingContact = null;
let contactsMap = null;
let contactMarkers = null;
let geocodingActive = false;
let geocodingController = null;
const MAX_PHOTO_FILE_SIZE = 10 * 1024 * 1024;
const PHOTO_SIZE = 512;

// Google OAuth Data
// REPLACE THIS WITH YOUR CLIENT ID FROM GOOGLE CLOUD
const GOOGLE_CLIENT_ID = "39228748676-bvbke2lj8rqmtfcs5reidtoth573uvd5.apps.googleusercontent.com";
let tokenClient;
let googleAuthIntent = 'import';

// Debounce for search
let searchTimeout;

// Initialization
async function init() {
    csvFileInput.addEventListener('change', handleFileUpload);
    deleteContactsBtn.addEventListener('click', deleteLocalContacts);
    importMenuBtn.addEventListener('click', toggleImportMenu);
    settingsMenuBtn.addEventListener('click', toggleSettingsMenu);
    createContactBtn.addEventListener('click', () => openContactDialog());
    closeContactDialogBtn.addEventListener('click', closeContactDialog);
    cancelContactBtn.addEventListener('click', closeContactDialog);
    contactForm.addEventListener('submit', createContact);
    contactPhotoInput.addEventListener('change', previewSelectedPhoto);
    syncGoogleBtn.addEventListener('click', requestGoogleSync);
    openMapBtn.addEventListener('click', openContactMap);
    closeMapBtn.addEventListener('click', closeContactMap);
    mapDialog.addEventListener('click', closeMapFromBackdrop);
    contactDialog.addEventListener('click', closeDialogFromBackdrop);
    document.addEventListener('click', closeImportMenuFromOutside);

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(renderContacts, 300); // 300ms debounce
    });

    clearFiltersBtn.addEventListener('click', () => {
        selectedLabels.clear();
        document.querySelectorAll('.label-checkbox').forEach(cb => cb.checked = false);
        renderContacts();
    });

    // Initialize Google OAuth Token Client if library is loaded
    if (typeof google !== 'undefined') {
        initGoogleClient();
    } else {
        // Fallback wait for the external script
        window.addEventListener('load', initGoogleClient);
    }

    await restoreContacts();
}

function toggleImportMenu() {
    const willOpen = importMenu.hidden;
    closeSettingsMenu();
    importMenu.hidden = !willOpen;
    importMenuBtn.setAttribute('aria-expanded', String(willOpen));
}

function toggleSettingsMenu() {
    const willOpen = settingsMenu.hidden;
    closeImportMenu();
    settingsMenu.hidden = !willOpen;
    settingsMenuBtn.setAttribute('aria-expanded', String(willOpen));
}

function closeImportMenu() {
    importMenu.hidden = true;
    importMenuBtn.setAttribute('aria-expanded', 'false');
}

function closeSettingsMenu() {
    settingsMenu.hidden = true;
    settingsMenuBtn.setAttribute('aria-expanded', 'false');
}

function closeImportMenuFromOutside(event) {
    if (!event.target.closest('.dropdown')) {
        closeImportMenu();
        closeSettingsMenu();
    }
}

function openContactDialog(contact = null) {
    closeImportMenu();
    contactForm.reset();
    clearPhotoPreview();
    editingContact = contact;
    contactDialogTitle.textContent = contact ? 'Edit contact' : 'Create contact';
    contactDialogDescription.textContent = contact
        ? 'Changes are saved locally and can be synced with Google.'
        : 'Add a contact to your locally stored list.';
    contactSubmitLabel.textContent = contact ? 'Save changes' : 'Save contact';

    if (contact) {
        contactForm.elements.name.value = contact.name || '';
        contactForm.elements.email.value = contact.email || '';
        contactForm.elements.phone.value = contact.phone || '';
        contactForm.elements.address.value = contact.address || '';
        contactForm.elements.labels.value = (contact.labels || []).join(', ');
        showPhotoPreview(contact.photo ? getPhotoUrl(contact.photo) : contact.photoUrl);
    }
    contactFormError.hidden = true;
    contactDialog.showModal();
    document.getElementById('contactName').focus();
}

function closeContactDialog() {
    clearPhotoPreview();
    editingContact = null;
    contactDialog.close();
}

function closeDialogFromBackdrop(event) {
    if (event.target === contactDialog) closeContactDialog();
}

async function createContact(event) {
    event.preventDefault();
    contactFormError.hidden = true;

    const formData = new FormData(contactForm);
    const newValues = {
        name: formData.get('name').trim(),
        email: formData.get('email').trim(),
        phone: formData.get('phone').trim(),
        address: formData.get('address').trim(),
        labels: formData.get('labels')
            .split(',')
            .map(label => label.trim())
            .filter((label, index, labels) => label && labels.indexOf(label) === index),
        photo: editingContact ? editingContact.photo : null,
        photoUrl: editingContact ? editingContact.photoUrl : ''
    };

    if (!newValues.name) {
        contactFormError.textContent = 'Please enter a name.';
        contactFormError.hidden = false;
        return;
    }

    const photoFile = contactPhotoInput.files[0];
    if (photoFile) {
        try {
            newValues.photo = await preparePhoto(photoFile);
            newValues.photoUrl = '';
        } catch (error) {
            contactFormError.textContent = error.message;
            contactFormError.hidden = false;
            return;
        }
    }

    const contact = editingContact || {
        resourceName: '',
        etag: '',
        googleMetadata: null,
        syncStatus: 'pending-create',
        syncError: ''
    };
    const previousValues = editingContact
        ? { ...editingContact, labels: [...(editingContact.labels || [])] }
        : null;
    Object.assign(contact, newValues);

    if (!previousValues || normalizeAddress(previousValues.address) !== normalizeAddress(contact.address)) {
        contact.coordinates = null;
        contact.geocodedAddress = '';
        contact.geocodeStatus = '';
    }

    if (editingContact) {
        if (!contact.resourceName) {
            contact.syncStatus = 'pending-create';
        } else if (contact.syncStatus !== 'pending-create') {
            contact.syncStatus = 'pending-update';
        }
        if (photoFile) contact.photoNeedsSync = Boolean(contact.resourceName);
        contact.syncError = '';
    } else {
        contacts.push(contact);
    }
    contacts.sort((a, b) => a.name.localeCompare(b.name));
    rebuildLabels();
    enableContactsUi();
    renderLabels();
    renderContacts();

    try {
        await saveContacts(currentDataSource || 'manual');
        updateSyncUi();
        statusMessage.style.display = 'none';
        closeContactDialog();
    } catch (error) {
        if (previousValues) {
            Object.assign(contact, previousValues);
        } else {
            contacts.splice(contacts.indexOf(contact), 1);
        }
        rebuildLabels();
        renderLabels();
        renderContacts();
        console.error('Could not save the new contact:', error);
        contactFormError.textContent = 'The contact could not be stored locally.';
        contactFormError.hidden = false;
    }
}

function previewSelectedPhoto() {
    const file = contactPhotoInput.files[0];
    clearPhotoPreview();
    contactFormError.hidden = true;
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        contactFormError.textContent = 'Please choose a valid image file.';
        contactFormError.hidden = false;
        contactPhotoInput.value = '';
        return;
    }

    previewObjectUrl = URL.createObjectURL(file);
    showPhotoPreview(previewObjectUrl);
}

function showPhotoPreview(url) {
    if (!url) return;
    contactPhotoPreview.innerHTML = '';
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Selected contact photo';
    contactPhotoPreview.appendChild(image);
}

function clearPhotoPreview() {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    contactPhotoPreview.innerHTML = '<i class="ph ph-user"></i>';
}

async function preparePhoto(fileOrBlob) {
    if (fileOrBlob.type && !fileOrBlob.type.startsWith('image/')) {
        throw new Error('Please choose a valid image file.');
    }
    if (fileOrBlob.size > MAX_PHOTO_FILE_SIZE) {
        throw new Error('The photo must be smaller than 10 MB.');
    }

    const bitmap = await createImageBitmap(fileOrBlob);
    const scale = Math.min(1, PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(
        bitmap,
        0, 0, bitmap.width, bitmap.height,
        0, 0, targetWidth, targetHeight
    );
    bitmap.close();

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('The photo could not be processed.')),
            'image/jpeg',
            0.92
        );
    });
}

function getPhotoUrl(photo) {
    if (!photo) return '';
    if (!photoObjectUrls.has(photo)) {
        photoObjectUrls.set(photo, URL.createObjectURL(photo));
    }
    return photoObjectUrls.get(photo);
}

function getInitials(name) {
    const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function normalizeAddress(address) {
    return (address || '').trim().replace(/\s+/g, ' ');
}

function buildLocationCache() {
    const cache = new Map();
    contacts.forEach(contact => {
        const address = normalizeAddress(contact.address);
        if (address && (contact.coordinates || contact.geocodeStatus === 'not-found')) {
            cache.set(address, {
                coordinates: contact.coordinates || null,
                geocodedAddress: contact.geocodedAddress || address,
                geocodeStatus: contact.geocodeStatus || 'resolved'
            });
        }
    });
    return cache;
}

function applyCachedLocation(contact, cache) {
    const cached = cache.get(normalizeAddress(contact.address));
    if (cached) Object.assign(contact, cached);
}

async function openContactMap() {
    closeSettingsMenu();
    if (typeof L === 'undefined') {
        alert('The map library could not be loaded. Please check your internet connection.');
        return;
    }

    mapDialog.showModal();
    if (!contactsMap) {
        contactsMap = L.map('contactsMap').setView([51.1657, 10.4515], 6);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(contactsMap);
        contactMarkers = L.layerGroup().addTo(contactsMap);
    }

    setTimeout(() => contactsMap.invalidateSize(), 0);
    renderContactMap();
    await geocodeMissingAddresses();
}

function closeContactMap() {
    mapDialog.close();
}

function closeMapFromBackdrop(event) {
    if (event.target === mapDialog) closeContactMap();
}

function renderContactMap() {
    if (!contactsMap || !contactMarkers) return;
    contactMarkers.clearLayers();
    const markerCoordinates = [];

    contacts.forEach(contact => {
        if (!contact.coordinates) return;
        const latitude = Number(contact.coordinates.latitude);
        const longitude = Number(contact.coordinates.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        const popup = `
            <div class="map-contact-popup">
                <strong>${escapeHtml(contact.name)}</strong>
                <span>${escapeHtml(contact.address)}</span>
                ${contact.email ? `<span>${escapeHtml(contact.email)}</span>` : ''}
                ${contact.phone ? `<span>${escapeHtml(contact.phone)}</span>` : ''}
            </div>`;
        const photoUrl = contact.photo ? getPhotoUrl(contact.photo) : (contact.photoUrl || '');
        const markerContent = photoUrl
            ? `<img src="${escapeHtml(photoUrl)}" alt="" referrerpolicy="no-referrer">`
            : `<span>${escapeHtml(getInitials(contact.name))}</span>`;
        const syncClass = contact.syncStatus === 'synced' ? ' marker-synced' : '';
        const markerIcon = L.divIcon({
            className: 'contact-photo-marker-wrapper',
            html: `
                <div class="contact-photo-marker${syncClass}">
                    ${markerContent}
                </div>
                <div class="contact-marker-tip${syncClass}"></div>`,
            iconSize: [52, 60],
            iconAnchor: [26, 58],
            popupAnchor: [0, -52]
        });
        L.marker([latitude, longitude], {
            icon: markerIcon,
            title: contact.name
        }).bindPopup(popup).addTo(contactMarkers);
        markerCoordinates.push([latitude, longitude]);
    });

    if (markerCoordinates.length === 1) {
        contactsMap.setView(markerCoordinates[0], 14);
    } else if (markerCoordinates.length > 1) {
        contactsMap.fitBounds(markerCoordinates, { padding: [35, 35], maxZoom: 15 });
    }

    const unresolved = contacts.filter(contact =>
        !contact.coordinates && (contact.address || contact.geocodeStatus === 'not-found')
    );
    unmappedContactsList.innerHTML = '';
    unresolved.forEach(contact => {
        const item = document.createElement('li');
        const reason = contact.geocodeStatus === 'not-found' ? 'not found' : 'waiting';
        item.textContent = `${contact.name}: ${contact.address || 'No address'} (${reason})`;
        unmappedContactsList.appendChild(item);
    });
    unmappedContacts.hidden = unresolved.length === 0;

    const addressCount = contacts.filter(contact => contact.address).length;
    mapStatus.textContent =
        `${markerCoordinates.length} of ${addressCount} contact addresses shown on the map.`;
}

async function geocodeMissingAddresses() {
    if (geocodingActive) return;
    const queue = contacts.filter(contact => {
        const normalized = normalizeAddress(contact.address);
        return normalized &&
            !contact.coordinates &&
            contact.geocodedAddress !== normalized;
    });
    if (queue.length === 0) return;

    geocodingActive = true;
    mapProgress.hidden = false;
    let completed = 0;

    for (const contact of queue) {
        if (!geocodingActive) break;
        const progressText = `${completed + 1}/${queue.length}`;
        if (mapDialog.open) {
            mapStatus.textContent = `Resolving addresses (${progressText}) in the background...`;
        }

        geocodingController = new AbortController();
        const normalizedAddress = normalizeAddress(contact.address);
        try {
            const params = new URLSearchParams({
                q: normalizedAddress,
                format: 'jsonv2',
                limit: '1'
            });
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?${params}`,
                {
                    headers: { 'Accept-Language': navigator.language || 'en' },
                    signal: geocodingController.signal
                }
            );
            if (!response.ok) throw new Error(`Geocoding failed (${response.status})`);
            const results = await response.json();
            contact.geocodedAddress = normalizedAddress;
            if (results.length > 0) {
                contact.coordinates = {
                    latitude: Number(results[0].lat),
                    longitude: Number(results[0].lon)
                };
                contact.geocodeStatus = 'resolved';
            } else {
                contact.coordinates = null;
                contact.geocodeStatus = 'not-found';
            }
            await saveContacts(currentDataSource || 'manual');
            if (mapDialog.open) renderContactMap();
        } catch (error) {
            if (error.name === 'AbortError') break;
            console.warn(`Could not resolve address for ${contact.name}:`, error);
            mapProgress.hidden = true;
            if (mapDialog.open) {
                mapStatus.textContent = `${error.message}. Reopen the map to retry.`;
            }
            break;
        }

        completed += 1;
        if (completed < queue.length) await wait(1100);
    }

    geocodingActive = false;
    geocodingController = null;
    if (completed === queue.length) {
        mapProgress.hidden = true;
        statusMessage.textContent = `${completed} map location(s) resolved in the background.`;
        statusMessage.style.display = 'block';
    }
    if (mapDialog.open) renderContactMap();
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Local persistence
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveContacts(source) {
    const savedAt = new Date().toISOString();
    const db = await openDatabase();

    await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put({
            contacts,
            source,
            savedAt
        }, CONTACTS_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });

    db.close();
    currentDataSource = source;
    lastUpdated = savedAt;
    updateStorageInfo();
}

async function readSavedContacts() {
    const db = await openDatabase();
    const savedData = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly')
            .objectStore(STORE_NAME)
            .get(CONTACTS_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return savedData;
}

async function restoreContacts() {
    try {
        const savedData = await readSavedContacts();
        if (!savedData || !Array.isArray(savedData.contacts)) {
            updateStorageInfo();
            return;
        }

        contacts = savedData.contacts;
        currentDataSource = savedData.source || '';
        lastUpdated = savedData.savedAt || null;
        rebuildLabels();
        enableContactsUi();
        renderLabels();
        renderContacts();
        statusMessage.style.display = 'none';
        updateStorageInfo();
    } catch (error) {
        console.error('Could not restore local contacts:', error);
        storageInfo.textContent = 'Local storage is unavailable in this browser.';
    }
}

async function deleteLocalContacts() {
    closeSettingsMenu();
    if (!confirm('Delete all locally stored contacts from this device?')) return;

    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).delete(CONTACTS_KEY);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        db.close();

        contacts = [];
        allLabels.clear();
        selectedLabels.clear();
        currentDataSource = '';
        lastUpdated = null;
        searchInput.value = '';
        searchInput.disabled = true;
        clearFiltersBtn.disabled = true;
        deleteContactsBtn.disabled = true;
        labelsList.innerHTML = '<p class="empty-state-text">No labels loaded</p>';
        contactsGrid.innerHTML = '';
        statusMessage.textContent = 'Please load a contacts CSV file to begin.';
        statusMessage.style.display = 'block';
        csvFileInput.value = '';
        updateStorageInfo();
    } catch (error) {
        console.error('Could not delete local contacts:', error);
        alert('The locally stored contacts could not be deleted.');
    }
}

function rebuildLabels() {
    allLabels.clear();
    selectedLabels.clear();
    contacts.forEach(contact => {
        (contact.labels || []).forEach(label => allLabels.add(label));
    });
}

function enableContactsUi() {
    searchInput.disabled = false;
    clearFiltersBtn.disabled = false;
    deleteContactsBtn.disabled = false;
}

function updateStorageInfo() {
    if (!contacts.length || !lastUpdated) {
        storageInfo.textContent = 'Contacts are stored only on this device.';
        deleteContactsBtn.disabled = true;
        updateSyncUi();
        return;
    }

    const sourceNames = {
        google: 'Google Contacts',
        csv: 'CSV',
        manual: 'Created locally'
    };
    const source = sourceNames[currentDataSource] || 'Local';
    const date = new Date(lastUpdated).toLocaleString();
    storageInfo.textContent = `${contacts.length} contacts stored locally · ${source} · ${date}`;
    deleteContactsBtn.disabled = false;
    updateSyncUi();
}

function getPendingSyncContacts() {
    return contacts.filter(contact =>
        contact.syncStatus === 'pending-create' ||
        contact.syncStatus === 'pending-update' ||
        contact.syncStatus === 'pending-photo'
    );
}

function updateSyncUi() {
    const pendingCount = getPendingSyncContacts().length;
    syncGoogleBtn.disabled = pendingCount === 0;
    syncCount.hidden = pendingCount === 0;
    syncCount.textContent = pendingCount;
}

// Google OAuth Initialization & Handling
function initGoogleClient() {
    if (typeof google === 'undefined') return;

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/contacts',
        callback: async (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                if (googleAuthIntent === 'sync') {
                    await syncPendingContacts(tokenResponse.access_token);
                } else {
                    await fetchGoogleContacts(tokenResponse.access_token);
                }
            } else if (tokenResponse && tokenResponse.error) {
                statusMessage.textContent = `Google authorization failed: ${tokenResponse.error}`;
                statusMessage.style.display = 'block';
                updateSyncUi();
            }
        },
    });

    googleImportBtn.addEventListener('click', () => {
        closeImportMenu();
        googleAuthIntent = 'import';
        if (GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com") {
            // Give user friendly alert if they forgot to paste their ID
            alert("Oops! You haven't added your Google Client ID into main.js yet. Please open main.js and paste your Client ID at line 14.");
            return;
        }

        // Request an access token
        tokenClient.requestAccessToken();
    });
}

function requestGoogleSync() {
    closeSettingsMenu();
    if (!tokenClient) {
        alert('Google sign-in is not ready yet. Please try again in a moment.');
        return;
    }
    googleAuthIntent = 'sync';
    tokenClient.requestAccessToken();
}

async function syncPendingContacts(accessToken) {
    const pendingContacts = getPendingSyncContacts();
    if (pendingContacts.length === 0) return;

    syncGoogleBtn.disabled = true;
    let syncedCount = 0;
    let failedCount = 0;

    for (const contact of pendingContacts) {
        statusMessage.textContent =
            `Syncing with Google (${syncedCount + failedCount + 1}/${pendingContacts.length})...`;
        statusMessage.style.display = 'block';
        contact.syncError = '';

        try {
            if (contact.syncStatus === 'pending-create') {
                const createdPerson = await createGoogleContact(contact, accessToken);
                contact.resourceName = createdPerson.resourceName;
                contact.etag = createdPerson.etag || '';
                contact.googleMetadata = createdPerson.metadata || null;
                contact.syncStatus = contact.photo ? 'pending-photo' : 'synced';
                await saveContacts(currentDataSource || 'manual');
            }

            if (contact.syncStatus === 'pending-update') {
                const updatedPerson = await updateGoogleContact(contact, accessToken);
                contact.etag = updatedPerson.etag || contact.etag;
                contact.googleMetadata = updatedPerson.metadata || contact.googleMetadata;
                contact.syncStatus = contact.photoNeedsSync ? 'pending-photo' : 'synced';
                await saveContacts(currentDataSource || 'manual');
            }

            if (contact.syncStatus === 'pending-photo' && contact.photo) {
                const updatedPerson = await uploadGoogleContactPhoto(contact, accessToken);
                if (updatedPerson) contact.etag = updatedPerson.etag || contact.etag;
                contact.syncStatus = 'synced';
                contact.photoNeedsSync = false;
            }

            contact.lastSyncedAt = new Date().toISOString();
            syncedCount += 1;
        } catch (error) {
            contact.syncError = error.message;
            failedCount += 1;
            console.error(`Could not sync ${contact.name}:`, error);
        }

        await saveContacts(currentDataSource || 'manual');
    }

    renderContacts();
    updateSyncUi();
    if (failedCount > 0) {
        statusMessage.textContent =
            `${syncedCount} contact(s) synced; ${failedCount} failed. You can retry.`;
    } else {
        statusMessage.textContent = `${syncedCount} contact(s) synced with Google.`;
    }
    statusMessage.style.display = 'block';
}

async function createGoogleContact(contact, accessToken) {
    const person = {
        names: [{ unstructuredName: contact.name }]
    };
    if (contact.email) person.emailAddresses = [{ value: contact.email }];
    if (contact.phone) person.phoneNumbers = [{ value: contact.phone }];
    if (contact.address) person.addresses = [{ formattedValue: contact.address }];

    const response = await fetch(
        'https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses,phoneNumbers,addresses,metadata',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(person)
        }
    );

    if (!response.ok) throw await googleApiError(response, 'Could not create the Google contact');
    return response.json();
}

async function updateGoogleContact(contact, accessToken) {
    if (!contact.googleMetadata) {
        const latestResponse = await fetch(
            `https://people.googleapis.com/v1/${contact.resourceName}?personFields=metadata`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (!latestResponse.ok) {
            throw await googleApiError(latestResponse, 'Could not read the Google contact before updating');
        }
        const latestPerson = await latestResponse.json();
        contact.googleMetadata = latestPerson.metadata;
    }

    const person = {
        resourceName: contact.resourceName,
        metadata: contact.googleMetadata,
        names: [{ unstructuredName: contact.name }],
        emailAddresses: contact.email ? [{ value: contact.email }] : [],
        phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
        addresses: contact.address ? [{ formattedValue: contact.address }] : []
    };

    const fields = 'names,emailAddresses,phoneNumbers,addresses';
    const response = await fetch(
        `https://people.googleapis.com/v1/${contact.resourceName}:updateContact` +
        `?updatePersonFields=${fields}&personFields=${fields},metadata`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(person)
        }
    );

    if (!response.ok) throw await googleApiError(response, 'Could not update the Google contact');
    return response.json();
}

async function uploadGoogleContactPhoto(contact, accessToken) {
    const photoBytes = await blobToBase64(contact.photo);
    const response = await fetch(
        `https://people.googleapis.com/v1/${contact.resourceName}:updateContactPhoto`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                photoBytes,
                personFields: 'metadata,photos'
            })
        }
    );

    if (!response.ok) throw await googleApiError(response, 'Contact created, but photo upload failed');
    const result = await response.json();
    return result.person || null;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('The profile photo could not be encoded.'));
        reader.readAsDataURL(blob);
    });
}

async function googleApiError(response, fallbackMessage) {
    try {
        const body = await response.json();
        const message = body && body.error && body.error.message;
        return new Error(message || `${fallbackMessage} (${response.status})`);
    } catch (error) {
        return new Error(`${fallbackMessage} (${response.status})`);
    }
}

// Fetch Google People API
async function fetchGoogleContacts(accessToken) {
    statusMessage.textContent = 'Fetching Google Contacts...';
    statusMessage.style.display = 'block';
    contactsGrid.innerHTML = '';

    try {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        };

        // 1. Fetch Contact Groups (Labels) to map hex IDs to human-readable names
        statusMessage.textContent = 'Fetching Labels...';
        const groupsResponse = await fetch('https://people.googleapis.com/v1/contactGroups', { headers });
        if (!groupsResponse.ok) throw new Error('Failed to fetch contact groups');
        const groupsData = await groupsResponse.json();
        
        const labelMap = {};
        if (groupsData.contactGroups) {
            groupsData.contactGroups.forEach(g => {
                labelMap[g.resourceName] = g.formattedName || g.name;
            });
        }

        // 2. Fetch Contacts
        statusMessage.textContent = 'Fetching Contacts...';
        const response = await fetch(
            'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,addresses,memberships,photos,metadata&pageSize=2000',
            { headers }
        );

        if (!response.ok) throw new Error('Failed to fetch contacts');
        const data = await response.json();

        await processGoogleData(data.connections || [], labelMap);
        statusMessage.style.display = 'none';

    } catch (error) {
        statusMessage.textContent = `Error: ${error.message}`;
    }
}

// Process Data from Google API Format
async function processGoogleData(connections, labelMap) {
    const locationCache = buildLocationCache();
    contacts = [];
    allLabels.clear();
    selectedLabels.clear();

    connections.forEach(connection => {
        // Name
        const nameList = connection.names || [];
        const name = nameList.length > 0 ? nameList[0].displayName : "No Name";

        // Email
        const emails = connection.emailAddresses || [];
        const email = emails.length > 0 ? emails[0].value : "";

        // Phone
        const phones = connection.phoneNumbers || [];
        const phone = phones.length > 0 ? phones[0].canonicalForm || phones[0].value : "";
        const addresses = connection.addresses || [];
        const address = addresses.length > 0 ? formatGoogleAddress(addresses[0]) : '';
        const photos = connection.photos || [];
        const profilePhoto = photos.find(photo => photo.url && !photo.default);
        const googlePhotoUrl = profilePhoto ? profilePhoto.url : '';

        // Labels / Memberships
        const labelList = [];
        const memberships = connection.memberships || [];

        memberships.forEach(membership => {
            const group = membership.contactGroupMembership;
            if (group && group.contactGroupResourceName) {
                // Map the resourceName (e.g., contactGroups/123) to human readable string
                const readableName = labelMap[group.contactGroupResourceName];
                
                if (readableName) {
                    if (!readableName.toLowerCase().includes("mycontacts") && !readableName.toLowerCase().includes("my contacts")) {
                        labelList.push(readableName);
                        allLabels.add(readableName);
                    }
                } else {
                    // Fallback to hex ID 
                    const hexId = group.contactGroupResourceName.split("/").pop();
                    if (hexId && !hexId.toLowerCase().includes("mycontacts")) {
                        labelList.push(hexId);
                        allLabels.add(hexId);
                    }
                }
            }
        });

        const importedContact = {
            name: name,
            email: email,
            phone: phone,
            address,
            labels: labelList,
            photo: null,
            photoUrl: '',
            googlePhotoUrl,
            resourceName: connection.resourceName || '',
            etag: connection.etag || '',
            googleMetadata: connection.metadata || null,
            syncStatus: 'synced',
            syncError: '',
            lastSyncedAt: new Date().toISOString()
        };
        applyCachedLocation(importedContact, locationCache);
        contacts.push(importedContact);
    });

    const contactsWithPhotos = contacts.filter(contact => contact.googlePhotoUrl);
    if (contactsWithPhotos.length > 0) {
        statusMessage.textContent = `Fetching profile photos (0/${contactsWithPhotos.length})...`;
        let completedPhotos = 0;
        let importedPhotos = 0;

        await runWithConcurrency(contactsWithPhotos, 6, async contact => {
            contact.photo = await fetchGooglePhoto(contact.googlePhotoUrl);
            if (contact.photo) {
                importedPhotos += 1;
            } else {
                // The Google URL still displays the photo if CORS prevents a local copy.
                contact.photoUrl = contact.googlePhotoUrl;
            }
            delete contact.googlePhotoUrl;
            completedPhotos += 1;
            statusMessage.textContent =
                `Importing profile photos (${importedPhotos} saved, ${completedPhotos}/${contactsWithPhotos.length} checked)...`;
        });
    }
    contacts.forEach(contact => delete contact.googlePhotoUrl);

    // Sort contacts by name
    contacts.sort((a, b) => a.name.localeCompare(b.name));

    // Enable UI
    enableContactsUi();

    // Render Sidebars & Contacts
    renderLabels();
    renderContacts();
    await persistImportedContacts('google');
}

function formatGoogleAddress(address) {
    if (address.formattedValue) return address.formattedValue;
    return [
        address.streetAddress,
        address.postalCode,
        address.city,
        address.region,
        address.country
    ].filter(Boolean).join(', ');
}

async function fetchGooglePhoto(url) {
    try {
        const separator = url.includes('?') ? '&' : '?';
        const response = await fetch(`${url}${separator}sz=${PHOTO_SIZE}`);
        if (!response.ok) return null;
        return await preparePhoto(await response.blob());
    } catch (error) {
        console.warn('Could not import a Google profile photo:', error);
        return null;
    }
}

async function runWithConcurrency(items, limit, task) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex];
            nextIndex += 1;
            await task(item);
        }
    });
    await Promise.all(workers);
}

// File Upload & Parsing
function handleFileUpload(event) {
    closeImportMenu();
    const file = event.target.files[0];
    if (!file) return;

    statusMessage.textContent = 'Parsing CSV...';
    statusMessage.style.display = 'block';
    contactsGrid.innerHTML = '';

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async function (results) {
            await processParsedData(results.data);
            csvFileInput.value = '';
        },
        error: function (error) {
            statusMessage.textContent = `Error reading File: ${error.message}`;
        }
    });
}

// Data Processing (Matches Python Logic)
async function processParsedData(data) {
    const locationCache = buildLocationCache();
    contacts = [];
    allLabels.clear();
    selectedLabels.clear();

    data.forEach(row => {
        // Build Name
        const first = (row["First Name"] || "").trim();
        const middle = (row["Middle Name"] || "").trim();
        const last = (row["Last Name"] || "").trim();
        let fullName = [first, middle, last].filter(Boolean).join(" ").trim();

        if (!fullName) {
            fullName = (row["Name"] || row["Full Name"] || "").trim();
        }

        const email = (row["E-mail 1 - Value"] || "").trim();
        const phone = (row["Phone 1 - Value"] || "").trim();
        const address = getCsvAddress(row);

        // Process Labels
        const rawLabels = row["Labels"] || "";
        const labelList = [];

        if (rawLabels) {
            // Split by comma
            const parts = rawLabels.split(/\s*,\s*/);
            parts.forEach(part => {
                // Split by ":::"
                const subParts = part.split(":::");
                subParts.forEach(sub => {
                    const lbl = sub.trim();
                    if (lbl && lbl !== "* myContacts") {
                        labelList.push(lbl);
                        allLabels.add(lbl);
                    }
                });
            });
        }

        const importedContact = {
            name: fullName,
            email: email,
            phone: phone,
            address,
            labels: labelList
        };
        applyCachedLocation(importedContact, locationCache);
        contacts.push(importedContact);
    });

    // Sort contacts by name
    contacts.sort((a, b) => a.name.localeCompare(b.name));

    // Enable UI
    enableContactsUi();

    // Render Sidebars & Contacts
    renderLabels();
    renderContacts();
    await persistImportedContacts('csv');
}

function getCsvAddress(row) {
    const formatted = (
        row["Address 1 - Formatted"] ||
        row["Address"] ||
        row["Full Address"] ||
        ""
    ).trim();
    if (formatted) return formatted;

    return [
        row["Address 1 - Street"],
        row["Address 1 - Postal Code"],
        row["Address 1 - City"],
        row["Address 1 - Region"],
        row["Address 1 - Country"]
    ].map(value => (value || '').trim()).filter(Boolean).join(', ');
}

async function persistImportedContacts(source) {
    try {
        await saveContacts(source);
        statusMessage.style.display = 'none';
    } catch (error) {
        console.error('Could not save contacts locally:', error);
        statusMessage.textContent = 'Contacts loaded, but could not be stored locally.';
        statusMessage.style.display = 'block';
    }
}

// Render Labels Sidebar
function renderLabels() {
    labelsList.innerHTML = '';
    const sortedLabels = Array.from(allLabels).sort();

    if (sortedLabels.length === 0) {
        labelsList.innerHTML = '<p class="empty-state-text">No labels found.</p>';
        return;
    }

    sortedLabels.forEach(lbl => {
        const labelEl = document.createElement('label');
        labelEl.className = 'label-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'label-checkbox';
        checkbox.value = lbl;

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedLabels.add(lbl);
            } else {
                selectedLabels.delete(lbl);
            }
            renderContacts();
        });

        const textSpan = document.createElement('span');
        textSpan.className = 'label-text';
        textSpan.textContent = lbl;
        textSpan.title = lbl; // tooltip for long labels

        labelEl.appendChild(checkbox);
        labelEl.appendChild(textSpan);
        labelsList.appendChild(labelEl);
    });
}

// Highlight function mimicking the Python highlight logic
function highlightText(text, query) {
    if (!text) return '';
    if (!query) return escapeHtml(text);

    // Escape regex characters in query
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    // Split text by regex, escape parts to prevent XSS, wrap matches in <span class="highlight">
    const parts = text.split(regex);
    return parts.map(part => {
        if (part.toLowerCase() === query.toLowerCase()) {
            return `<span class="highlight">${escapeHtml(part)}</span>`;
        } else {
            return escapeHtml(part);
        }
    }).join('');
}

// Simple HTML escaper
function escapeHtml(unsafe) {
    return (unsafe || "").toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Filter and Render Contacts
function renderContacts() {
    const query = (searchInput.value || "").trim().toLowerCase();

    // Filtering logic
    const filtered = contacts.filter(c => {
        const name = (c.name || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const phone = (c.phone || "").toLowerCase();
        const address = (c.address || "").toLowerCase();

        // Label Filter (AND logic)
        if (selectedLabels.size > 0) {
            const hasAllLabels = Array.from(selectedLabels).every(lbl => c.labels.includes(lbl));
            if (!hasAllLabels) return false;
        }

        // Search Filter
        if (query) {
            if (
                !name.includes(query) &&
                !email.includes(query) &&
                !phone.includes(query) &&
                !address.includes(query)
            ) {
                return false;
            }
        }

        return true;
    });

    // UI Updating
    contactsGrid.innerHTML = '';

    if (filtered.length === 0 && contacts.length > 0) {
        contactsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
                <i class="ph ph-magnifying-glass" style="font-size: 3rem; opacity: 0.5; margin-bottom: 1rem;"></i>
                <p>No contacts found matching your criteria.</p>
            </div>`;
        return;
    }

    filtered.forEach((c, index) => {
        const card = document.createElement('div');
        card.className = 'contact-card';
        // Give staggered animations
        card.style.animationDelay = `${(index % 10) * 0.05}s`;

        // Card Content Building
        const photoUrl = c.photo ? getPhotoUrl(c.photo) : (c.photoUrl || '');
        const avatar = photoUrl
            ? `<div class="card-avatar"><img src="${escapeHtml(photoUrl)}" alt="" referrerpolicy="no-referrer"></div>`
            : `<div class="card-avatar card-avatar-fallback" aria-hidden="true">${escapeHtml(getInitials(c.name))}</div>`;
        let syncIndicator = '';
        if (c.syncError) {
            syncIndicator = `
                <span class="card-sync-indicator sync-error" role="img"
                      aria-label="Google sync failed" title="${escapeHtml(c.syncError)}">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        } else if (
            c.syncStatus === 'pending-create' ||
            c.syncStatus === 'pending-update' ||
            c.syncStatus === 'pending-photo'
        ) {
            syncIndicator = `
                <span class="card-sync-indicator sync-pending" role="img"
                      aria-label="Pending Google sync" title="Pending Google sync">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        } else if (c.syncStatus === 'synced') {
            syncIndicator = `
                <span class="card-sync-indicator sync-complete" role="img"
                      aria-label="Synced with Google" title="Synced with Google">
                    <i class="ph ph-check"></i>
                </span>`;
        }
        let innerHTML = `
            <div class="card-heading">
                ${avatar}
                <div class="card-name">${highlightText(c.name, query)}</div>
            </div>
            ${syncIndicator}`;

        if (c.email) {
            innerHTML += `
                <div class="card-info">
                    <i class="ph ph-envelope-simple"></i>
                    <span>${highlightText(c.email, query)}</span>
                </div>`;
        }

        if (c.phone) {
            innerHTML += `
                <div class="card-info">
                    <i class="ph ph-phone"></i>
                    <span>${highlightText(c.phone, query)}</span>
                </div>`;
        }

        if (c.address) {
            innerHTML += `
                <div class="card-info card-address">
                    <i class="ph ph-map-pin"></i>
                    <span>${highlightText(c.address, query)}</span>
                </div>`;
        }

        if (c.labels && c.labels.length > 0) {
            innerHTML += `<div class="card-labels">`;
            c.labels.forEach(lbl => {
                innerHTML += `<span class="card-label-tag">${escapeHtml(lbl)}</span>`;
            });
            innerHTML += `</div>`;
        }

        innerHTML += `
            <button class="card-edit-button" type="button" aria-label="Edit ${escapeHtml(c.name)}">
                <i class="ph ph-pencil-simple"></i>
            </button>`;
        card.innerHTML = innerHTML;
        card.querySelector('.card-edit-button').addEventListener('click', () => openContactDialog(c));
        contactsGrid.appendChild(card);
    });
}

// Run init
init();
