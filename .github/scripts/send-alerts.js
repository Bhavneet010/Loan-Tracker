const admin = require('firebase-admin');

// Load Service Account from GitHub Secrets
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT secret.");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- Helpers ---
async function sendMulticast(tokens, title, body) {
  if (!tokens || tokens.length === 0) return;
  const payload = { notification: { title, body }, tokens };
  try {
    const response = await admin.messaging().sendEachForMulticast(payload);
    console.log(`Sent to ${tokens.length} devices. Success: ${response.successCount}, Failed: ${response.failureCount}`);
  } catch(e) {
    console.error("Push error:", e);
  }
}

async function getAdminTokens() {
  const snap = await db.collection("fcmTokens").where("isAdmin", "==", true).get();
  const tokens = [];
  snap.forEach(d => { if (d.data().token) tokens.push(d.data().token); });
  return tokens;
}

async function getOfficerTokens(officer) {
  const snap = await db.collection("fcmTokens").where("user", "==", officer).get();
  const tokens = [];
  snap.forEach(d => { if (d.data().token) tokens.push(d.data().token); });
  return tokens;
}

// --- Main Logic based on UTC Hour ---
const now = new Date();
const hoursUTC = now.getUTCHours();

async function run() {
  // 1. 9:00 AM IST (3:30 AM UTC) - Officer Warnings
  if (hoursUTC === 3) {
    console.log("Running 9:00 AM IST Officer Alerts...");
    const today = new Date();
    today.setUTCHours(today.getUTCHours() + 5, today.getUTCMinutes() + 30); // IST Offset
    today.setHours(0,0,0,0);
    
    const loansSnap = await db.collection("loans").get();
    const officerWarnings = {};
    
    loansSnap.forEach(doc => {
      const loan = doc.data();
      const officer = loan.allocatedTo;
      if (!officer || officer === "Admin") return;
      
      if (!officerWarnings[officer]) officerWarnings[officer] = { oldPending: 0, renewalsDue: 0 };
      
      if (loan.status === "pending" && loan.receiveDate) {
        const receiveDate = new Date(loan.receiveDate);
        const diffDays = Math.floor((today - receiveDate) / (1000 * 60 * 60 * 24));
        if (diffDays > 10) officerWarnings[officer].oldPending++;
      }
      
      if (loan.category === "SME" && loan.renewalDueDate && !loan.renewedDate) {
        const dueDate = new Date(loan.renewalDueDate);
        const diffDays = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) officerWarnings[officer].renewalsDue++;
      }
    });
    
    for (const [officer, stats] of Object.entries(officerWarnings)) {
      const tokens = await getOfficerTokens(officer);
      if (stats.oldPending > 0) {
        await sendMulticast(tokens, "Action Required ⏳", `You have ${stats.oldPending} loans pending for over 10 days.`);
      }
      if (stats.renewalsDue > 0) {
        await sendMulticast(tokens, "Renewals Alert ⚠️", `You have ${stats.renewalsDue} SME renewals due within 7 days or overdue.`);
      }
    }
  }

  // 2. 7:00 PM IST (13:30 UTC) - Daily Admin Prompt
  if (hoursUTC === 13) {
    console.log("Running 7:00 PM IST Admin Prompt...");
    const tokens = await getAdminTokens();
    await sendMulticast(tokens, "Daily Snapshot Time 📊", "It's 7:00 PM. Please generate and share today's daily snapshot with the team.");
  }

  // 3. 7:30 PM IST (14:00 UTC) - Admin Reminder
  if (hoursUTC === 14) {
    console.log("Running 7:30 PM IST Admin Reminder...");
    const today = new Date();
    today.setUTCHours(today.getUTCHours() + 5, today.getUTCMinutes() + 30);
    const dateStr = today.toISOString().split("T")[0];
    
    const logDoc = await db.collection("snapshotLogs").doc(dateStr).get();
    if (!logDoc.exists) {
      const tokens = await getAdminTokens();
      await sendMulticast(tokens, "⚠️ Missing Snapshot", "Reminder: Today's snapshot hasn't been shared yet! Please tap to open the app and share it now.");
    } else {
      console.log("Snapshot already shared today. Skipping reminder.");
    }
  }
}

run().then(() => {
  console.log("Checks complete.");
  process.exit(0);
}).catch(err => {
  console.error("Critical Error:", err);
  process.exit(1);
});
