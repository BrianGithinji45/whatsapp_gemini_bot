const express = require('express');
const app = express();
const qrcode = require('qrcode');
const fs = require('fs');

let latestQR = null;

// Web page to show QR
app.get('/', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <html><head><meta http-equiv="refresh" content="3"></head>
      <body style="font-family:sans-serif; text-align:center; padding-top:50px">
        <h1>🤖 【entity-WhatsApp¦canonical_name=WhatsApp】 Gemini Bot</h1>
        <h2 style="color:orange">Waiting for QR... Refreshing</h2>
        <p>If bot is already connected, you will see "Bot is Online!"</p>
      </body></html>
    `);
  }
  res.send(`
    <html><body style="font-family:sans-serif; text-align:center; padding-top:20px">
      <h1>Scan this QR with 【entity-WhatsApp¦canonical_name=WhatsApp】</h1>
      <img src="${latestQR}" style="width:350px; border:10px solid black; border-radius:20px" />
      <p><b>On your PHONE:</b> 【entity-WhatsApp¦canonical_name=WhatsApp】 > Linked Devices > Link a Device</p>
      <p>QR refreshes every 30 seconds - scan quickly!</p>
      <script>setTimeout(()=>location.reload(), 8000)</script>
    </body></html>
  `);
});

app.get('/ping', (req, res) => res.send('Bot is Online!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// ================= BOT LOGIC =================
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const P = require('pino');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    
    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ["Chrome", "Windows", "10"],
        markOnlineOnConnect: true,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            latestQR = await qrcode.toDataURL(qr);
            console.log("✅ NEW QR GENERATED - Open your Render URL to scan!");
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed, reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            latestQR = null;
            console.log("✅✅✅ Bot Connected Successfully! ✅✅✅");
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (let msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;
                const from = msg.key.remoteJid;
                if (from === 'status@broadcast') continue;
                
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
                if (!text) continue;

                console.log(`Message from ${from}: ${text}`);

                // Show online + typing
                await sock.sendPresenceUpdate('available', from);
                await sock.sendPresenceUpdate('composing', from);
                await new Promise(r => setTimeout(r, 1500));

                // Reply with Gemini (in groups only if starts with .)
                const isGroup = from.endsWith('@g.us');
                if (!isGroup || text.startsWith('.')) {
                    const cleanText = text.startsWith('.') ? text.slice(1) : text;
                    const result = await gemini.generateContent(`You are a helpful, short, friendly WhatsApp bot. Reply under 50 words. User says: ${cleanText}`);
                    const reply = result.response.text();
                    await sock.sendMessage(from, { text: reply }, { quoted: msg });
                }
                
                await sock.sendPresenceUpdate('paused', from);
            } catch (e) {
                console.log("Error:", e.message);
            }
        }
    });
}

startBot();