const crypto = require("crypto");

async function sendTelegramAlert(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
    });
  } catch (err) {
    console.error("Failed to send alert from Vercel:", err.message);
  }
}

// NEW: Forward payload to Google Apps Script for the 3-minute timer
async function forwardToGAS(body) {
  const GAS_URL = process.env.GAS_WEBHOOK_URL; 
  if (!GAS_URL) return;
  try {
    await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error("Failed to forward to GAS:", err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET;
  const GITHUB_PAT = process.env.GITHUB_PAT;
  const GITHUB_REPO = "iTzDeb/zoom-to-telegram";
  const ALERT_BOT_TOKEN = process.env.ALERT_BOT_TOKEN || "8887021473:AAEg_d_HVApFL8GtJdb_pSOVngDMxzihZE0";
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "499900380";

  const body = req.body;

  // 1. Zoom Security Validation Handshake
  if (body && body.event === "endpoint.url_validation") {
    const hashForValidate = crypto.createHmac('sha256', ZOOM_WEBHOOK_SECRET)
      .update(body.payload.plainToken)
      .digest('hex');
    
    return res.status(200).json({
      plainToken: body.payload.plainToken,
      encryptedToken: hashForValidate
    });
  }

  const topic = body?.payload?.object?.topic || "Zoom Class";

  // 2. Meeting Started -> Forward to GAS to start the 3-minute stopwatch
  if (body && body.event === "meeting.started") {
    await forwardToGAS(body);
    return res.status(200).send("OK");
  }

  // 3. Real-Time Status Alerts & Forwarding
  if (body && body.event === "recording.started") {
    await sendTelegramAlert(ALERT_BOT_TOKEN, ADMIN_CHAT_ID, `🔴 **Zoom Cloud Recording Started**\n\n📌 **Topic:** \`${topic}\``);
    await forwardToGAS(body); // Forward to GAS to stop the timer
    return res.status(200).send("OK");
  }

  if (body && body.event === "recording.stopped") {
    await sendTelegramAlert(ALERT_BOT_TOKEN, ADMIN_CHAT_ID, `⏹️ **Zoom Cloud Recording Stopped**\n\n📌 **Topic:** \`${topic}\`\n⏳ Rendering on Zoom cloud servers...`);
    return res.status(200).send("OK");
  }

  // 4. Relay Recording Data to GitHub Actions on Completion
  if (body && body.event === "recording.completed") {
    const mp4File = body.payload.object.recording_files?.find(f => f.file_extension === "MP4");
    if (mp4File) {
      const downloadUrl = mp4File.download_url + "?access_token=" + body.download_token;
      
      await sendTelegramAlert(ALERT_BOT_TOKEN, ADMIN_CHAT_ID, `⚙️ **Zoom Cloud Processing Complete**\n\n📌 **Topic:** \`${topic}\`\n🚀 Dispatching GitHub Action Cloud Uploader...`);

      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${GITHUB_PAT}`, 
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          event_type: "zoom_recording_ready",
          client_payload: { download_url: downloadUrl, folder_name: topic }
        })
      });
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("Ignored");
};
