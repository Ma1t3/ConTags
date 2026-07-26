import { MAX_PHOTO_FILE_SIZE, PHOTO_SIZE } from './config.js';

const photoObjectUrls = new WeakMap();

export async function preparePhoto(fileOrBlob) {
    if (fileOrBlob.type && !fileOrBlob.type.startsWith('image/')) {
        throw new Error('Please choose a valid image file.');
    }
    if (fileOrBlob.size > MAX_PHOTO_FILE_SIZE) {
        throw new Error('The photo must be smaller than 10 MB.');
    }

    const bitmap = await createImageBitmap(fileOrBlob);
    const scale = Math.min(1, PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(
        bitmap,
        0, 0, bitmap.width, bitmap.height,
        0, 0, targetWidth, targetHeight
    );
    bitmap.close();

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('The photo could not be processed.')),
            'image/jpeg',
            0.92
        );
    });
}

export function getPhotoUrl(photo) {
    if (!photo) return '';
    if (!photoObjectUrls.has(photo)) {
        photoObjectUrls.set(photo, URL.createObjectURL(photo));
    }
    return photoObjectUrls.get(photo);
}

export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(new Error('The profile photo could not be encoded.'));
        reader.readAsDataURL(blob);
    });
}
