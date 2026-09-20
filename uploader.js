const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const axios = require("axios");
const fs = require("fs");
const https = require("https"); 
const { execSync } = require("child_process");

const { API_ID, API_HASH, STRING_SESSION, ALERT_BOT_TOKEN, ADMIN_CHAT_ID, DOWNLOAD_URL, FOLDER_NAME } = process.env;

const ROUTING_RULES = [
    { match: "clat", destination: "-1005035863697", platform: "telegram" },
    { match: "cuet", destination: "-1003536485528", platform: "telegram" },
    { match: "aibe", destination: "-1004024072220", platform: "telegram" },
];
const DEFAULT_ROUTE = { destination: "@debzyotidas", platform: "telegram" };
const EXCLUDED_MEETINGS = ["shivam singh's zoom meeting", "personal meeting room"];

// --- Telegram Alert Helper ---
async function sendAlert(message) {
    const baseUrl = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`;
    try {
        const req = https.request(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        req.write(JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "Markdown" }));
        req.end();
    } catch (err) { 
        console.error("Alert Error:", err.message); 
    }
}

// --- Dynamic Route Resolver ---
function resolveRoute(folderName) {
    const lower = folderName.toLowerCase();
    for (const rule of ROUTING_RULES) {
        if (lower.includes(rule.match)) return rule;
    }
    return DEFAULT_ROUTE;
}

// --- Clean Caption Formatter ---
function formatCaption(folderName) {
    const match = folderName.match(/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}\.\d{2}\.\d{2}\s+(.*)$/);
    let dateStr = "";
    let rawTitle = folderName;

    if (match) {
        const [, year, month, day, title] = match;
        const dateObj = new Date(`${year}-${month}-${day}`);
        dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        rawTitle = title;
    }

    let cleanedTitle = rawTitle
        .replace(/tcr/gi, '')
        .replace(/laxmi\s+nagar/gi, '')
        .replace(/\s+-\s+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return dateStr ? `📚 Class Recording: ${dateStr}${cleanedTitle}` : `📚 Class Recording: ${cleanedTitle}`;
}

// --- Downloader Engine ---
async function downloadVideo(url, destPath) {
    console.log(`[INFO] Downloading video from Zoom Cloud...`);
    sendAlert(`📥 **Downloading Zoom Cloud File...**\n\n📌 **Topic:** \`${FOLDER_NAME}\``);
    
    const writer = fs.createWriteStream(destPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            const stats = fs.statSync(destPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            sendAlert(`✅ **Download Complete** (${sizeMB} MB)\n\nOptimizing metadata for Telegram playback...`);
            resolve();
        });
        writer.on('error', (err) => {
            sendAlert(`🚨 **Cloud Download Failed!**\n\nError: \`${err.message}\``);
            reject(err);
        });
    });
}

// --- Main Cloud Execution Pipeline ---
async function runCloudPipeline() {
    const lowerFolder = FOLDER_NAME.toLowerCase();
    
    // 1. Check for Exclusions
    if (EXCLUDED_MEETINGS.some(excluded => lowerFolder.includes(excluded))) {
        sendAlert(`⏭️ **Skipped Meeting (Exclusion Match):**\n\`${FOLDER_NAME}\``);
        console.log(`[INFO] Skipped excluded meeting: ${FOLDER_NAME}`);
        process.exit(0);
    }

    const route = resolveRoute(FOLDER_NAME);
    const videoPath = "class_recording.mp4";
    const fixedVideoPath = "fixed_class_recording.mp4";
    const caption = formatCaption(FOLDER_NAME);

    let client;
    try {
        // 2. Download Original File
        await downloadVideo(DOWNLOAD_URL, videoPath);
        
        // 3. Apply FFmpeg faststart fix
        try {
            console.log("[INFO] Running FFmpeg to fix moov atom...");
            // FIX 1: Explicit space added before ${fixedVideoPath}
            execSync(`ffmpeg -i ${videoPath} -c copy -movflags +faststart${fixedVideoPath}`);
            console.log("[INFO] FFmpeg optimization complete.");
        } catch (err) {
            console.error("[ERROR] FFmpeg failed:", err.message);
            fs.renameSync(videoPath, fixedVideoPath); // Fallback to raw file if FFmpeg fails
        }
        
        // 4. Initialize Telegram
        client = new TelegramClient(new StringSession(STRING_SESSION), parseInt(API_ID), API_HASH, { 
            connectionRetries: 5,
            requestRetries: 5,
            useWSS: true
        });
        
        await client.connect();
        
        // FIX 2: Populating the GramJS entity cache
        console.log("[INFO] Syncing Telegram chats to build entity cache...");
        await client.getDialogs({}); 

        let uploadAttempts = 0;
        let uploadSuccess = false;

        // 5. Upload with Retries
        while (uploadAttempts < 3 && !uploadSuccess) {
            uploadAttempts++;
            try {
                if (uploadAttempts === 1) {
                    sendAlert(`📤 **Telegram Upload Starting...**\n\n🎯 **Target:** \`${route.destination}\`\n📝 **Caption:** ${caption}`);
                } else {
                    sendAlert(`🔄 **Retrying Upload (Attempt ${uploadAttempts}/3)...**\n\n📌 **Topic:** \`${FOLDER_NAME}\``);
                }

                let lastLogged = 0;

                await client.sendFile(route.destination, {
                    file: fixedVideoPath, // Uploading the FFmpeg-fixed file
                    caption: caption,
                    workers: 1, 
                    supportsStreaming: true,
                    attributes: [new Api.DocumentAttributeVideo({ w: 1280, h: 720, duration: 0, supportsStreaming: true })],
                    progressCallback: (progress) => {
                        const percent = Math.floor(progress * 100);
                        if (percent >= lastLogged + 25) {
                            console.log(`[INFO] Cloud Upload Progress: ${percent}%`);
                            lastLogged = percent;
                        }
                    }
                });
                
                sendAlert(`✅ **Cloud Upload Successful!**\n\n📁 **Folder:** \`${FOLDER_NAME}\`\n🎯 **Sent To:** \`${route.destination}\``);
                uploadSuccess = true;
                
                // 6. Clean Exit
                await client.disconnect();
                process.exit(0);

            } catch (err) {
                console.error(`[ERROR] Upload attempt ${uploadAttempts} failed:${err.message}`);
                if (uploadAttempts >= 3) {
                    sendAlert(`❌ **Upload Failed After 3 Attempts!**\n\n📁 **Topic:** \`${FOLDER_NAME}\`\n🚨 **Error:** \`${err.message}\``);
                    if (client) await client.disconnect();
                    process.exit(1);
                } else {
                    sendAlert(`⚠️ **Upload Attempt ${uploadAttempts} Interrupted**\n\nWaiting 10 seconds before retrying...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        }
    } catch (err) {
        sendAlert(`❌ **Pipeline Fatal Error!**\n\n🚨 **Error:** \`${err.message}\``);
        if (client) await client.disconnect();
        process.exit(1);
    }
}

runCloudPipeline();
