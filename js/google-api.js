import { PHOTO_SIZE } from './config.js';
import { blobToBase64, preparePhoto } from './image-utils.js';

async function apiError(response, fallbackMessage) {
    try {
        const body = await response.json();
        const message = body && body.error && body.error.message;
        return new Error(message || `${fallbackMessage} (${response.status})`);
    } catch (error) {
        return new Error(`${fallbackMessage} (${response.status})`);
    }
}

export async function createGoogleContact(contact, accessToken) {
    const person = {
        names: [{ unstructuredName: contact.name }]
    };
    if (contact.email) person.emailAddresses = [{ value: contact.email }];
    if (contact.phone) person.phoneNumbers = [{ value: contact.phone }];
    if (contact.address) person.addresses = [{ formattedValue: contact.address }];
    if (contact.birthday) {
        const [year, month, day] = contact.birthday.split('-').map(Number);
        person.birthdays = [{ date: { year, month, day } }];
    }

    const response = await fetch(
        'https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses,phoneNumbers,addresses,birthdays,metadata',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(person)
        }
    );
    if (!response.ok) throw await apiError(response, 'Could not create the Google contact');
    return response.json();
}

export async function updateGoogleContact(contact, accessToken) {
    if (!contact.googleMetadata) {
        const latestResponse = await fetch(
            `https://people.googleapis.com/v1/${contact.resourceName}?personFields=metadata`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (!latestResponse.ok) {
            throw await apiError(latestResponse, 'Could not read the Google contact before updating');
        }
        const latestPerson = await latestResponse.json();
        contact.googleMetadata = latestPerson.metadata;
    }

    const fields = 'names,emailAddresses,phoneNumbers,addresses,birthdays';
    const response = await fetch(
        `https://people.googleapis.com/v1/${contact.resourceName}:updateContact` +
        `?updatePersonFields=${fields}&personFields=${fields},metadata`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                resourceName: contact.resourceName,
                metadata: contact.googleMetadata,
                names: [{ unstructuredName: contact.name }],
                emailAddresses: contact.email ? [{ value: contact.email }] : [],
                phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
                addresses: contact.address ? [{ formattedValue: contact.address }] : [],
                birthdays: contact.birthday ? (() => {
                    const [year, month, day] = contact.birthday.split('-').map(Number);
                    return [{ date: { year, month, day } }];
                })() : []
            })
        }
    );
    if (!response.ok) throw await apiError(response, 'Could not update the Google contact');
    return response.json();
}

export async function uploadGoogleContactPhoto(contact, accessToken) {
    const response = await fetch(
        `https://people.googleapis.com/v1/${contact.resourceName}:updateContactPhoto`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                photoBytes: await blobToBase64(contact.photo),
                personFields: 'metadata,photos'
            })
        }
    );
    if (!response.ok) throw await apiError(response, 'Contact created, but photo upload failed');
    const result = await response.json();
    return result.person || null;
}

export async function fetchGooglePhoto(url) {
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

export async function runWithConcurrency(items, limit, task) {
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
