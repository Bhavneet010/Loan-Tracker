import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const FB = {
  apiKey: "AIzaSyDY0AMy0eZI_74nJSoy46uHqgKvh9NkKw8",
  authDomain: "loan-tracker-4af27.firebaseapp.com",
  projectId: "loan-tracker-4af27",
  storageBucket: "loan-tracker-4af27.firebasestorage.app",
  messagingSenderId: "700827916451",
  appId: "1:700827916451:web:d872bf2905d234bdb60716"
};

export const app = initializeApp(FB);
export const db = getFirestore(app);
