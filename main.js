// State
let contacts = [];
let allLabels = new Set();
let selectedLabels = new Set();

// DOM Elements
const csvFileInput = document.getElementById('csvFileInput');
const searchInput = document.getElementById('searchInput');
const labelsList = document.getElementById('labelsList');
const contactsGrid = document.getElementById('contactsGrid');
const statusMessage = document.getElementById('statusMessage');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');

// Debounce for search
let searchTimeout;

// Initialization
function init() {
    csvFileInput.addEventListener('change', handleFileUpload);
    
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(renderContacts, 300); // 300ms debounce
    });
    
    clearFiltersBtn.addEventListener('click', () => {
        selectedLabels.clear();
        document.querySelectorAll('.label-checkbox').forEach(cb => cb.checked = false);
        renderContacts();
    });
}

// File Upload & Parsing
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    statusMessage.textContent = 'Parsing CSV...';
    statusMessage.style.display = 'block';
    contactsGrid.innerHTML = '';

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            processParsedData(results.data);
            statusMessage.style.display = 'none';
        },
        error: function(error) {
            statusMessage.textContent = `Error reading File: ${error.message}`;
        }
    });
}

// Data Processing (Matches Python Logic)
function processParsedData(data) {
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

        contacts.push({
            name: fullName,
            email: email,
            phone: phone,
            labels: labelList
        });
    });

    // Sort contacts by name
    contacts.sort((a, b) => a.name.localeCompare(b.name));

    // Enable UI
    searchInput.disabled = false;
    clearFiltersBtn.disabled = false;

    // Render Sidebars & Contacts
    renderLabels();
    renderContacts();
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

        // Label Filter (AND logic)
        if (selectedLabels.size > 0) {
            const hasAllLabels = Array.from(selectedLabels).every(lbl => c.labels.includes(lbl));
            if (!hasAllLabels) return false;
        }

        // Search Filter
        if (query) {
            if (!name.includes(query) && !email.includes(query) && !phone.includes(query)) {
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
        let innerHTML = `<div class="card-name">${highlightText(c.name, query)}</div>`;
        
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
        
        if (c.labels && c.labels.length > 0) {
            innerHTML += `<div class="card-labels">`;
            c.labels.forEach(lbl => {
                innerHTML += `<span class="card-label-tag">${escapeHtml(lbl)}</span>`;
            });
            innerHTML += `</div>`;
        }

        card.innerHTML = innerHTML;
        contactsGrid.appendChild(card);
    });
}

// Run init
init();
