const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const axios = require("axios");
const fs = require("fs");
const https = require("https"); 

const { API_ID, API_HASH, STRING_SESSION, ALERT_BOT_TOKEN, ADMIN_CHAT_ID, DOWNLOAD_URL, FOLDER_NAME } = process.env;

const ROUTING_RULES = [
    { match: "clat", destination: "-1005035863697", platform: "telegram" },
    { match: "cuet", destination: "-1003536485528", platform: "telegram" },
    { match: "aibe", destination: "-1004024072220", platform: "telegram" },
];
const DEFAULT_ROUTE = { destination: "@debzyotidas", platform: "telegram" };

async function sendAlert(message) {
    const baseUrl = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`;
    try {
        const req = https.request(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        req.write(JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "Markdown" }));
        req.end();
    } catch (err) { console.error("Alert Error:", err.message); }
}

function resolveRoute(folderName) {
    const lower = folderName.toLowerCase();
    for (const rule of ROUTING_RULES) {
        if (lower.includes(rule.match)) return rule;
    }
    return DEFAULT_ROUTE;
}

async function downloadVideo(url, destPath) {
    console.log(`[INFO] Downloading video from Zoom Cloud...`);
    sendAlert(`☁️ **Cloud Download Started**\n\n📥 **Fetching:** \`${FOLDER_NAME}\``);
    const writer = fs.createWriteStream(destPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function runCloudPipeline() {
    const route = resolveRoute(FOLDER_NAME);
    const videoPath = "class_recording.mp4";
    const caption = `📚 Class Recording: ${FOLDER_NAME}`;

    if (route.platform === "youtube") {
        sendAlert(`🟡 **YouTube Route Detected**\n\nSkipping Telegram pipeline for: \`${FOLDER_NAME}\``);
        return;
    }

    try {
        await downloadVideo(DOWNLOAD_URL, videoPath);
        
        const client = new TelegramClient(new StringSession(STRING_SESSION), parseInt(API_ID), API_HASH, { connectionRetries: 5 });
        await client.connect();

        let uploadAttempts = 0;
        let uploadSuccess = false;

        while (uploadAttempts < 3 && !uploadSuccess) {
            uploadAttempts++;
            try {
                if (uploadAttempts === 1) sendAlert(`📤 **Telegram Upload Starting...**\n\n🎯 **Target:** \`${route.destination}\``);
                else sendAlert(`🔄 **Retrying Upload (Attempt ${uploadAttempts}/3)...**`);

                await client.sendFile(route.destination, {
                    file: videoPath,
                    caption: caption,
                    workers: 1, 
                    supportsStreaming: true,
                    attributes: [new Api.DocumentAttributeVideo({ w: 1280, h: 720, duration: 0, supportsStreaming: true })]
                });
                
                sendAlert(`✅ **Cloud Upload Successful!**\n\n📁 **Folder:** \`${FOLDER_NAME}\`\n🎯 **Sent To:** \`${route.destination}\``);
                uploadSuccess = true;
            } catch (err) {
                if (uploadAttempts >= 3) sendAlert(`❌ **Upload Failed After 3 Attempts!**\n\n🚨 **Error:** \`${err.message}\``);
                else await new Promise(r => setTimeout(r, 10000));
            }
        }
    } catch (err) {
        sendAlert(`❌ **Pipeline Fatal Error!**\n\n🚨 \`${err.message}\``);
    }
}

runCloudPipeline();
