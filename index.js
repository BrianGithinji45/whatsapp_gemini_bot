const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is Online!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

require('dotenv').config()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const P = require('pino')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

let messageStore = new Map()

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    
    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        browser: ["Chrome", "Windows", "10"],
        markOnlineOnConnect: true
    })

    sock.ev.on('creds.update', saveCreds)

    if (!sock.authState.creds.registered) {
        const myNumber = "254707734799" // CHANGE THIS TO YOUR NUMBER
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(myNumber)
                console.log("\n==============================")
                console.log("YOUR PAIRING CODE IS: " + code)
                console.log("==============================\n")
            } catch(e) { console.log(e.message) }
        }, 5000)
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        } else if (connection === 'open') {
            console.log("✅ Bot Connected!")
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (let msg of messages) {
            if (!msg.message) continue
            const from = msg.key.remoteJid
            messageStore.set(msg.key.id, msg)
            if (msg.key.fromMe) continue
            if (from === 'status@broadcast') continue
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
            if (!text) continue

            await sock.sendPresenceUpdate('available', from)
            await sock.sendPresenceUpdate('composing', from)
            await new Promise(r => setTimeout(r, 1500))

            const isGroup = from.endsWith('@g.us')
            if (!isGroup || text.startsWith('.')) {
                try {
                    const cleanText = text.startsWith('.') ? text.slice(1) : text
                    const result = await gemini.generateContent(`You are helpful WhatsApp bot. Short friendly under 50 words. User: ${cleanText}`)
                    const reply = result.response.text()
                    await sock.sendMessage(from, { text: reply }, { quoted: msg })
                } catch (e) { console.log(e.message) }
            }
            await sock.sendPresenceUpdate('paused', from)
        }
    })
}
startBot()