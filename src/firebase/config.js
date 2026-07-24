// Firebase bootstrap. NOTE: these web config values are *meant* to be public —
// they identify the project, they are not secrets. Access is controlled by
// Firebase Security Rules (see firestore.rules), not by hiding this config.
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyAvh4_8_xNBvg6QFxgRpy2Z7QI99mvxrsY',
  authDomain: 'digi-typer.firebaseapp.com',
  projectId: 'digi-typer',
  storageBucket: 'digi-typer.firebasestorage.app',
  messagingSenderId: '708032044767',
  appId: '1:708032044767:web:999c3e8ed31af7fee0936a',
  measurementId: 'G-D4VLNZLBSG',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Analytics is optional and only works on https/localhost with a supported
// browser — load it lazily and never let it break the app.
export async function initAnalytics() {
  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics');
    if (await isSupported()) return getAnalytics(app);
  } catch {
    /* analytics unavailable — ignore */
  }
  return null;
}
