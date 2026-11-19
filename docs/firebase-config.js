// Firebase web config. These values are NOT secrets (they identify the project; Firestore rules + Auth protect data).
export const firebaseConfig = {
  apiKey: 'AIzaSyCUrprUe6KZElicnL4wdyaxeEzbKAkhp6o',
  // On Firebase Hosting the auth handler is same-origin, which avoids iOS Safari's storage-partitioning sign-in error.
  authDomain: /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) ? location.hostname : 'nabc2027-47ab7.firebaseapp.com',
  projectId: 'nabc2027-47ab7',
  storageBucket: 'nabc2027-47ab7.firebasestorage.app',
  messagingSenderId: '960967574318',
  appId: '1:960967574318:web:f180620a9f18f20c4730bf',
};
