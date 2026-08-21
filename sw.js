const CACHE_NAME = 'contags-v43';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './js/app.js',
  './js/config.js',
  './js/dom.js',
  './js/text-utils.js',
  './js/image-utils.js',
  './js/storage.js',
  './js/google-api.js',
  './js/microsoft-api.js',
  './js/vcard.js',
  './js/csv-utils.js',
  './js/contact-map.js',
  './js/ui-menus.js',
  './js/contact-renderer.js',
  './js/contact-label-editor.js',
  './js/version.js',
  './js/service-worker-registration.js',
  './js/birthday-notifications.js',
  './manifest.json',
  './icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseCopy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

const BIRTHDAY_DB = 'contags-notifications';
const BIRTHDAY_STORE = 'settings';

function openBirthdayDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BIRTHDAY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(BIRTHDAY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setBirthdayData(value) {
  const db = await openBirthdayDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(BIRTHDAY_STORE, 'readwrite');
    transaction.objectStore(BIRTHDAY_STORE).put(value, 'birthdays');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getBirthdayData() {
  const db = await openBirthdayDatabase();
  const value = await new Promise((resolve, reject) => {
    const request = db.transaction(BIRTHDAY_STORE).objectStore(BIRTHDAY_STORE).get('birthdays');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value || { enabled: false, birthdays: [], notifiedOn: {} };
}

async function checkBirthdays() {
  const data = await getBirthdayData();
  if (!data.enabled) return;
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const today = `${now.getFullYear()}-${monthDay}`;
  const matches = data.birthdays.filter(item => String(item.birthday).slice(5) === monthDay);
  for (const item of matches) {
    const key = `${item.name}|${item.birthday}`;
    if (data.notifiedOn[key] === today) continue;
    await self.registration.showNotification(`Birthday: ${item.name}`, {
      body: `${item.name} has a birthday today.`,
      icon: './icon.png',
      badge: './icon.png',
      tag: `birthday-${key}`,
      data: { url: './index.html' }
    });
    data.notifiedOn[key] = today;
  }
  await setBirthdayData(data);
}

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SYNC_BIRTHDAYS') return;
  event.waitUntil((async () => {
    const previous = await getBirthdayData();
    await setBirthdayData({
      enabled: Boolean(event.data.enabled),
      birthdays: Array.isArray(event.data.birthdays) ? event.data.birthdays : [],
      notifiedOn: previous.notifiedOn || {}
    });
    if (event.data.checkNow) await checkBirthdays();
  })());
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'contags-birthday-check') event.waitUntil(checkBirthdays());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows[0]) return windows[0].focus();
    return self.clients.openWindow(event.notification.data.url || './index.html');
  })());
});
