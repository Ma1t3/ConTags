# ConTags

A simple, secure client-side web application for searching and filtering through your imported contacts via your custom tags.
Use it by clicking the link: https://ma1t3.github.io/ConTags/

## Features
- **Instant Search & Filtering:** Quickly search by name, phone, or email. Filter contacts by checking off required label tags.
- **Cross-Platform PWA:** Install ConTags directly to your Android or Desktop home screen. It feels and runs exactly like a native app.
- **Complete Client-Side Privacy:** Your contacts never leave your device. The CSV parsing (using `PapaParse`) happens entirely within your browser memory.

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
