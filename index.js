const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>Brian Online ✅ Flashes</h1>`);
  res.send(`<h1>Scan QR - Brian</h1><img src="${latestQR}" style="width:350px;border-radius:20px"/><script>setTimeout(()=>location.reload(),10000)</script>`);
});
app.get('/ping', (req,res)=>res.send('Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server running'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk');
const P = require('pino');

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are Brian, 22 Nairobi human WhatsApp. Never say AI. If asked say "lol no mimi ni mtu tu". Reply 5-25 words casual sheng like poa, sasa, hey im good wbu. Be helpful smart. Max 1 emoji.`;

async function askAI(text){
  const prompt = `${SYSTEM}\nUser says: ${text}\nReply as Brian human short:`;

  const FLASHES = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-flash-002"
  ];

  for(let model of FLASHES){
    try{
      const res = await genAI.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });
      const reply = res.text || res.candidates?.[0]?.content?.parts?.[0]?.text;
      if(reply && reply.trim().length > 2){
        console.log(`✅ ${model}`);
        return reply.trim();
      }
    }catch(e){
      console.log(`❌ ${model}: ${e.message.slice(0,70)}`);
    }
  }

  try{
    const c = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{role:"system",content:SYSTEM},{role:"user",content:text}],
      max_tokens: 80
    });
    console.log("✅ GROQ fallback");
    return c.choices[0].message.content.trim();
  }catch(e){ console.log("❌ Groq fail"); }

  return "hey im good, wbu?";
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Brian","Chrome","1.0"], markOnlineOnConnect: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u)=>{
    const { connection, lastDisconnect, qr } = u;
    if(qr){ latestQR = await qrcode.toDataURL(qr); console.log("QR ready - scan"); }
    if(connection==='close'){ if(lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot(); }
    else if(connection==='open'){ latestQR = null; console.log("✅ BRIAN FLASHES CONNECTED"); }
  });
  sock.ev.on('messages.upsert', async ({messages})=>{
    for(let msg of messages){
      if(!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      if(from==='status@broadcast') continue;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if(!text) continue;
      console.log(`\nIN: ${text}`);
      await sock.sendPresenceUpdate('composing', from);
      await new Promise(r=>setTimeout(r, 600));
      const reply = await askAI(text);
      console.log(`OUT: ${reply}`);
      await sock.sendMessage(from, { text: reply }, { quoted: msg });
      await sock.sendPresenceUpdate('paused', from);
    }
  });
}
startBot();