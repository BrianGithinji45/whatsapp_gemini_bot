const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>Brian Online ✅ Triple AI</h1>`);
  res.send(`<h1>Scan QR - Brian</h1><img src="${latestQR}" style="width:350px;border-radius:20px"/><script>setTimeout(()=>location.reload(),10000)</script>`);
});
app.get('/ping', (req,res)=>res.send('Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server up'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk');
const P = require('pino');

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are Brian, 22 Nairobi human on WhatsApp. Never say you are AI. If asked are you AI say "lol no mimi ni mtu tu". Reply 5-25 words, casual, sheng: poa, sasa, fiti, msee. Rotate greetings: hey im good wbu, poa sana, sasa msee. Be smart like Gemini but human. Max 1 emoji.`;

async function askAI(text){
  // 1. GEMINI
  try{
    const res = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: text,
      config: { systemInstruction: SYSTEM }
    });
    console.log("✅ GEMINI USED");
    return res.text;
  }catch(e){ console.log("❌ Gemini fail: "+e.message.slice(0,100)); }

  // 2. GROQ
  try{
    const c = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{role:"system",content:SYSTEM},{role:"user",content:text}],
      max_tokens: 80,
      temperature: 0.8
    });
    console.log("✅ GROQ USED");
    return c.choices[0].message.content;
  }catch(e){ console.log("❌ Groq fail: "+e.message.slice(0,100)); }

  // 3. OPENROUTER
  try{
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b:free",
        messages: [{role:"system",content:SYSTEM},{role:"user",content:text}],
        max_tokens: 80
      })
    });
    const data = await r.json();
    if(data.choices){ console.log("✅ OPENROUTER USED"); return data.choices[0].message.content; }
  }catch(e){ console.log("❌ OpenRouter fail"); }

  return "poa msee, uko aje?";
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Brian","Chrome","1.0"], markOnlineOnConnect: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u)=>{
    const { connection, lastDisconnect, qr } = u;
    if(qr){ latestQR = await qrcode.toDataURL(qr); console.log("Scan QR"); }
    if(connection==='close'){ if(lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot(); }
    else if(connection==='open'){ latestQR = null; console.log("✅ BRIAN TRIPLE CONNECTED"); }
  });
  sock.ev.on('messages.upsert', async ({messages})=>{
    for(let msg of messages){
      if(!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      if(from==='status@broadcast') continue;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if(!text) continue;
      console.log("IN: "+text);
      await sock.sendPresenceUpdate('composing', from);
      await new Promise(r=>setTimeout(r, 800));
      const reply = await askAI(text);
      console.log("OUT: "+reply);
      await sock.sendMessage(from, { text: reply }, { quoted: msg });
      await sock.sendPresenceUpdate('paused', from);
    }
  });
}
startBot();