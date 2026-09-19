const crypto = require("crypto");

module.exports = async function handler(req, res) {
  // Reject non-POST requests
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET;
  const GITHUB_PAT = process.env.GITHUB_PAT;
  const GITHUB_REPO = "iTzDeb/zoom-to-telegram"; 

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

  // 2. Relay Recording Data to GitHub Actions
  if (body && body.event === "recording.completed") {
    const mp4File = body.payload.object.recording_files?.find(f => f.file_extension === "MP4");
    if (mp4File) {
      const downloadUrl = mp4File.download_url + "?access_token=" + body.download_token;
      
      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${GITHUB_PAT}`, 
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          event_type: "zoom_recording_ready",
          client_payload: { download_url: downloadUrl, folder_name: body.payload.object.topic }
        })
      });
    }
    return res.status(200).send("OK");
  }

  return res.status(200).send("Ignored");
};
