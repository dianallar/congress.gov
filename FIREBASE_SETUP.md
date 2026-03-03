# Chirper Firebase Setup

To run Chirper with Firebase (so app data is stored in Firestore backend):

1. **Create/select a Firebase project** in Firebase Console.
2. **Create a Web App** in that project and copy the config object.
3. In this repo, copy `firebase-config.example.js` to `firebase-config.js` and paste your config values.
4. In Firebase Console, enable **Cloud Firestore** (start in production or test mode as desired).
5. Add Firestore rules for your use case. For local testing only, you can use:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chirper/{docId} {
      allow read, write: if true;
    }
  }
}
```

6. Serve the app:

```bash
python -m http.server 8000 --directory .
```

7. Open `http://localhost:8000/index.html`.

## What changed in-app

- Chirper now loads `firebase-config.js` automatically.
- If `window.CHIRPER_FIREBASE` is present and valid, Chirper uses Firestore doc `chirper/state`.
- Existing browser `localStorage` data is migrated one time to Firestore if no remote state exists.
- After Firebase connects, local `ch_*` keys are cleared so data is no longer persisted in browser localStorage.
- Login session (`ch_sess`) is now stored in `sessionStorage` only (per-browser-tab session), not in shared backend state.

## Troubleshooting

- If you still see local-only behavior, check browser console for Firebase init errors.
- Confirm your `projectId` matches your Firestore project.
- Ensure Firestore rules allow read/write to `/chirper/state`.
