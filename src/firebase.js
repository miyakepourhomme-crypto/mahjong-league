import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDfE7rRw97KVyKNxGcP4Zxiw4dlFsKKdqs",
  authDomain: "mahjong-league-498e0.firebaseapp.com",
  projectId: "mahjong-league-498e0",
  storageBucket: "mahjong-league-498e0.firebasestorage.app",
  messagingSenderId: "983056403979",
  appId: "1:983056403979:web:f225b6d9525f3faaa6c10e"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);