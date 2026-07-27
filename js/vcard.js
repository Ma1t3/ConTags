function unescapeVcard(value = '') {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function escapeVcard(value = '') {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

export function parseVcards(text) {
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    return unfolded.split(/END:VCARD/i).map(block => {
        if (!/BEGIN:VCARD/i.test(block)) return null;
        const fields = {};
        const labels = [];
        block.split(/\r?\n/).forEach(line => {
            const separator = line.indexOf(':');
            if (separator < 0) return;
            const key = line.slice(0, separator).toUpperCase();
            const value = unescapeVcard(line.slice(separator + 1));
            if (key === 'FN' || key.startsWith('FN;')) fields.name = value;
            else if ((key === 'N' || key.startsWith('N;')) && !fields.name) {
                const parts = value.split(';');
                fields.name = [parts[1], parts[0]].filter(Boolean).join(' ');
            } else if ((key === 'EMAIL' || key.startsWith('EMAIL;')) && !fields.email) fields.email = value;
            else if ((key === 'TEL' || key.startsWith('TEL;')) && !fields.phone) fields.phone = value;
            else if ((key === 'ADR' || key.startsWith('ADR;')) && !fields.address) {
                fields.address = value.split(';').filter(Boolean).join(', ');
            } else if (key === 'CATEGORIES' || key.startsWith('CATEGORIES;')) {
                labels.push(...value.split(',').map(item => item.trim()).filter(Boolean));
            }
        });
        if (!fields.name) return null;
        return {
            name: fields.name,
            email: fields.email || '',
            phone: fields.phone || '',
            address: fields.address || '',
            labels: [...new Set(labels)],
            photo: null,
            photoUrl: '',
            syncProvider: '',
            syncStatus: 'pending-create',
            syncError: ''
        };
    }).filter(Boolean);
}

export function exportVcards(contacts) {
    return contacts.map(contact => [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${escapeVcard(contact.name)}`,
        contact.email ? `EMAIL:${escapeVcard(contact.email)}` : '',
        contact.phone ? `TEL:${escapeVcard(contact.phone)}` : '',
        contact.address ? `ADR:;;${escapeVcard(contact.address)}` : '',
        contact.labels && contact.labels.length
            ? `CATEGORIES:${contact.labels.map(escapeVcard).join(',')}`
            : '',
        'END:VCARD'
    ].filter(Boolean).join('\r\n')).join('\r\n');
}
