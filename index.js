const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>Bot Online</h1>`);
  res.send(`<h1>Scan QR</h1><img src="${latestQR}" style="width:350px"/><script>setTimeout(()=>location.reload(),8000)</script>`);
});
app.get('/ping', (req,res)=>res.send('Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server running'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const P = require('pino');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Try multiple models if one is busy
const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

async function askGemini(text) {
    for(let modelName of MODELS){
        try{
            console.log(`Trying model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(`Reply plain text no emojis under 80 words. User: ${text}`);
            return result.response.text();
        }catch(e){
            console.log(`Failed ${modelName}: ${e.message}`);
            if(e.message.includes('503') || e.message.includes('high demand')){
                continue; // try next model
            }
            if(MODELS.indexOf(modelName) === MODELS.length -1) throw e;
        }
    }
    throw new Error("All models busy");
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Chrome","Windows","10"], markOnlineOnConnect: true });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr){ latestQR = await qrcode.toDataURL(qr); console.log("NEW QR"); }
        if(connection === 'close'){ const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut; if(shouldReconnect) startBot(); }
        else if(connection === 'open'){ latestQR = null; console.log("Bot Connected"); }
    });
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for(let msg of messages){
            try{
                if(!msg.message || msg.key.fromMe) continue;
                const from = msg.key.remoteJid;
                if(from === 'status@broadcast') continue;
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
                if(!text) continue;
                console.log(`Message: ${text}`);
                await sock.sendPresenceUpdate('composing', from);
                const reply = await askGemini(text);
                await sock.sendMessage(from, { text: reply }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', from);
            }catch(e){ console.log("Error:", e.message); }
        }
    });
}
startBot();