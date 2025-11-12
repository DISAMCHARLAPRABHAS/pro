





// Fix: Correctly import the namespaced firebase object for v8 compatibility.
// FIX: Use a namespace import for Firebase v8 to ensure types are resolved correctly.
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDwqJZ-ehCtES78zDT-jQz1xU-RkeD-O9Y",
  authDomain: "napse123.firebaseapp.com",
  projectId: "napse123",
  storageBucket: "napse123.appspot.com",
  messagingSenderId: "880397758755",
  appId: "1:880397758755:web:b471b6959522d5efc0dc96"
};

interface FirebaseServices {
    // Fix: Use v8 namespaced types
    auth: firebase.auth.Auth | null;
    db: firebase.firestore.Firestore | null;
    initialized: boolean;
    error: string | null;
}

function initializeFirebase(): FirebaseServices {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        const errorMsg = "Firebase configuration is missing. Sign-in and history features are disabled.";
        console.warn(errorMsg);
        return { auth: null, db: null, initialized: false, error: errorMsg };
    }

    try {
        // Fix: Use v8 namespaced API for initialization and service retrieval.
        // Also, prevent re-initialization.
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        const auth = firebase.auth();
        const db = firebase.firestore();
        return { auth, db, initialized: true, error: null };
    } catch (e) {
        const errorMsg = "Firebase initialization failed, likely due to an invalid configuration. Sign-in and history features are disabled.";
        console.error(errorMsg, e);
        return { auth: null, db: null, initialized: false, error: errorMsg };
    }
}

const { auth, db, initialized: firebaseInitialized, error: firebaseError } = initializeFirebase();

export { auth, db, firebaseInitialized, firebaseError };