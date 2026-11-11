# Gather — Live Photo & Video Sharing

A responsive, QR-based event gallery. Admins create galleries; guests scan a QR code and upload photos/videos; everyone sees new uploads live and can download one file or a ZIP of all media.

## Included
- `index.html`, `style.css`, `app.js`
- `firebase-config.js` (paste your Firebase web app config here)
- `firestore.rules`, `storage.rules`, `firebase.json`
- QR code generation, live Firestore gallery, camera/gallery file pickers, upload progress, individual download, ZIP download.

## Before publishing — Firebase setup

1. Create a project at https://console.firebase.google.com/
2. Add a **Web app** and copy its Firebase config into `firebase-config.js`. Replace all `PASTE_...` values. The web config is visible to visitors by design; security comes from Firebase Rules, not hiding this config.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. In **Authentication → Users**, add your own admin user and set a strong password.
5. In **Firestore Database**, create the database.
6. In **Storage**, enable the bucket. Depending on your Firebase/Google Cloud plan and current project requirements, Storage may require billing to be enabled.
7. In Firestore, manually create a collection named `admins`. Add a document whose document ID is the admin user's **Authentication UID**. Add field `enabled` (boolean) = `true`. This grants that user admin privileges. Do not create this document for guests.
8. Publish `firestore.rules` in Firestore → Rules and `storage.rules` in Storage → Rules. The included rules allow anyone who has a session link to read and upload media to an active gallery; only admins can create/close galleries and delete uploaded files. A QR link is a bearer link, so do not post it publicly if the gallery is meant to be limited to invitees.
9. In Firestore → Indexes, if Firebase asks for a composite index for the admin gallery query (`ownerUid` + `createdAt`), follow the link in the Firebase error and create it. Some projects may serve the query without an extra index.

## GitHub Pages deployment

1. Create a GitHub repository, e.g. `gather-photo-sharing`.
2. Upload all project files from this folder to the repository root (not inside another nested folder).
3. Open **Settings → Pages**.
4. Under Build and deployment, choose **Deploy from a branch**, select `main` and `/(root)`, then Save.
5. Wait for GitHub Pages to publish. Open the HTTPS URL.
6. Visit `https://YOUR-USERNAME.github.io/YOUR-REPO/?admin=1`, sign in, create a gallery, then download/print the QR code.
7. Scan the QR code with a phone. Guests can upload. The gallery updates live.

### Important GitHub Pages note
GitHub Pages serves static files only. Firebase is the backend. Keep the Firebase configuration in the root as `firebase-config.js`; do not use a private service-account JSON file in the website.

## Download-all ZIP (CORS setup)

Individual downloads may fall back to opening the original media URL if the browser blocks a cross-origin fetch. The **Download all** ZIP feature fetches each file and therefore needs the Firebase Storage bucket to allow CORS from your published website origin.

1. Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. Create `cors.json` with your exact GitHub Pages origin. Example below — replace the origin:
   ```json
   [
     {
       "origin": ["https://YOUR-USERNAME.github.io"],
       "method": ["GET", "HEAD"],
       "responseHeader": ["Content-Type", "Access-Control-Allow-Origin"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
3. Authenticate with the Google account that owns the Firebase project:
   `gcloud auth login`
4. Set your project:
   `gcloud config set project YOUR_PROJECT_ID`
5. Apply CORS to the Storage bucket:
   `gcloud storage buckets update gs://YOUR_STORAGE_BUCKET --cors-file=cors.json`
   Use the exact bucket name shown in Firebase Storage / Project settings. If your repository is a project site, the browser origin is still `https://YOUR-USERNAME.github.io` (not the path).
6. Wait a few minutes and test Download all again.

## How to use

- Admin: open `?admin=1`, sign in, click **New gallery**, enter an event name. Use **QR code** to display/save the code and **Copy link** to share.
- Guest: scan the QR code. Choose **Take a photo**, **Record a video**, or **Choose files**. On supported mobile browsers, the capture controls open the camera. Camera behavior depends on the device/browser; the user must confirm the capture/upload.
- Gallery: uploaded media appears live. Tap a thumbnail to preview; use the download icon for one file or **Download all** for a ZIP.

## Security and production checklist

- The QR URL is a secret-style invitation link, not identity verification. Anyone who receives/forwards it can upload and view gallery media while the session is active.
- The current sample intentionally makes gallery media readable by anyone with the link so all guests can see it. Do not use for sensitive/private media without adding guest authentication or a stronger invite-token design.
- Add Firebase App Check, rate limits, abuse reporting, moderation, and stricter quotas before public commercial use.
- Review Firebase billing and set budget alerts. Video storage/bandwidth can cost money.
- The sample uses a 200 MB per-file cap. Lower it if appropriate.
- Browser downloads are subject to device/browser behavior. On iOS/Android, the browser may save to Downloads or open a share/save sheet; a website cannot force a file into the Photos app.
- Firebase Storage rules validate file MIME type and size, but MIME type is supplied by the browser and is not a malware scan. Consider server-side validation/scanning for public use.
- The code uses Firebase JS SDK CDN imports. An internet connection is required.

## Troubleshooting

- **“Add your Firebase web config…”**: replace placeholders in `firebase-config.js`.
- **Sign-in fails**: check Email/Password is enabled and the user exists in Firebase Authentication.
- **Admin cannot create gallery**: check the `admins/{UID}` document exists with `enabled: true`, and publish the Firestore rules.
- **Guests cannot upload**: check Storage is enabled, Storage rules are published, the session is active, and the file is under 200 MB.
- **New uploads do not show**: check Firestore rules and browser console errors.
- **Download all fails**: apply the Storage CORS instructions above.
- **Camera does not open**: use the hosted HTTPS URL and a supported mobile browser; alternatively use Choose files.
