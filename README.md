# ConTags

A simple, secure client-side web application for searching and filtering through your imported contacts via your custom tags.
Use it by clicking the link: https://ma1t3.github.io/ConTags/

## Features
- **Instant Search & Filtering:** Quickly search by name, phone, or email. Filter contacts by checking off required label tags.
- **Cross-Platform PWA:** Install ConTags directly to your Android or Desktop home screen. It feels and runs exactly like a native app.
- **Complete Client-Side Privacy:** Your contacts never leave your device. The CSV parsing (using `PapaParse`) happens entirely within your browser memory.
- **Birthday reminders:** Enable local Android/PWA notifications from the settings menu. ConTags checks birthdays whenever it opens and uses Periodic Background Sync where the browser permits it.

Birthday reminders require notification permission and an installed PWA. Android may delay or suppress periodic background checks depending on battery settings and site engagement. Guaranteed delivery while the app is closed requires a separate Web Push server (not included in this client-only deployment).

## Mobile Installation
Because ConTags is a Progressive Web App (PWA):
1. Navigate to the app link above using a chromium-based browser on your Android device.
2. Tap the browser menu (⋮).
3. Select **"Add to Home Screen"**.
4. The app will install onto your device like a regular application.

## Tech Stack
This application is built using standard, framework-free web technologies:
- HTML5
- Vanilla CSS 
- Vanilla JavaScript
- [PapaParse](https://www.papaparse.com/) (For CSV Data Extraction)
- [Phosphor Icons](https://phosphoricons.com/)

## Microsoft Outlook sync

ConTags can import and synchronize contacts through Microsoft Graph. Before using it:

1. Register an application in Microsoft Entra ID.
2. Enable personal Microsoft accounts and work/school accounts.
3. Add the deployed ConTags URL as a **Single-page application** redirect URI.
4. Add the delegated Microsoft Graph permission `Contacts.ReadWrite`.
5. Put the application (client) ID in `MICROSOFT_CLIENT_ID` in `js/config.js`.

No client secret is used or stored in this browser application.

## Portable contacts

The import menu accepts vCard (`.vcf`) files, and the settings menu can export all
locally stored contacts as a vCard file.
