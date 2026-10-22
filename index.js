const express = require('express');
const app = express();
app.get('/', (req,res)=>res.send('Brian Online ✅'));
app.listen(process.env.PORT || 3000);

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const P = require('pino');
const qrcode = require('qrcode');

let latestQR = null;
app.get('/qr', async (req,res)=>{
  if(!latestQR) return res.send('No QR');
  res.send(`<img src="${latestQR}" width="350"/>`);
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Brian","Chrome","1.0"] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u)=>{
    if(u.qr){ latestQR = await qrcode.toDataURL(u.qr); console.log("SCAN QR: /qr"); }
    if(u.connection==='close' && u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
    if(u.connection==='open') console.log("✅ CONNECTED");
  });
  sock.ev.on('messages.upsert', async ({messages})=>{
    for(let m of messages){
      if(!m.message || m.key.fromMe) continue;
      const from = m.key.remoteJid;
      const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
      if(!text || from==='status@broadcast') continue;
      console.log("IN:", text);
      try{
        const c = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          messages: [
            {role:"system",content:"You are Brian, 22 Nairobi human. Not AI. Short reply 5-15 words like 'hey im good wbu' or 'poa sana'. Use sheng."},
            {role:"user",content:text}
          ],
          max_tokens: 60
        });
        const reply = c.choices[0].message.content;
        console.log("OUT:", reply);
        await sock.sendMessage(from, { text: reply }, { quoted: m });
      }catch(e){
        console.log("ERR:", e.message);
        await sock.sendMessage(from, { text: "hey im good wbu 😅" });
      }
    }
  });
}
startBot();