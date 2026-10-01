const crypto = require("crypto");

const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = "iTzDeb/zoom-to-telegram";
const ALERT_BOT_TOKEN = process.env.ALERT_BOT_TOKEN || "8887021473:AAEg_d_HVApFL8GtJdb_pSOVngDMxzihZE0";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "499900380";

// --- Telegram Core Utils ---
async function sendTelegramAlert(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
    });
  } catch (err) { console.error("Alert error:", err.message); }
}

async function updateTelegramMessage(chatId, messageId, newText) {
  try {
    await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: newText, parse_mode: "Markdown" })
    });
  } catch (err) { console.error("Edit error:", err.message); }
}

async function answerTelegramCallback(callbackQueryId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
    });
  } catch (err) { console.error("Callback error:", err.message); }
}

// --- GitHub API Engine ---
async function dispatchGitHubWorkflow(eventType, payload) {
  try {
    await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${GITHUB_PAT}`, 
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ event_type: eventType, client_payload: payload })
    });
  } catch (err) { console.error("GitHub Dispatch Error:", err.message); }
}

async function cancelActiveMonitor(meetingId) {
  try {
    // Find all currently running workflows
    const runsRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?status=in_progress`, {
      headers: { "Authorization": `Bearer ${GITHUB_PAT}`, "Accept": "application/vnd.github.v3+json" }
    });
    
    if (!runsRes.ok) return;
    const runsData = await runsRes.json();
    
    // Locate the specific monitor workflow using its dynamic run-name
    const targetRun = runsData.workflow_runs.find(run => run.name === `Monitor-${meetingId}`);
    
    // Kill the workflow
    if (targetRun) {
      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${targetRun.id}/cancel`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${GITHUB_PAT}`, "Accept": "application/vnd.github.v3+json" }
      });
      console.log(`[VERCEL] Successfully cancelled GitHub run: Monitor-${meetingId}`);
    }
  } catch (err) {
    console.error("Cancel Workflow Error:", err.message);
  }
}

// --- Vercel Request Handler ---
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const body = req.body;

  // 1. TELEGRAM INLINE BUTTON (Mute Warnings)
  if (body && body.callback_query) {
    const cb = body.callback_query;
    const data = cb.data || '';
    const user = cb.from.first_name || 'Admin';

    if (data.startsWith('mute_')) {
      const meetingId = data.replace('mute_', '');
      
      // Stop Telegram loading spinner immediately
      await answerTelegramCallback(cb.id, "Alerts muted.");
      
      // Update original message to show confirmation
      const newText = `${cb.message.text}\n\n🔕 *Alerts muted by ${user}. No further warnings will be sent.*`;
      await updateTelegramMessage(cb.message.chat.id, cb.message.message_id, newText);

      // Kill the GitHub Action timer
      await cancelActiveMonitor(meetingId);
    }
    return res.status(200).send("OK");
  }

  // 2. ZOOM URL HANDSHAKE
  if (body && body.event === "endpoint.url_validation") {
    const hashForValidate = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET)
      .update(body.payload.plainToken).digest('hex');
    return res.status(200).json({ plainToken: body.payload.plainToken, encryptedToken: hashForValidate });
  }

  // 3. ZOOM EVENT ROUTING
  const eventType = body?.event;
  const meetingObj = body?.payload?.object || {};
  const meetingId = String(meetingObj.id || meetingObj.uuid || '');
  const topic = meetingObj.topic || "Zoom Class";

  if (eventType === "meeting.started") {
    // Start GitHub Stopwatch
    await dispatchGitHubWorkflow("start_monitor", { 
      meeting_id: meetingId, 
      topic: topic, 
      start_time: meetingObj.start_time || "" 
    });
    return res.status(200).send("OK");
  }

  if (eventType === "recording.started") {
    await sendTelegramAlert(ADMIN_CHAT_ID, `🔴 **Zoom Cloud Recording Started**\n\n📌 **Topic:** \`${topic}\``);
    await cancelActiveMonitor(meetingId); // Kill stopwatch instantly
    return res.status(200).send("OK");
  }
  
  if (eventType === "meeting.ended") {
    await cancelActiveMonitor(meetingId); // Kill stopwatch instantly
    return res.status(200).send("OK");
  }

  if (eventType === "recording.stopped") {
    await sendTelegramAlert(ADMIN_CHAT_ID, `⏹️ **Zoom Cloud Recording Stopped**\n\n📌 **Topic:** \`${topic}\`\n⏳ Rendering on Zoom cloud servers...`);
    return res.status(200).send("OK");
  }

  if (eventType === "recording.completed") {
    const mp4File = meetingObj.recording_files?.find(f => f.file_extension === "MP4");
    if (mp4File) {
      const downloadUrl = mp4File.download_url + "?access_token=" + body.download_token;
      await sendTelegramAlert(ADMIN_CHAT_ID, `⚙️ **Zoom Cloud Processing Complete**\n\n📌 **Topic:** \`${topic}\`\n🚀 Dispatching GitHub Action Cloud Uploader...`);
      await dispatchGitHubWorkflow("zoom_recording_ready", { download_url: downloadUrl, folder_name: topic });
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("Ignored");
};
