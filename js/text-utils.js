export function escapeHtml(unsafe) {
    return (unsafe || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function highlightText(text, query) {
    if (!text) return '';
    if (!query) return escapeHtml(text);

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return text.split(regex).map(part =>
        part.toLowerCase() === query.toLowerCase()
            ? `<span class="highlight">${escapeHtml(part)}</span>`
            : escapeHtml(part)
    ).join('');
}

export function getInitials(name) {
    const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

export function normalizeAddress(address) {
    return (address || '').trim().replace(/\s+/g, ' ');
}

export function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
