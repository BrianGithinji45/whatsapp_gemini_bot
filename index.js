const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <html><head><meta http-equiv="refresh" content="5"></head>
      <body style="font-family:sans-serif;text-align:center;padding-top:50px">
        <h1>Bot Online</h1>
        <p>Already linked and working</p>
      </body></html>
    `);
  }
  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding-top:20px">
      <h1>Scan QR with 【entity-WhatsApp¦canonical_name=WhatsApp】</h1>
      <img src="${latestQR}" style="width:350px;border:10px solid black;border-radius:20px" />
      <p>【entity-WhatsApp¦canonical_name=WhatsApp】 > Linked Devices > Link Device</p>
      <script>setTimeout(()=>location.reload(),10000)</script>
    </body></html>
  `);
});

app.get('/ping', (req,res)=>res.send('Bot is Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server running'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const P = require('pino');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ["Chrome","Windows","10"],
        markOnlineOnConnect: true,
        printQRInTerminal: false
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr){
            latestQR = await qrcode.toDataURL(qr);
            console.log("NEW QR - Open Render URL to scan");
        }
        if(connection === 'close'){
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if(shouldReconnect) startBot();
        } else if(connection === 'open'){
            latestQR = null;
            console.log("Bot Connected");
        }
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
                
                const result = await gemini.generateContent(`You are a helpful 【entity-WhatsApp¦canonical_name=WhatsApp】 assistant. Reply in plain text, no emojis, under 80 words. Keep it simple and direct. User: ${text}`);
                const reply = result.response.text();
                await sock.sendMessage(from, { text: reply }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', from);
                
            }catch(e){
                console.log("Error:", e.message);
                try{
                    const from = messages[0].key.remoteJid;
                    await sock.sendMessage(from, { text: "Sorry, try again." });
                }catch{}
            }
        }
    });
}
startBot();