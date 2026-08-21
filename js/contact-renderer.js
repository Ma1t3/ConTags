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
    openContactDetails,
    getLabelGroups,
    getUngroupedCollapsed,
    moveLabelToGroup,
    toggleLabelGroup
}) {
    const dragScrollEdgeSize = 72;
    const dragScrollMaxSpeed = 14;
    let dragScrollFrame = null;
    let dragScrollVelocity = 0;

    function runDragScroll() {
        if (dragScrollVelocity === 0) {
            dragScrollFrame = null;
            return;
        }
        labelsList.scrollTop += dragScrollVelocity;
        dragScrollFrame = requestAnimationFrame(runDragScroll);
    }

    function updateDragScroll(event) {
        const bounds = labelsList.getBoundingClientRect();
        const distanceFromTop = event.clientY - bounds.top;
        const distanceFromBottom = bounds.bottom - event.clientY;
        if (distanceFromTop < dragScrollEdgeSize) {
            dragScrollVelocity = -dragScrollMaxSpeed
                * (1 - Math.max(0, distanceFromTop) / dragScrollEdgeSize);
        } else if (distanceFromBottom < dragScrollEdgeSize) {
            dragScrollVelocity = dragScrollMaxSpeed
                * (1 - Math.max(0, distanceFromBottom) / dragScrollEdgeSize);
        } else {
            stopDragScroll();
            return;
        }
        if (dragScrollFrame === null) {
            dragScrollFrame = requestAnimationFrame(runDragScroll);
        }
    }

    function stopDragScroll() {
        dragScrollVelocity = 0;
        if (dragScrollFrame !== null) {
            cancelAnimationFrame(dragScrollFrame);
            dragScrollFrame = null;
        }
    }

    labelsList.addEventListener('dragover', updateDragScroll);
    labelsList.addEventListener('drop', stopDragScroll);
    labelsList.addEventListener('dragleave', event => {
        const bounds = labelsList.getBoundingClientRect();
        const pointerIsOutside = event.clientX < bounds.left
            || event.clientX > bounds.right
            || event.clientY < bounds.top
            || event.clientY > bounds.bottom;
        if (pointerIsOutside) stopDragScroll();
    });

    function renderLabels() {
        const previousScrollTop = labelsList.scrollTop;
        const labels = getLabels();
        const selectedLabels = getSelectedLabels();
        labelsList.innerHTML = '';
        const labelQuery = (labelSearchInput.value || '').trim().toLowerCase();
        const sortedLabels = Array.from(labels).sort((a, b) => a.localeCompare(b));
        const groups = getLabelGroups();

        if (!sortedLabels.some(label => label.toLowerCase().includes(labelQuery))) {
            labelsList.innerHTML = `<p class="empty-state-text">${
                labelQuery ? 'No matching labels.' : 'No labels found.'
            }</p>`;
            return;
        }

        const assigned = new Set(groups.flatMap(group => group.labels));
        groups.forEach(group => {
            const groupLabels = sortedLabels.filter(label =>
                group.labels.includes(label) && label.toLowerCase().includes(labelQuery)
            );
            if (labelQuery && !groupLabels.length) return;
            labelsList.appendChild(buildLabelGroup(group, groupLabels, selectedLabels, labelQuery));
        });

        const ungroupedLabels = sortedLabels.filter(label =>
            !assigned.has(label) && label.toLowerCase().includes(labelQuery)
        );
        if (ungroupedLabels.length || !labelQuery) {
            labelsList.appendChild(buildLabelGroup(
                {
                    id: '',
                    name: 'Ungrouped',
                    labels: ungroupedLabels,
                    collapsed: getUngroupedCollapsed()
                },
                ungroupedLabels,
                selectedLabels,
                labelQuery
            ));
        }
        labelsList.scrollTop = previousScrollTop;
    }

    function buildLabelGroup(group, groupLabels, selectedLabels, labelQuery) {
        const section = document.createElement('section');
        section.className = 'label-group';
        section.dataset.groupId = group.id;
        section.addEventListener('dragover', event => {
            event.preventDefault();
            section.classList.add('drag-over');
        });
        section.addEventListener('dragleave', event => {
            if (!section.contains(event.relatedTarget)) section.classList.remove('drag-over');
        });
        section.addEventListener('drop', event => {
            event.preventDefault();
            section.classList.remove('drag-over');
            const label = event.dataTransfer.getData('text/plain');
            if (label) moveLabelToGroup(label, group.id);
        });

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'label-group-header';
        header.setAttribute('aria-expanded', String(!group.collapsed));
        header.innerHTML = `
            <span>
                <i class="ph ph-caret-${group.collapsed ? 'right' : 'down'}"></i>
                <i class="ph ${group.id ? 'ph-folder' : 'ph-tray'}"></i>
                <strong></strong>
            </span>
            <span class="label-group-count">${groupLabels.length}</span>`;
        header.querySelector('strong').textContent = group.name;
        header.addEventListener('click', () => {
            toggleLabelGroup(group.id);
        });
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'label-group-body';
        body.hidden = Boolean(group.collapsed && !labelQuery);
        groupLabels.forEach(label => body.appendChild(buildLabelItem(label, selectedLabels)));
        if (!groupLabels.length && !labelQuery) {
            body.innerHTML = '<p class="label-group-empty">Drop labels here</p>';
        }
        section.appendChild(body);
        return section;
    }

    function buildLabelItem(label, selectedLabels) {
        const labelElement = document.createElement('label');
        labelElement.className = 'label-item';
        labelElement.draggable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        labelElement.addEventListener('dragstart', event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', label);
            labelElement.classList.add('is-dragging');
        });
        labelElement.addEventListener('dragend', () => {
            labelElement.classList.remove('is-dragging');
            stopDragScroll();
        });

        const dragHandle = document.createElement('i');
        dragHandle.className = 'ph ph-dots-six-vertical label-drag-handle';
        dragHandle.setAttribute('aria-hidden', 'true');
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
        labelElement.append(dragHandle, checkbox, text);
        return labelElement;
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
        const provider = contact.syncProvider === 'microsoft'
            ? 'Microsoft'
            : (contact.syncProvider === 'google' ? 'Google' : 'a provider');
        if (contact.syncError) {
            return `
                <span class="card-sync-indicator sync-error" role="img"
                      aria-label="${provider} sync failed" title="${escapeHtml(contact.syncError)}">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        }
        if (['pending-create', 'pending-update', 'pending-photo'].includes(contact.syncStatus)) {
            return `
                <span class="card-sync-indicator sync-pending" role="img"
                      aria-label="Pending ${provider} sync" title="Pending ${provider} sync">
                    <i class="ph ph-arrows-clockwise"></i>
                </span>`;
        }
        if (contact.syncStatus === 'synced') {
            return `
                <span class="card-sync-indicator sync-complete" role="img"
                      aria-label="Synced with ${provider}" title="Synced with ${provider}">
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
