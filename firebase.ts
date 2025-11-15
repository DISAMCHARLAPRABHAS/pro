// firebase.ts

import { initializeApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";

let firebaseInitialized = false;
let firebaseError: string | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

// User-provided Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBOjZvH8PX4KouBXb7yropp17wnX4zGfrk",
  authDomain: "resumate-130fd.firebaseapp.com",
  projectId: "resumate-130fd",
  storageBucket: "resumate-130fd.firebasestorage.app",
  messagingSenderId: "461763251484",
  appId: "1:461763251484:web:d1f5c865ea6d040795fed9",
  measurementId: "G-DS6E69RT3P"
};

try {
  // Initialize Firebase with the config object
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  firebaseInitialized = true;
} catch (error: any) {
  console.error("Firebase initialization error:", error);
  firebaseInitialized = false;
  firebaseError = error?.message || "Unknown error during Firebase initialization";
}

export { auth, db, firebaseInitialized, firebaseError };
