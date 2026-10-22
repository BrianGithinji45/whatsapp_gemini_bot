const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>Bot Online</h1><p>Working fine</p>`);
  res.send(`
    <h1>Scan QR</h1>
    <img src="${latestQR}" style="width:350px;border:10px solid black;border-radius:20px"/>
    <p>WhatsApp > Linked Devices > Link Device</p>
    <script>setTimeout(()=>location.reload(),10000)</script>
  `);
});

app.get('/ping', (req,res)=>res.send('Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server running'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const P = require('pino');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

async function askGemini(text){
  for(let i=0;i<5;i++){
    try{
      const result = await model.generateContent(`
You are a chill human friend chatting on WhatsApp.
- Reply casual and short like real person
- If user says hello/hi/hey reply "hey im good what about you" or "yo wassup"
- Never say you are AI, assistant, Google, Gemini, bot
- No formal talk
- Max 10-12 words
User: ${text}
`);
      return result.response.text();
    }catch(e){
      console.log(`Attempt ${i+1} failed: ${e.message}`);
      if(e.message.includes('503')){
        await new Promise(r=>setTimeout(r, 4000));
        continue;
      }
      throw e;
    }
  }
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ["Chrome","Windows","10"],
    markOnlineOnConnect: true
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', async (update)=>{
    const { connection, lastDisconnect, qr } = update;
    if(qr){
      latestQR = await qrcode.toDataURL(qr);
      console.log("NEW QR - open render url");
    }
    if(connection==='close'){
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if(shouldReconnect) startBot();
    }else if(connection==='open'){
      latestQR = null;
      console.log("Bot Connected");
    }
  });

  sock.ev.on('messages.upsert', async ({messages})=>{
    for(let msg of messages){
      if(!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      if(from==='status@broadcast') continue;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if(!text) continue;
      
      console.log(`Message: ${text}`);
      await sock.sendPresenceUpdate('composing', from);
      
      try{
        const reply = await askGemini(text);
        await sock.sendMessage(from, { text: reply }, { quoted: msg });
      }catch{
        await sock.sendMessage(from, { text: "brb, one sec" }, { quoted: msg });
      }
      await sock.sendPresenceUpdate('paused', from);
    }
  });
}

startBot();