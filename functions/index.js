const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// --- HELPER FUNCTIONS ---
async function sendPushToAdmins(title, body, data = {}) {
  const usersSnap = await db.collection("fcmTokens").where("isAdmin", "==", true).get();
  const tokens = [];
  usersSnap.forEach(doc => {
    if (doc.data().token) tokens.push(doc.data().token);
  });
  if (tokens.length === 0) return;

  const payload = {
    notification: { title, body },
    tokens: tokens
  };
  await admin.messaging().sendEachForMulticast(payload);
}

async function sendPushToOfficer(officerName, title, body) {
  const usersSnap = await db.collection("fcmTokens").where("user", "==", officerName).get();
  const tokens = [];
  usersSnap.forEach(doc => {
    if (doc.data().token) tokens.push(doc.data().token);
  });
  if (tokens.length === 0) return;

  const payload = {
    notification: { title, body },
    tokens: tokens
  };
  await admin.messaging().sendEachForMulticast(payload);
}

// 1. REAL-TIME ADMIN PING (Any Loan Added, Sanctioned, Returned, Renewed)
exports.onLoanChange = functions.firestore
  .document("loans/{loanId}")
  .onWrite(async (change, context) => {
    const loan = change.after.data();
    const oldLoan = change.before.data();
    
    if (!loan) return; // Loan was deleted

    if (!oldLoan) {
      // New loan added
      await sendPushToAdmins("New Loan Added 📝", \`Officer \${loan.allocatedTo} added \${loan.customerName} (Rs \${loan.amount}L)\`);
      return;
    }

    // Status changed
    if (loan.status !== oldLoan.status) {
      if (loan.status === "sanctioned") {
        await sendPushToAdmins("Loan Sanctioned 🎉", \`Officer \${loan.allocatedTo} sanctioned \${loan.customerName} (Rs \${loan.amount}L)\`);
      } else if (loan.status === "returned") {
        await sendPushToAdmins("Loan Returned ❌", \`Officer \${loan.allocatedTo} returned \${loan.customerName}\`);
      }
    }

    // Renewed
    if (loan.renewedDate && !oldLoan.renewedDate) {
      await sendPushToAdmins("Renewal Completed ✅", \`Officer \${loan.allocatedTo} completed renewal for \${loan.customerName}\`);
    }
  });

// 2. DAILY ADMIN PROMPT (7:00 PM) to share snapshot
exports.dailySnapshotPrompt = functions.pubsub.schedule("0 19 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async (context) => {
    await sendPushToAdmins("Daily Snapshot Time 📊", "It's 7:00 PM. Please generate and share today's daily snapshot with the team.");
  });

// 3. DAILY ADMIN REMINDER (7:30 PM) if snapshot wasn't shared
exports.dailySnapshotReminder = functions.pubsub.schedule("30 19 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async (context) => {
    const today = new Date();
    // Offset for IST (+5:30)
    today.setHours(today.getHours() + 5);
    today.setMinutes(today.getMinutes() + 30);
    const dateStr = today.toISOString().split("T")[0];
    
    const logDoc = await db.collection("snapshotLogs").doc(dateStr).get();
    if (!logDoc.exists) {
      await sendPushToAdmins("⚠️ Missing Snapshot", "Reminder: Today's snapshot hasn't been shared yet! Please tap to open the app and share it now.");
    }
  });

// 4. OFFICER WARNINGS (9:00 AM) - Pending > 10 days & SME Renewals
exports.dailyOfficerAlerts = functions.pubsub.schedule("0 9 * * *")
  .timeZone("Asia/Kolkata")
  .onRun(async (context) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Scan all loans
    const loansSnap = await db.collection("loans").get();
    const officerWarnings = {};
    
    loansSnap.forEach(doc => {
      const loan = doc.data();
      const officer = loan.allocatedTo;
      if (!officer || officer === "Admin") return;
      
      if (!officerWarnings[officer]) officerWarnings[officer] = { oldPending: 0, renewalsDue: 0 };
      
      // Check Pending > 10 days
      if (loan.status === "pending" && loan.receiveDate) {
        const receiveDate = new Date(loan.receiveDate);
        const diffDays = Math.floor((today - receiveDate) / (1000 * 60 * 60 * 24));
        if (diffDays > 10) {
          officerWarnings[officer].oldPending++;
        }
      }
      
      // Check SME Renewals (Due within 7 days or overdue)
      if (loan.category === "SME" && loan.renewalDueDate && !loan.renewedDate) {
        const dueDate = new Date(loan.renewalDueDate);
        const diffDays = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) {
          officerWarnings[officer].renewalsDue++;
        }
      }
    });
    
    // Send pushes directly to specific officers
    for (const [officer, stats] of Object.entries(officerWarnings)) {
      if (stats.oldPending > 0) {
        await sendPushToOfficer(officer, "Action Required ⏳", \`You have \${stats.oldPending} loans pending for over 10 days.\`);
      }
      if (stats.renewalsDue > 0) {
        await sendPushToOfficer(officer, "Renewals Alert ⚠️", \`You have \${stats.renewalsDue} SME renewals due within 7 days or overdue.\`);
      }
    }
  });
