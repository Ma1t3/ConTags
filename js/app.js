import { GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID } from './config.js';
import {
    csvFileInput, searchInput, labelsList, contactsGrid, statusMessage,
    clearFiltersBtn, googleImportBtn, deleteContactsBtn, storageInfo,
    createContactBtn, contactDialog, contactForm,
    closeContactDialogBtn, cancelContactBtn, contactFormError, contactPhotoInput,
    contactPhotoPreview, syncGoogleBtn, syncCount, contactDialogTitle,
    contactDialogDescription, contactSubmitLabel,
    openMapBtn, resultsSummary, sidebarResultCount, contactDetailsDialog,
    closeContactDetailsBtn, contactDetailsBody, editContactFromDetailsBtn,
    microsoftImportBtn, syncMicrosoftBtn, microsoftSyncCount,
    vcardFileInput, exportVcardBtn, addLabelGroupBtn
} from './dom.js';
import { preparePhoto, getPhotoUrl } from './image-utils.js';
import { escapeHtml, getInitials, normalizeAddress } from './text-utils.js';
import { writeContacts, readContacts, removeContacts } from './storage.js';
import {
    createGoogleContact, updateGoogleContact, uploadGoogleContactPhoto,
    fetchGooglePhoto, runWithConcurrency
} from './google-api.js';
import {
    fetchMicrosoftContacts, microsoftContactToLocal,
    createMicrosoftContact, updateMicrosoftContact
} from './microsoft-api.js';
import { parseVcards, exportVcards } from './vcard.js';
import { parseCsvContacts } from './csv-utils.js';
import { initializeContactMap } from './contact-map.js';
import { initializeMenus, closeImportMenu, closeSettingsMenu } from './ui-menus.js';
import { createContactRenderer } from './contact-renderer.js';

// State
let contacts = [];
let allLabels = new Set();
let selectedLabels = new Set();
let currentDataSource = '';
let lastUpdated = null;
let previewObjectUrl = null;
let editingContact = null;
let viewingContact = null;
let labelGroups = [];
let ungroupedCollapsed = false;

// Google OAuth Data
let tokenClient;
let googleAuthIntent = 'import';
let microsoftClient;

// Debounce for search
let searchTimeout;

const contactRenderer = createContactRenderer({
    getContacts: () => contacts,
    getLabels: () => allLabels,
    getSelectedLabels: () => selectedLabels,
    openContactDetails,
    getLabelGroups: () => labelGroups,
    getUngroupedCollapsed: () => ungroupedCollapsed,
    moveLabelToGroup,
    toggleLabelGroup
});
const { renderLabels, renderContacts } = contactRenderer;

// Initialization
async function init() {
    csvFileInput.addEventListener('change', handleFileUpload);
    vcardFileInput.addEventListener('change', handleVcardUpload);
    exportVcardBtn.addEventListener('click', exportContactsAsVcard);
    deleteContactsBtn.addEventListener('click', deleteLocalContacts);
    createContactBtn.addEventListener('click', () => openContactDialog());
    closeContactDialogBtn.addEventListener('click', closeContactDialog);
    cancelContactBtn.addEventListener('click', closeContactDialog);
    contactForm.addEventListener('submit', createContact);
    contactPhotoInput.addEventListener('change', previewSelectedPhoto);
    syncGoogleBtn.addEventListener('click', requestGoogleSync);
    syncMicrosoftBtn.addEventListener('click', requestMicrosoftSync);
    microsoftImportBtn.addEventListener('click', requestMicrosoftImport);
    const contactMap = initializeContactMap({
        getContacts: () => contacts,
        saveContacts,
        getCurrentDataSource: () => currentDataSource,
        closeSettingsMenu
    });
    openMapBtn.addEventListener('click', contactMap.openMap);
    closeContactDetailsBtn.addEventListener('click', closeContactDetails);
    editContactFromDetailsBtn.addEventListener('click', editContactFromDetails);
    contactDetailsDialog.addEventListener('click', closeDetailsFromBackdrop);
    contactDetailsDialog.addEventListener('close', () => {
        viewingContact = null;
    });
    contactDialog.addEventListener('click', closeDialogFromBackdrop);
    initializeMenus({ renderLabels });

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(renderContacts, 300); // 300ms debounce
    });

    clearFiltersBtn.addEventListener('click', () => {
        selectedLabels.clear();
        renderLabels();
        renderContacts();
    });
    addLabelGroupBtn.addEventListener('click', createLabelGroup);

    // Initialize Google OAuth Token Client if library is loaded
    if (typeof google !== 'undefined') {
        initGoogleClient();
    } else {
        // Fallback wait for the external script
        window.addEventListener('load', initGoogleClient);
    }
    if (typeof msal !== 'undefined') initMicrosoftClient();
    else window.addEventListener('load', initMicrosoftClient);

    await restoreContacts();
}

function openContactDialog(contact = null) {
    closeImportMenu();
    contactForm.reset();
    clearPhotoPreview();
    editingContact = contact;
    contactDialogTitle.textContent = contact ? 'Edit contact' : 'Create contact';
    contactDialogDescription.textContent = contact
        ? 'Changes are saved locally and can be synced with its contact provider.'
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

function openContactDetails(contact) {
    viewingContact = contact;
    const photoUrl = contact.photo ? getPhotoUrl(contact.photo) : (contact.photoUrl || '');
    const avatar = photoUrl
        ? `<div class="details-avatar"><img src="${escapeHtml(photoUrl)}" alt="" referrerpolicy="no-referrer"></div>`
        : `<div class="details-avatar details-avatar-fallback" aria-hidden="true">${escapeHtml(getInitials(contact.name))}</div>`;

    let syncText = 'Local only';
    let syncClass = 'detail-sync-local';
    const syncProviderName = contact.syncProvider === 'microsoft' ? 'Microsoft' : 'Google';
    if (contact.syncError) {
        syncText = `${syncProviderName} sync failed`;
        syncClass = 'detail-sync-error';
    } else if (
        contact.syncStatus === 'pending-create' ||
        contact.syncStatus === 'pending-update' ||
        contact.syncStatus === 'pending-photo'
    ) {
        syncText = contact.syncProvider
            ? `Pending ${syncProviderName} sync`
            : 'Pending provider sync';
        syncClass = 'detail-sync-pending';
    } else if (contact.syncStatus === 'synced') {
        syncText = `Synced with ${syncProviderName}`;
        syncClass = 'detail-sync-complete';
    }

    const detailRows = [
        contact.email ? detailRow('ph-envelope-simple', 'Email', contact.email) : '',
        contact.phone ? detailRow('ph-phone', 'Phone', contact.phone) : '',
        contact.address ? detailRow('ph-map-pin', 'Address', contact.address) : ''
    ].join('');
    const labels = (contact.labels || []).map(label =>
        `<span class="card-label-tag">${escapeHtml(label)}</span>`
    ).join('');

    contactDetailsBody.innerHTML = `
        <div class="details-profile">
            ${avatar}
            <div>
                <h3>${escapeHtml(contact.name)}</h3>
                <span class="detail-sync-status ${syncClass}">${syncText}</span>
            </div>
        </div>
        <div class="details-fields">
            ${detailRows || '<p class="details-empty">No additional contact information.</p>'}
        </div>
        ${labels ? `
            <div class="details-labels">
                <span class="details-section-label">Labels</span>
                <div class="card-labels">${labels}</div>
            </div>` : ''}
    `;
    contactDetailsDialog.showModal();
}

function detailRow(iconClass, label, value) {
    return `
        <div class="detail-row">
            <i class="ph ${iconClass}"></i>
            <div>
                <span>${label}</span>
                <p>${escapeHtml(value)}</p>
            </div>
        </div>`;
}

function closeContactDetails() {
    contactDetailsDialog.close();
    viewingContact = null;
}

function closeDetailsFromBackdrop(event) {
    if (event.target === contactDetailsDialog) closeContactDetails();
}

function editContactFromDetails() {
    const contact = viewingContact;
    closeContactDetails();
    if (contact) openContactDialog(contact);
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
        syncProvider: '',
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
        if (!contact.resourceName && !contact.remoteId) {
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

// Local persistence
async function saveContacts(source) {
    const savedAt = await writeContacts(
        contacts,
        source,
        labelGroups,
        { ungroupedCollapsed }
    );
    currentDataSource = source;
    lastUpdated = savedAt;
    updateStorageInfo();
}

async function restoreContacts() {
    try {
        const savedData = await readContacts();
        if (!savedData || !Array.isArray(savedData.contacts)) {
            updateStorageInfo();
            return;
        }

        contacts = savedData.contacts;
        labelGroups = sanitizeLabelGroups(savedData.labelGroups);
        ungroupedCollapsed = Boolean(
            savedData.labelUi && savedData.labelUi.ungroupedCollapsed
        );
        // Migrate contacts stored before provider-aware synchronization.
        contacts.forEach(contact => {
            if (!contact.syncProvider && contact.resourceName) contact.syncProvider = 'google';
        });
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
        await removeContacts();

        contacts = [];
        labelGroups = [];
        ungroupedCollapsed = false;
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
        resultsSummary.hidden = true;
        sidebarResultCount.textContent = '0';
        sidebarResultCount.classList.remove('is-filtered');
        contactRenderer.updateMobileSummary(0, 0);
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

function sanitizeLabelGroups(value) {
    if (!Array.isArray(value)) return [];
    const seenLabels = new Set();
    return value.filter(group =>
        group && typeof group.id === 'string' && typeof group.name === 'string'
    ).map(group => ({
        id: group.id,
        name: group.name.trim() || 'Untitled group',
        collapsed: Boolean(group.collapsed),
        labels: Array.isArray(group.labels)
            ? group.labels.filter(label => {
                if (typeof label !== 'string' || seenLabels.has(label)) return false;
                seenLabels.add(label);
                return true;
            })
            : []
    }));
}

async function createLabelGroup() {
    const proposedName = prompt('Name the new label group:');
    if (proposedName === null) return;
    const name = proposedName.trim();
    if (!name) return;
    if (labelGroups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
        alert('A label group with that name already exists.');
        return;
    }
    const id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    labelGroups.push({ id, name, labels: [], collapsed: false });
    renderLabels();
    await persistLabelGroups();
}

async function moveLabelToGroup(label, groupId) {
    labelGroups.forEach(group => {
        group.labels = group.labels.filter(item => item !== label);
    });
    const target = labelGroups.find(group => group.id === groupId);
    if (target && !target.labels.includes(label)) target.labels.push(label);
    renderLabels();
    await persistLabelGroups();
}

async function toggleLabelGroup(groupId) {
    if (!groupId) {
        ungroupedCollapsed = !ungroupedCollapsed;
        renderLabels();
        await persistLabelGroups();
        return;
    }
    const group = labelGroups.find(item => item.id === groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    renderLabels();
    await persistLabelGroups();
}

async function persistLabelGroups() {
    try {
        await saveContacts(currentDataSource || 'manual');
    } catch (error) {
        console.error('Could not save label groups:', error);
        statusMessage.textContent = 'The label groups could not be stored locally.';
        statusMessage.style.display = 'block';
    }
}

function enableContactsUi() {
    searchInput.disabled = false;
    clearFiltersBtn.disabled = false;
    deleteContactsBtn.disabled = false;
    exportVcardBtn.disabled = false;
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
        microsoft: 'Microsoft Outlook',
        vcard: 'vCard',
        csv: 'CSV',
        manual: 'Created locally'
    };
    const source = sourceNames[currentDataSource] || 'Local';
    const date = new Date(lastUpdated).toLocaleString();
    storageInfo.textContent = `${contacts.length} contacts stored locally · ${source} · ${date}`;
    deleteContactsBtn.disabled = false;
    updateSyncUi();
}

function getPendingSyncContacts(provider = '') {
    return contacts.filter(contact =>
        (!provider || !contact.syncProvider || contact.syncProvider === provider) &&
        (
            contact.syncStatus === 'pending-create' ||
            contact.syncStatus === 'pending-update' ||
            contact.syncStatus === 'pending-photo'
        )
    );
}

function updateSyncUi() {
    const googleCount = getPendingSyncContacts('google').length;
    const microsoftCount = getPendingSyncContacts('microsoft').length;
    syncGoogleBtn.disabled = googleCount === 0;
    syncCount.hidden = googleCount === 0;
    syncCount.textContent = googleCount;
    syncMicrosoftBtn.disabled = microsoftCount === 0;
    microsoftSyncCount.hidden = microsoftCount === 0;
    microsoftSyncCount.textContent = microsoftCount;
    exportVcardBtn.disabled = contacts.length === 0;
}

// Microsoft OAuth and Graph handling
function initMicrosoftClient() {
    if (typeof msal === 'undefined' || MICROSOFT_CLIENT_ID === 'YOUR_MICROSOFT_CLIENT_ID') return;
    microsoftClient = new msal.PublicClientApplication({
        auth: {
            clientId: MICROSOFT_CLIENT_ID,
            authority: 'https://login.microsoftonline.com/common',
            redirectUri: `${window.location.origin}${window.location.pathname}`
        },
        cache: { cacheLocation: 'localStorage' }
    });
}

async function getMicrosoftAccessToken() {
    if (MICROSOFT_CLIENT_ID === 'YOUR_MICROSOFT_CLIENT_ID') {
        throw new Error('Microsoft sync is not configured yet. Add the Entra client ID in js/config.js.');
    }
    if (!microsoftClient) initMicrosoftClient();
    if (!microsoftClient) throw new Error('Microsoft sign-in is not ready. Please reload and try again.');

    const scopes = ['Contacts.ReadWrite'];
    let account = microsoftClient.getAllAccounts()[0];
    if (!account) {
        const login = await microsoftClient.loginPopup({ scopes });
        account = login.account;
    }
    try {
        return (await microsoftClient.acquireTokenSilent({ scopes, account })).accessToken;
    } catch (error) {
        return (await microsoftClient.acquireTokenPopup({ scopes, account })).accessToken;
    }
}

async function requestMicrosoftImport() {
    closeImportMenu();
    statusMessage.textContent = 'Connecting to Microsoft...';
    statusMessage.style.display = 'block';
    try {
        const accessToken = await getMicrosoftAccessToken();
        await importMicrosoftContacts(accessToken);
    } catch (error) {
        statusMessage.textContent = `Microsoft authorization failed: ${error.message}`;
    }
}

async function importMicrosoftContacts(accessToken) {
    statusMessage.textContent = 'Fetching Microsoft Outlook contacts...';
    const locationCache = buildLocationCache();
    const remoteContacts = await fetchMicrosoftContacts(accessToken);
    contacts = remoteContacts.map(microsoftContactToLocal);
    contacts.forEach(contact => applyCachedLocation(contact, locationCache));
    contacts.sort((a, b) => a.name.localeCompare(b.name));
    selectedLabels.clear();
    rebuildLabels();
    enableContactsUi();
    renderLabels();
    renderContacts();
    await persistImportedContacts('microsoft');
}

async function requestMicrosoftSync() {
    closeSettingsMenu();
    try {
        const accessToken = await getMicrosoftAccessToken();
        await syncPendingMicrosoftContacts(accessToken);
    } catch (error) {
        statusMessage.textContent = `Microsoft authorization failed: ${error.message}`;
        statusMessage.style.display = 'block';
        updateSyncUi();
    }
}

async function syncPendingMicrosoftContacts(accessToken) {
    const pendingContacts = getPendingSyncContacts('microsoft');
    if (!pendingContacts.length) return;
    syncMicrosoftBtn.disabled = true;
    let syncedCount = 0;
    let failedCount = 0;

    for (const contact of pendingContacts) {
        contact.syncProvider = 'microsoft';
        contact.syncError = '';
        statusMessage.textContent =
            `Syncing with Microsoft (${syncedCount + failedCount + 1}/${pendingContacts.length})...`;
        statusMessage.style.display = 'block';
        try {
            if (contact.syncStatus === 'pending-create' || !contact.remoteId) {
                const created = await createMicrosoftContact(contact, accessToken);
                contact.remoteId = created.id;
                contact.microsoftChangeKey = created.changeKey || '';
            } else {
                const updated = await updateMicrosoftContact(contact, accessToken);
                contact.microsoftChangeKey =
                    (updated && updated.changeKey) || contact.microsoftChangeKey;
            }
            // Microsoft contact photos require a separate binary endpoint. Keep the
            // locally stored photo without falsely marking it as remotely uploaded.
            contact.syncStatus = 'synced';
            contact.lastSyncedAt = new Date().toISOString();
            syncedCount += 1;
        } catch (error) {
            contact.syncError = error.message;
            failedCount += 1;
        }
        await saveContacts(currentDataSource || 'manual');
    }
    renderContacts();
    updateSyncUi();
    statusMessage.textContent = failedCount
        ? `${syncedCount} contact(s) synced; ${failedCount} Microsoft sync(s) failed.`
        : `${syncedCount} contact(s) synced with Microsoft.`;
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
    const pendingContacts = getPendingSyncContacts('google');
    if (pendingContacts.length === 0) return;

    syncGoogleBtn.disabled = true;
    let syncedCount = 0;
    let failedCount = 0;

    for (const contact of pendingContacts) {
        contact.syncProvider = 'google';
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
            syncProvider: 'google',
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

async function handleVcardUpload(event) {
    closeImportMenu();
    const file = event.target.files[0];
    if (!file) return;
    statusMessage.textContent = 'Parsing vCard file...';
    statusMessage.style.display = 'block';
    try {
        const parsedContacts = parseVcards(await file.text());
        if (!parsedContacts.length) throw new Error('No contacts were found in this vCard file.');
        const locationCache = buildLocationCache();
        contacts = parsedContacts;
        contacts.forEach(contact => applyCachedLocation(contact, locationCache));
        contacts.sort((a, b) => a.name.localeCompare(b.name));
        selectedLabels.clear();
        rebuildLabels();
        enableContactsUi();
        renderLabels();
        renderContacts();
        await persistImportedContacts('vcard');
    } catch (error) {
        statusMessage.textContent = `Could not import vCard: ${error.message}`;
        statusMessage.style.display = 'block';
    } finally {
        vcardFileInput.value = '';
    }
}

function exportContactsAsVcard() {
    closeSettingsMenu();
    if (!contacts.length) return;
    const blob = new Blob([exportVcards(contacts)], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contags-${new Date().toISOString().slice(0, 10)}.vcf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Data Processing (Matches Python Logic)
async function processParsedData(data) {
    const locationCache = buildLocationCache();
    const parsed = parseCsvContacts(data);
    contacts = parsed.contacts;
    contacts.forEach(contact => {
        contact.syncProvider = '';
        contact.syncStatus = 'pending-create';
        contact.syncError = '';
    });
    allLabels.clear();
    parsed.labels.forEach(label => allLabels.add(label));
    selectedLabels.clear();
    contacts.forEach(contact => applyCachedLocation(contact, locationCache));

    // Enable UI
    enableContactsUi();

    // Render Sidebars & Contacts
    renderLabels();
    renderContacts();
    await persistImportedContacts('csv');
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

export function initializeApp() {
    return init();
}
