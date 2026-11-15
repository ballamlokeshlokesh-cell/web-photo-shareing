# Gather — Live Photo & Video Sharing

A modern, responsive, QR-based live event gallery. Admins create galleries; guests scan a QR code with their phone camera and upload photos/videos instantly; everyone sees new uploads arrive live and can download individual photos or a ZIP of all media.

---

## ✨ Features

- **Instant QR Code Sharing**: Guests scan a QR code to jump straight to the live event gallery. No app install required!
- **Mobile Camera & Gallery Uploads**: Take photos/videos directly from mobile browsers or pick multiple files from device storage.
- **Drag & Drop**: Desktop users can simply drag and drop photos onto the upload panel.
- **Smart Image Optimization**: Large high-resolution smartphone photos are automatically optimized before uploading for fast transfers and minimal bandwidth.
- **Live Real-Time Gallery**: New photos and videos appear in real time without refreshing.
- **Resilient Upload Engine**: Seamless fallback support so photo uploading works reliably.
- **Instant Demo Mode**: Test and preview the full photo-sharing experience locally without waiting for backend setup.
- **ZIP & Individual Downloads**: Download any single memory or pack the entire event gallery into a ZIP file.
- **Admin Control Center**: Easily create, view, open, close, and manage all your event galleries.

---

## 🚀 Quick Start (GitHub Pages)

The repository is configured with a GitHub Actions workflow to deploy automatically to GitHub Pages.

1. Open your published website URL:
   `https://ballamlokeshlokesh-cell.github.io/web-photo-shareing/`
2. **Guests**: Paste any shared gallery link or event code into the **Join an Event Gallery** box and click **Join & View Photos** to immediately view pictures and upload photos/videos.
3. **Hosts**: Click **Sign In / Create Account** to sign in or register your host account.
4. Once signed in, the **＋ Create a gallery** button will appear on the homepage and in your control center.
5. Click **Create a gallery**, give your event a name, and generate your live QR code ready to print or share!

---

## 🔒 Firebase Configuration & Setup

Your `firebase-config.js` is already configured with your Firebase project credentials.

To enable live cross-device cloud sync, ensure your Firebase Console has the following configured:

### 1. Enable Email/Password Authentication
1. Go to [Firebase Console](https://console.firebase.google.com/) → Select your project (`web-photo-sharing-7714e`).
2. Navigate to **Authentication** → **Sign-in method** tab.
3. Ensure **Email/Password** is enabled.

### 2. Publish Firestore Security Rules
1. In Firebase Console, go to **Firestore Database** → **Rules** tab.
2. Copy and paste the contents of `firestore.rules`:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function signedIn() { return request.auth != null; }

       match /admins/{uid} {
         allow read, write: if signedIn() && request.auth.uid == uid;
       }

       match /sessions/{sessionId} {
         allow read: if true;
         allow create: if signedIn()
           && request.resource.data.name is string
           && request.resource.data.name.size() > 0
           && request.resource.data.name.size() <= 100;
         allow update, delete: if signedIn()
           && (resource.data.ownerUid == request.auth.uid || !('ownerUid' in resource.data));

         match /uploads/{uploadId} {
           allow read: if true;
           allow create: if request.resource.data.name is string
             && request.resource.data.contentType is string
             && request.resource.data.url is string;
           allow update: if false;
           allow delete: if signedIn()
             && get(/databases/$(database)/documents/sessions/$(sessionId)).data.ownerUid == request.auth.uid;
         }
       }
     }
   }
   ```
3. Click **Publish**.

### 3. Publish Firebase Storage Security Rules
1. In Firebase Console, go to **Storage** → **Rules** tab.
2. Copy and paste the contents of `storage.rules`:
   ```javascript
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /sessions/{sessionId}/{fileName} {
         allow read: if true;
         allow create: if request.resource.size > 0
           && request.resource.size <= 209715200;
         allow update: if false;
         allow delete: if request.auth != null;
       }
     }
   }
   ```
3. Click **Publish**.

---

## 🛠️ Storage CORS Setup (For "Download All" ZIP)

Individual photo downloads work out of the box. For the **Download all** ZIP feature to bundle files cross-origin:

1. Install Google Cloud SDK (`gcloud`).
2. Run:
   ```bash
   gcloud auth login
   gcloud config set project web-photo-sharing-7714e
   gcloud storage buckets update gs://web-photo-sharing-7714e.firebasestorage.app --cors-file=cors.json
   ```

---

## 📁 Repository Structure

```
├── index.html            # Main web application UI
├── style.css             # Responsive styling & design system
├── app.js                # Core logic, Firebase integrations & image optimizer
├── firebase-config.js    # Firebase web configuration
├── firestore.rules       # Cloud Firestore security rules
├── storage.rules         # Firebase Storage security rules
├── cors.json             # CORS configuration for Storage bucket
└── .github/workflows/    # Automated GitHub Pages deployment workflow
```
