function getAddress(row) {
    const formatted = (
        row['Address 1 - Formatted'] ||
        row.Address ||
        row['Full Address'] ||
        ''
    ).trim();
    if (formatted) return formatted;

    return [
        row['Address 1 - Street'],
        row['Address 1 - Postal Code'],
        row['Address 1 - City'],
        row['Address 1 - Region'],
        row['Address 1 - Country']
    ].map(value => (value || '').trim()).filter(Boolean).join(', ');
}

export function parseCsvContacts(rows) {
    const labels = new Set();
    const contacts = rows.map(row => {
        const first = (row['First Name'] || '').trim();
        const middle = (row['Middle Name'] || '').trim();
        const last = (row['Last Name'] || '').trim();
        let name = [first, middle, last].filter(Boolean).join(' ').trim();
        if (!name) name = (row.Name || row['Full Name'] || '').trim();

        const contactLabels = [];
        const rawLabels = row.Labels || '';
        if (rawLabels) {
            rawLabels.split(/\s*,\s*/).forEach(part => {
                part.split(':::').forEach(value => {
                    const label = value.trim();
                    if (label && label !== '* myContacts') {
                        contactLabels.push(label);
                        labels.add(label);
                    }
                });
            });
        }

        return {
            name,
            email: (row['E-mail 1 - Value'] || '').trim(),
            phone: (row['Phone 1 - Value'] || '').trim(),
            birthday: (row.Birthday || row.Birthdate || row['Date of Birth'] || '').trim(),
            address: getAddress(row),
            labels: contactLabels
        };
    });

    contacts.sort((a, b) => a.name.localeCompare(b.name));
    return { contacts, labels };
}
