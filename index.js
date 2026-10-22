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
        markOnlineOnConnect: true,
        syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    // SHOW PAIRING CODE FOR RENDER
    if (!sock.authState.creds.registered) {
        // IMPORTANT: Put your number here without + and without spaces
        // Example Kenya: 254712345678
        const myNumber = "254707734799" 
        console.log("Waiting 5 sec to generate pairing code...")
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(myNumber)
                console.log("\n\n==============================")
                console.log("YOUR PAIRING CODE IS: " + code)
                console.log("Go to WhatsApp > Linked Devices > Link with phone number")
                console.log("==============================\n\n")
            } catch(e) {
                console.log("Error getting code, retry:", e.message)
            }
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
            
            // Save for anti-delete
            messageStore.set(msg.key.id, msg)

            // --- VIEW ONCE DETECTOR ---
            let isViewOnce = msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage
            let actualMessage = isViewOnce ? (msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message) : msg.message
            
            if (isViewOnce) {
                console.log("View Once message detected from:", from)
                // The image is now saved in actualMessage, it won't disappear
            }

            if (msg.key.fromMe) continue
            if (from === 'status@broadcast') continue

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || actualMessage?.imageMessage?.caption || actualMessage?.videoMessage?.caption || ""
            if (!text) continue

            // --- FAKE TYPING + ALWAYS ONLINE ---
            await sock.sendPresenceUpdate('available', from)
            await sock.sendPresenceUpdate('composing', from)
            await new Promise(r => setTimeout(r, 1500))

            // --- GEMINI AUTO REPLY ---
            // Reply in private chats, or in groups when someone writes . before message e.g .hello
            const isGroup = from.endsWith('@g.us')
            if (!isGroup || text.startsWith('.')) {
                try {
                    const cleanText = text.startsWith('.') ? text.slice(1) : text
                    const result = await gemini.generateContent(`You are a helpful WhatsApp bot. Keep replies short, friendly, under 50 words. User: ${cleanText}`)
                    const reply = result.response.text()
                    await sock.sendMessage(from, { text: reply }, { quoted: msg })
                } catch (e) {
                    console.log("Gemini error:", e.message)
                }
            }
            await sock.sendPresenceUpdate('paused', from)
        }
    })

    // --- ANTI DELETE ---
    sock.ev.on('messages.delete', async (item) => {
        for (let key of item.keys) {
            const old = messageStore.get(key.id)
            if (old) {
                await sock.sendMessage(key.remoteJid, { 
                    text: `*Anti-Delete*\nThey deleted: ${old.message?.conversation || old.message?.extendedTextMessage?.text || "a media message"}` 
                })
            }
        }
    })
}

startBot()