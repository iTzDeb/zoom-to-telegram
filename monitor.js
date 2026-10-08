const axios = require('axios');

const { MEETING_ID, TOPIC, START_TIME, ALERT_BOT_TOKEN } = process.env;

const ALERT_CHAT_IDS = ['-5528169479'];

const MAX_WARNINGS = 5;

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramWithButton(chatId, text, meetingId) {
    const url = `https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: "🔕 Mute Warnings for this Class", callback_data: `mute_${meetingId}` }
                ]]
            }
        });
    } catch (e) {
        console.error(`[ERROR] Telegram Alert Failed: ${e.message}`);
    }
}

async function runMonitor() {
    console.log(`[INFO] Starting monitor for ${TOPIC} (ID:${MEETING_ID})`);
    
    // 1. Early Join Guardrail
    if (START_TIME) {
        const scheduledTime = new Date(START_TIME).getTime();
        const now = new Date().getTime();
        const minutesUntilScheduled = (scheduledTime - now) / (1000 * 60);

        if (minutesUntilScheduled > 5) {
            console.log(`[INFO] Early join detected (${Math.round(minutesUntilScheduled)} mins early). Cancelling timer.`);
            process.exit(0);
        }
    }

    // 2. Initial 3-Minute Countdown
    console.log(`[INFO] Arming initial 3-minute stopwatch...`);
    await sleep(3 * 60 * 1000); 

    let warningCount = 0;
    const actualStartTime = new Date().getTime() - (3 * 60 * 1000); // Approximate live start

    // 3. Escalation Loop
    while (warningCount < MAX_WARNINGS) {
        warningCount++;
        const liveMinutes = Math.floor((new Date().getTime() - actualStartTime) / 60000);
        
        let alertMessage = warningCount === 1 
            ? `🚨 *ZOOM RECORDING WARNING!*\n\n📌 **Topic:** \`${TOPIC}\`\n\nClass has been live for **${liveMinutes} minutes** but *Cloud Recording* has NOT been started! Please start recording immediately.`
            : `🔥 *URGENT RECORDING ESCALATION (${warningCount}/${MAX_WARNINGS})*\n\n📌 **Topic:** \`${TOPIC}\`\n\nClass has been live for **${liveMinutes} minutes** and is STILL NOT RECORDING!`;

        console.log(`[INFO] Firing Warning ${warningCount}/${MAX_WARNINGS}`);
        
        for (const chatId of ALERT_CHAT_IDS) {
            await sendTelegramWithButton(chatId, alertMessage, MEETING_ID);
        }

        // Wait 2 minutes before the next escalation nudge
        console.log(`[INFO] Sleeping 2 minutes before next check...`);
        await sleep(2 * 60 * 1000);
    }

    console.log(`[INFO] Max warnings reached. Exiting cleanly.`);
    process.exit(0);
}

runMonitor();
