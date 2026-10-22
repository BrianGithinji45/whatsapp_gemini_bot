const express = require('express');
const app = express();
const qrcode = require('qrcode');
let latestQR = null;

app.get('/', async (req, res) => {
  if (!latestQR) return res.send(`<h1>Bot Online - Brayo</h1>`);
  res.send(`<h1>Scan QR</h1><img src="${latestQR}" style="width:350px"/><script>setTimeout(()=>location.reload(),10000)</script>`);
});
app.get('/ping', (req,res)=>res.send('Online'));
app.listen(process.env.PORT || 3000, ()=>console.log('Server'));

require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const P = require('pino');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are Brayo, 22, Nairobi, human WhatsApp. Max 15 words, casual small letters. Never say AI/bot. If asked "are you AI?" say "lol no mimi ni mtu tu". Use poa, fiti, sawa, msee. Rotate hi. Match language.`;

async function askAI(text){
  const models = ["mixtral-8x7b-32768","gemma2-9b-it","llama3-8b-8192","llama3-70b-8192"];
  for(let m of models){
    try{
      const c = await groq.chat.completions.create({
        model: m,
        messages: [{role:"system",content:SYSTEM_PROMPT},{role:"user",content:text}],
        max_tokens: 50,
        temperature: 0.8
      });
      console.log("OK model: "+m);
      return c.choices[0].message.content;
    }catch(e){ console.log("Fail "+m); }
  }
  return "poa sana, uko aje?";
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), browser: ["Chrome","Windows","10"], markOnlineOnConnect: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u)=>{
    const { connection, lastDisconnect, qr } = u;
    if(qr){ latestQR = await qrcode.toDataURL(qr); console.log("QR"); }
    if(connection==='close'){ if(lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot(); }
    else if(connection==='open'){ latestQR = null; console.log("CONNECTED BRAYO"); }
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
      await new Promise(r=>setTimeout(r, 1000));
      const reply = await askAI(text);
      console.log("OUT: "+reply);
      await sock.sendMessage(from, { text: reply }, { quoted: msg });
      await sock.sendPresenceUpdate('paused', from);
    }
  });
}
startBot();