import { S } from "./state.js";
import { db, app } from "./config.js";
import { toast } from "./utils.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js";

// ⚠️ IMPORTANT: Replace this with your Web Push certificate key from Firebase Console
// 1. Go to Firebase Console -> Project Settings -> Cloud Messaging
// 2. Scroll to "Web configuration" -> Generate Key Pair
const VAPID_KEY = "BPDdx8f1dd3U5JTBuPfcdfVkwKTI4E23_b4lLRQF9t7tsIeDHnmv3MZlklxgOW9rlQ1ov8CJ_MAK0woycuZsTaM";

export async function initPushNotifications() {
  if (!S.user) return; 

  const supported = await isSupported();
  if (!supported) {
    console.warn('[Push] Not supported in this browser.');
    return;
  }

  const messaging = getMessaging(app);

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Permission denied.');
      return;
    }

    if (VAPID_KEY === "YOUR_VAPID_KEY_HERE") {
      console.warn('[Push] VAPID Key is missing! Cannot fetch token.');
      return;
    }

    const currentToken = await getToken(messaging, { 
      vapidKey: VAPID_KEY 
    });

    if (currentToken) {
      console.log('[Push] Token successfully received.');
      const tokenRef = doc(db, 'fcmTokens', currentToken);
      await setDoc(tokenRef, {
        token: currentToken,
        user: S.user,
        isAdmin: !!S.isAdmin,
        updatedAt: new Date().toISOString(),
        userAgent: navigator.userAgent
      }, { merge: true });
    }
  } catch (err) {
    console.warn('[Push] Error retrieving token:', err);
  }

  // Handle foreground messages (when the app is actively open)
  onMessage(messaging, (payload) => {
    console.log('[Push] Foreground message received:', payload);
    if (payload.notification) {
      toast(`🔔 ${payload.notification.title}`);
    }
  });
}
