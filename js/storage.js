import { DATABASE } from './config.js';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE.name, DATABASE.version);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DATABASE.storeName)) {
                db.createObjectStore(DATABASE.storeName);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function writeContacts(contacts, source, labelGroups = [], labelUi = {}) {
    const savedAt = new Date().toISOString();
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE.storeName, 'readwrite');
        transaction.objectStore(DATABASE.storeName).put(
            { contacts, source, savedAt, labelGroups, labelUi },
            DATABASE.contactsKey
        );
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    return savedAt;
}

export async function readContacts() {
    const db = await openDatabase();
    const savedData = await new Promise((resolve, reject) => {
        const request = db.transaction(DATABASE.storeName, 'readonly')
            .objectStore(DATABASE.storeName)
            .get(DATABASE.contactsKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return savedData;
}

export async function removeContacts() {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE.storeName, 'readwrite');
        transaction.objectStore(DATABASE.storeName).delete(DATABASE.contactsKey);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    db.close();
}
