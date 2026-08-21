async function apiError(response, fallbackMessage) {
    try {
        const body = await response.json();
        const message = body && body.error && body.error.message;
        return new Error(message || `${fallbackMessage} (${response.status})`);
    } catch (error) {
        return new Error(`${fallbackMessage} (${response.status})`);
    }
}

async function graphRequest(path, accessToken, options = {}) {
    const response = await fetch(
        path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`,
        {
            ...options,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        }
    );
    if (!response.ok) throw await apiError(response, 'Microsoft Graph request failed');
    return response.status === 204 ? null : response.json();
}

function toGraphContact(contact) {
    return {
        displayName: contact.name,
        givenName: contact.name,
        emailAddresses: contact.email
            ? [{ address: contact.email, name: contact.name }]
            : [],
        businessPhones: contact.phone ? [contact.phone] : [],
        homeAddress: contact.address ? { street: contact.address } : {},
        birthday: contact.birthday ? `${contact.birthday}T00:00:00Z` : null,
        categories: contact.labels || []
    };
}

export async function fetchMicrosoftContacts(accessToken) {
    const contacts = [];
    let url = '/me/contacts?$top=250&$select=id,displayName,givenName,surname,emailAddresses,businessPhones,homePhones,mobilePhone,homeAddress,businessAddress,birthday,categories,changeKey';
    while (url) {
        const page = await graphRequest(url, accessToken);
        contacts.push(...(page.value || []));
        url = page['@odata.nextLink'] || '';
    }
    return contacts;
}

export function microsoftContactToLocal(contact) {
    const email = (contact.emailAddresses && contact.emailAddresses[0] &&
        contact.emailAddresses[0].address) || '';
    const phone = contact.mobilePhone ||
        (contact.businessPhones && contact.businessPhones[0]) ||
        (contact.homePhones && contact.homePhones[0]) || '';
    const addressObject = Object.keys(contact.homeAddress || {}).length
        ? contact.homeAddress
        : contact.businessAddress;
    const address = addressObject
        ? [
            addressObject.street,
            addressObject.postalCode,
            addressObject.city,
            addressObject.state,
            addressObject.countryOrRegion
        ].filter(Boolean).join(', ')
        : '';
    return {
        name: contact.displayName ||
            [contact.givenName, contact.surname].filter(Boolean).join(' ') ||
            'No Name',
        email,
        phone,
        birthday: contact.birthday ? contact.birthday.slice(0, 10) : '',
        address,
        labels: contact.categories || [],
        photo: null,
        photoUrl: '',
        syncProvider: 'microsoft',
        remoteId: contact.id,
        microsoftChangeKey: contact.changeKey || '',
        syncStatus: 'synced',
        syncError: '',
        lastSyncedAt: new Date().toISOString()
    };
}

export async function createMicrosoftContact(contact, accessToken) {
    return graphRequest('/me/contacts', accessToken, {
        method: 'POST',
        body: JSON.stringify(toGraphContact(contact))
    });
}

export async function updateMicrosoftContact(contact, accessToken) {
    return graphRequest(`/me/contacts/${encodeURIComponent(contact.remoteId)}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify(toGraphContact(contact))
    });
}
