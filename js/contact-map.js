import {
    mapDialog, closeMapBtn, mapStatus, unmappedContacts,
    unmappedContactsList, mapProgress, statusMessage
} from './dom.js';
import { getPhotoUrl } from './image-utils.js';
import { escapeHtml, getInitials, normalizeAddress, wait } from './text-utils.js';

export function initializeContactMap({
    getContacts,
    saveContacts,
    getCurrentDataSource,
    closeSettingsMenu
}) {
    let map = null;
    let markers = null;
    let geocodingActive = false;
    let geocodingController = null;

    closeMapBtn.addEventListener('click', closeMap);
    mapDialog.addEventListener('click', event => {
        if (event.target === mapDialog) closeMap();
    });

    async function openMap() {
        closeSettingsMenu();
        if (typeof L === 'undefined') {
            alert('The map library could not be loaded. Please check your internet connection.');
            return;
        }

        mapDialog.showModal();
        if (!map) {
            map = L.map('contactsMap').setView([51.1657, 10.4515], 6);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
            markers = createMarkerLayer(map);
        }

        setTimeout(() => map.invalidateSize(), 0);
        renderMap();
        await geocodeMissingAddresses();
    }

    function createMarkerLayer(targetMap) {
        if (typeof L.markerClusterGroup !== 'function') {
            return L.layerGroup().addTo(targetMap);
        }
        return L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 55,
            disableClusteringAtZoom: 18,
            iconCreateFunction: cluster => {
                const count = cluster.getChildCount();
                const sizeClass = count < 10
                    ? 'contact-cluster-small'
                    : count < 100
                        ? 'contact-cluster-medium'
                        : 'contact-cluster-large';
                return L.divIcon({
                    html: `<span>${count.toLocaleString()}</span>`,
                    className: `contact-cluster ${sizeClass}`,
                    iconSize: [48, 48]
                });
            }
        }).addTo(targetMap);
    }

    function closeMap() {
        mapDialog.close();
    }

    function renderMap() {
        if (!map || !markers) return;
        markers.clearLayers();
        const coordinates = [];
        const contacts = getContacts();

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
            const icon = L.divIcon({
                className: 'contact-photo-marker-wrapper',
                html: `
                    <div class="contact-photo-marker${syncClass}">${markerContent}</div>
                    <div class="contact-marker-tip${syncClass}"></div>`,
                iconSize: [52, 60],
                iconAnchor: [26, 58],
                popupAnchor: [0, -52]
            });
            L.marker([latitude, longitude], { icon, title: contact.name })
                .bindPopup(popup)
                .addTo(markers);
            coordinates.push([latitude, longitude]);
        });

        if (coordinates.length === 1) {
            map.setView(coordinates[0], 14);
        } else if (coordinates.length > 1) {
            map.fitBounds(coordinates, { padding: [35, 35], maxZoom: 15 });
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
            `${coordinates.length} of ${addressCount} contact addresses shown on the map.`;
    }

    async function geocodeMissingAddresses() {
        if (geocodingActive) return;
        const queue = getContacts().filter(contact => {
            const normalized = normalizeAddress(contact.address);
            return normalized && !contact.coordinates && contact.geocodedAddress !== normalized;
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
                await saveContacts(getCurrentDataSource() || 'manual');
                if (mapDialog.open) renderMap();
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
        if (mapDialog.open) renderMap();
    }

    return { openMap, renderMap };
}
