import {
    labelsList, labelSearchInput, searchInput, contactsGrid, resultsSummary,
    filteredResultCount, sidebarResultCount, resultsCountLabel, resultsContext,
    mobileFilterResultCount, mobileFilterSummary, mobileSelectedLabelCount
} from './dom.js';
import { getPhotoUrl } from './image-utils.js';
import { escapeHtml, getInitials, highlightText } from './text-utils.js';

export function createContactRenderer({
    getContacts,
    getLabels,
    getSelectedLabels,
    openContactDetails
}) {
    function renderLabels() {
        const labels = getLabels();
        const selectedLabels = getSelectedLabels();
        labelsList.innerHTML = '';
        const labelQuery = (labelSearchInput.value || '').trim().toLowerCase();
        const sortedLabels = Array.from(labels)
            .sort()
            .filter(label => label.toLowerCase().includes(labelQuery));

        if (sortedLabels.length === 0) {
            labelsList.innerHTML = `<p class="empty-state-text">${
                labelQuery ? 'No matching labels.' : 'No labels found.'
            }</p>`;
            return;
        }

        sortedLabels.forEach(label => {
            const labelElement = document.createElement('label');
            labelElement.className = 'label-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'label-checkbox';
            checkbox.value = label;
            checkbox.checked = selectedLabels.has(label);
            checkbox.addEventListener('change', event => {
                if (event.target.checked) selectedLabels.add(label);
                else selectedLabels.delete(label);
                renderContacts();
            });

            const text = document.createElement('span');
            text.className = 'label-text';
            text.textContent = label;
            text.title = label;
            labelElement.append(checkbox, text);
            labelsList.appendChild(labelElement);
        });
    }

    function renderContacts() {
        const contacts = getContacts();
        const selectedLabels = getSelectedLabels();
        const query = (searchInput.value || '').trim().toLowerCase();
        const filtered = contacts.filter(contact => {
            if (
                selectedLabels.size > 0 &&
                !Array.from(selectedLabels).every(label => contact.labels.includes(label))
            ) {
                return false;
            }
            if (!query) return true;
            return [contact.name, contact.email, contact.phone, contact.address]
                .some(value => (value || '').toLowerCase().includes(query));
        });

        updateResultsSummary(filtered.length, query);
        contactsGrid.innerHTML = '';
        if (filtered.length === 0 && contacts.length > 0) {
            contactsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);">
                    <i class="ph ph-magnifying-glass" style="font-size: 3rem; opacity: 0.5; margin-bottom: 1rem;"></i>
                    <p>No contacts found matching your criteria.</p>
                </div>`;
            return;
        }

        filtered.forEach((contact, index) => {
            const card = document.createElement('div');
            card.className = 'contact-card';
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `View details for ${contact.name}`);
            card.style.animationDelay = `${(index % 10) * 0.05}s`;
            card.innerHTML = buildContactCard(contact, query);
            card.addEventListener('click', () => openContactDetails(contact));
            card.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openContactDetails(contact);
                }
            });
            contactsGrid.appendChild(card);
        });
    }

    function buildContactCard(contact, query) {
        const photoUrl = contact.photo ? getPhotoUrl(contact.photo) : (contact.photoUrl || '');
        const avatar = photoUrl
            ? `<div class="card-avatar"><img src="${escapeHtml(photoUrl)}" alt="" referrerpolicy="no-referrer"></div>`
            : `<div class="card-avatar card-avatar-fallback" aria-hidden="true">${escapeHtml(getInitials(contact.name))}</div>`;
        const syncIndicator = buildSyncIndicator(contact);
        let html = `
            <div class="card-heading">
                ${avatar}
                <div class="card-name">${highlightText(contact.name, query)}</div>
            </div>
            ${syncIndicator}`;

        const details = [
            ['ph-envelope-simple', contact.email],
            ['ph-phone', contact.phone],
            ['ph-map-pin', contact.address, 'card-address']
        ];
        details.forEach(([icon, value, extraClass = '']) => {
            if (!value) return;
            html += `
                <div class="card-info ${extraClass}">
                    <i class="ph ${icon}"></i>
                    <span>${highlightText(value, query)}</span>
                </div>`;
        });

        if (contact.labels && contact.labels.length > 0) {
            html += '<div class="card-labels">';
            contact.labels.forEach(label => {
                html += `<span class="card-label-tag">${escapeHtml(label)}</span>`;
            });
            html += '</div>';
        }
        return html;
    }

    function buildSyncIndicator(contact) {
        if (contact.syncError) {
            return `
                <span class="card-sync-indicator sync-error" role="img"
                      aria-label="Google sync failed" title="${escapeHtml(contact.syncError)}">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        }
        if (['pending-create', 'pending-update', 'pending-photo'].includes(contact.syncStatus)) {
            return `
                <span class="card-sync-indicator sync-pending" role="img"
                      aria-label="Pending Google sync" title="Pending Google sync">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        }
        if (contact.syncStatus === 'synced') {
            return `
                <span class="card-sync-indicator sync-complete" role="img"
                      aria-label="Synced with Google" title="Synced with Google">
                    <i class="ph ph-check"></i>
                </span>`;
        }
        return '';
    }

    function updateResultsSummary(filteredCount, query) {
        const contacts = getContacts();
        const selectedLabels = getSelectedLabels();
        if (contacts.length === 0) {
            resultsSummary.hidden = true;
            return;
        }

        resultsSummary.hidden = selectedLabels.size === 0;
        filteredResultCount.textContent = filteredCount.toLocaleString();
        sidebarResultCount.textContent = filteredCount.toLocaleString();
        resultsCountLabel.textContent = filteredCount === 1 ? 'contact' : 'contacts';

        const contexts = [];
        if (selectedLabels.size > 0) {
            const labelNames = Array.from(selectedLabels);
            const visibleNames = labelNames.slice(0, 2).map(label => `"${label}"`);
            const remaining = labelNames.length - visibleNames.length;
            let labelContext = visibleNames.join(' + ');
            if (remaining > 0) labelContext += ` + ${remaining} more`;
            contexts.push(labelContext);
        }
        if (query) contexts.push(`search: "${query}"`);

        resultsContext.textContent = contexts.length > 0
            ? `of ${contacts.length.toLocaleString()} / ${contexts.join(' / ')}`
            : 'total';
        const filtered = filteredCount !== contacts.length || contexts.length > 0;
        resultsSummary.classList.toggle('results-filtered', filtered);
        sidebarResultCount.classList.toggle('is-filtered', filtered);
        updateMobileSummary(filteredCount, selectedLabels.size);
    }

    function updateMobileSummary(filteredCount, selectedCount) {
        mobileFilterResultCount.textContent =
            `${filteredCount.toLocaleString()} ${filteredCount === 1 ? 'result' : 'results'}`;
        mobileFilterSummary.textContent =
            `${filteredCount.toLocaleString()} matching ${filteredCount === 1 ? 'contact' : 'contacts'}`;
        mobileSelectedLabelCount.hidden = selectedCount === 0;
        mobileSelectedLabelCount.textContent = `${selectedCount.toLocaleString()} selected`;
    }

    return { renderLabels, renderContacts, updateMobileSummary };
}
