// firebase.ts

import { initializeApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

let firebaseInitialized = false;
let firebaseError: string | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Check that the config variables are loaded
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error("Firebase config is missing. Make sure .env.local is set up and vite.config.ts is correct.");
  firebaseError = "Firebase configuration is missing. The application cannot start.";
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseInitialized = true;
  } catch (error: any) {
    console.error("Firebase initialization error:", error);
    firebaseInitialized = false;
    firebaseError = error?.message || "Unknown error during Firebase initialization";
  }
}

export { auth, db, firebaseInitialized, firebaseError };
