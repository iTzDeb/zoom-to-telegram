const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// --- Environment Variables ---
const { 
    API_ID, 
    API_HASH, 
    STRING_SESSION, 
    ALERT_BOT_TOKEN, 
    ADMIN_CHAT_ID, // NOC Group ID for Technical/Pipeline Logs
    DOWNLOAD_URL, 
    FOLDER_NAME,
    SUPER_ADMIN_ID // Personal Telegram User ID for Management Commands
} = process.env;

const EXCLUDED_MEETINGS = ["shivam singh's zoom meeting", "personal meeting room"];
const DEFAULT_ROUTE = ["@debzyotidas"];
const ROUTES_FILE = path.join(__dirname, "routes.json");

// =========================================================================
// 1. ROUTE DATA MANAGER (MODULAR STORAGE)
// =========================================================================
function loadRoutes() {
    try {
        if (fs.existsSync(ROUTES_FILE)) {
            const raw = fs.readFileSync(ROUTES_FILE, "utf8");
            return JSON.parse(raw);
        }
    } catch (err) {
        console.error("[ERROR] Failed to load routes.json:", err.message);
    }
    return {
        "clat": ["-1005035863697"],
        "cuet": ["-1003536485528"],
        "aibe": ["-1004024072220"]
    };
}

function saveRoutes(routes) {
    try {
        fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2), "utf8");
        return true;
    } catch (err) {
        console.error("[ERROR] Failed to write routes.json:", err.message);
        return false;
    }
}

function resolveDestinations(folderName) {
    const lower = folderName.toLowerCase();
    const routes = loadRoutes();
    const destinations = new Set();

    for (const [key, targets] of Object.entries(routes)) {
        if (lower.includes(key.toLowerCase())) {
            const targetArray = Array.isArray(targets) ? targets : [targets];
            targetArray.forEach(id => destinations.add(id));
        }
    }

    return destinations.size > 0 ? Array.from(destinations) : DEFAULT_ROUTE;
}

// =========================================================================
// 2. TECHNICAL TELEGRAM ALERT ENGINE (Sent exclusively to ADMIN_CHAT_ID)
// =========================================================================
async function sendAlert(message) {
    const url = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`;
    try {
        const res = await axios.post(url, { chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "Markdown" });
        return res.data?.result?.message_id || null;
    } catch (err) { 
        console.error("Alert Error:", err.message); 
        return null;
    }
}

async function updateAlert(messageId, message) {
    if (!messageId) return await sendAlert(message);
    const url = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/editMessageText`;
    try {
        await axios.post(url, { 
            chat_id: ADMIN_CHAT_ID, 
            message_id: messageId, 
            text: message, 
            parse_mode: "Markdown" 
        });
        return messageId;
    } catch (err) {
        return await sendAlert(message);
    }
}

// Admin Telegram Command Handler
async function handleAdminCommands() {
    const url = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/getUpdates`;
    try {
        const res = await axios.get(url);
        const updates = res.data?.result || [];

        for (const update of updates) {
            const msg = update.message;
            if (!msg || !msg.text) continue;

            const senderId = String(msg.from?.id);
            if (SUPER_ADMIN_ID && senderId !== String(SUPER_ADMIN_ID)) continue;

            const text = msg.text.trim();
            const parts = text.split(/\s+/);
            const command = parts[0].toLowerCase();

            let routes = loadRoutes();

            if (command === "/listroutes") {
                let responseText = "📋 **Configured Target Destinations:**\n\n";
                for (const [key, targets] of Object.entries(routes)) {
                    const list = Array.isArray(targets) ? targets.join(", ") : targets;
                    responseText += `🔹 **${key.toUpperCase()}**: \`${list}\`\n`;
                }
                await sendAlert(responseText);
            }
            else if (command === "/addroute" && parts.length >= 3) {
                const key = parts[1].toLowerCase();
                const chatId = parts[2];

                if (!routes[key]) routes[key] = [];
                if (!Array.isArray(routes[key])) routes[key] = [routes[key]];

                if (!routes[key].includes(chatId)) {
                    routes[key].push(chatId);
                    saveRoutes(routes);
                    await sendAlert(`✅ **Route Added Successfully!**\n\n🔑 **Tag:** \`${key}\`\n🎯 **Chat ID:** \`${chatId}\``);
                } else {
                    await sendAlert(`⚠️ **Route Exists:** Chat ID \`${chatId}\` is already registered under tag \`${key}\`.`);
                }
            }
            else if (command === "/delroute" && parts.length >= 3) {
                const key = parts[1].toLowerCase();
                const chatId = parts[2];

                if (routes[key]) {
                    routes[key] = routes[key].filter(id => id !== chatId);
                    if (routes[key].length === 0) delete routes[key];
                    saveRoutes(routes);
                    await sendAlert(`🗑️ **Route Removed!**\n\n🔑 **Tag:** \`${key}\`\n🎯 **Removed ID:** \`${chatId}\``);
                } else {
                    await sendAlert(`❌ **Route Not Found:** Tag \`${key}\` does not exist.`);
                }
            }
        }
    } catch (err) {
        console.error("[ADMIN ENGINE ERROR]", err.message);
    }
}

// =========================================================================
// 3. MEDIA FORMATTING & DOWNLOAD ENGINE
// =========================================================================
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

async function downloadVideo(url, destPath) {
    console.log(`[INFO] Downloading video from Zoom Cloud...`);
    await sendAlert(`📥 **Downloading Zoom Cloud File...**\n\n📌 **Topic:** \`${FOLDER_NAME}\``);
    
    const writer = fs.createWriteStream(destPath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
            const stats = fs.statSync(destPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            await sendAlert(`✅ **Download Complete** (${sizeMB} MB)`);
            resolve();
        });
        writer.on('error', async (err) => {
            await sendAlert(`🚨 **Cloud Download Failed!**\n\nError: \`${err.message}\``);
            reject(err);
        });
    });
}

// =========================================================================
// 4. MAIN CLOUD PIPELINE EXECUTION
// =========================================================================
async function runCloudPipeline() {
    await handleAdminCommands();

    await sendAlert(`🚀 **Cloud Pipeline Initiated**\n\n📁 **Topic:** \`${FOLDER_NAME}\``);
    const lowerFolder = FOLDER_NAME.toLowerCase();
    
    if (EXCLUDED_MEETINGS.some(excluded => lowerFolder.includes(excluded))) {
        await sendAlert(`⏭️ **Skipped Meeting (Exclusion Match):**\n\`${FOLDER_NAME}\``);
        process.exit(0);
    }

    const destinations = resolveDestinations(FOLDER_NAME);
    await sendAlert(`🗺️ **Destinations Resolved (${destinations.length}):**\n🎯 \`${destinations.join(", ")}\``);

    const videoPath = "class_recording.mp4";
    const fixedVideoPath = "fixed_class_recording.mp4";
    const caption = formatCaption(FOLDER_NAME);

    let client;
    try {
        await downloadVideo(DOWNLOAD_URL, videoPath);
        
        try {
            await sendAlert(`⚙️ **Starting FFmpeg Optimization...**\nFixing moov atom for streaming.`);
            execSync(`ffmpeg -i ${videoPath} -c copy -movflags +faststart${fixedVideoPath}`);
            await sendAlert(`✅ **FFmpeg Optimization Complete**`);
        } catch (err) {
            await sendAlert(`⚠️ **FFmpeg Optimization Failed**\nFalling back to raw unoptimized video.`);
            fs.renameSync(videoPath, fixedVideoPath); 
        }
        
        await sendAlert(`🔌 **Connecting to Telegram MTProto...**`);
        client = new TelegramClient(new StringSession(STRING_SESSION), parseInt(API_ID), API_HASH, { 
            connectionRetries: 5,
            requestRetries: 5,
            useWSS: true
        });
        
        await client.connect();
        await client.getDialogs({}); 

        for (const targetGroup of destinations) {
            let uploadAttempts = 0;
            let uploadSuccess = false;

            while (uploadAttempts < 3 && !uploadSuccess) {
                uploadAttempts++;
                try {
                    let statusMessageId = await sendAlert(
                        `📤 **Uploading to Group:** \`${targetGroup}\`\n📝 **Caption:** ${caption}`
                    );

                    // ATOMIC MEMORY LOCK: Prevents 10 parallel worker threads from duplicate logging
                    const progressMilestones = { 25: false, 50: false, 75: false };

                    await client.sendFile(targetGroup, {
                        file: fixedVideoPath,
                        caption: caption,
                        workers: 10, 
                        supportsStreaming: true,
                        attributes: [new Api.DocumentAttributeVideo({ w: 1280, h: 720, duration: 0, supportsStreaming: true })],
                        progressCallback: (progress) => {
                            const percent = Math.floor(progress * 100);

                            for (const threshold of [25, 50, 75]) {
                                // SYNCHRONOUS CHECK & LOCK: Locks memory synchronously in microseconds
                                if (percent >= threshold && !progressMilestones[threshold]) {
                                    progressMilestones[threshold] = true; // LOCK IMMEDIATELY
                                    
                                    console.log(`[INFO] Cloud Upload Progress: ${threshold}%`);
                                    
                                    // Async edit without await so workers stay max speed
                                    updateAlert(
                                        statusMessageId, 
                                        `⏳ **Group (\`${targetGroup}\`) Upload:** ${threshold}%\n\n📌 **Topic:** \`${FOLDER_NAME}\``
                                    ).catch(err => console.error("Progress edit error:", err.message));
                                }
                            }
                        }
                    });
                    
                    await sendAlert(`✅ **Successfully Delivered to:** \`${targetGroup}\``);
                    uploadSuccess = true;

                } catch (err) {
                    console.error(`[ERROR] Group ${targetGroup} upload attempt ${uploadAttempts} failed:${err.message}`);
                    if (uploadAttempts >= 3) {
                        await sendAlert(`❌ **Failed Delivery to Group:** \`${targetGroup}\`\nError: \`${err.message}\``);
                    } else {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }
        }

        await client.disconnect();
        process.exit(0);

    } catch (err) {
        await sendAlert(`❌ **Pipeline Fatal Error!**\n\n🚨 **Error:** \`${err.message}\``);
        if (client) await client.disconnect();
        process.exit(1);
    }
}

runCloudPipeline();
