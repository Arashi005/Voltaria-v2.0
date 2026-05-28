require('dotenv').config();

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const mongoose = require('mongoose');
const NodeCache = require('node-cache');

const messageHandler = require('./message');
const commandHandler = require('./handler/commandHandler');
const config = require('./config');

const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(compression());

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 100
}));

const store = makeInMemoryStore({
    logger: pino().child({
        level: 'silent',
        stream: 'store'
    })
});

const msgRetryCounterCache = new NodeCache();

const prefix = config.prefix || '.';
const botName = config.botName || 'Voltaria Nexus';

let latestQR = null;
let isConnected = false;
let reconnecting = false;

global.reportCooldowns = {};
global.bannedReporters = [];

setInterval(() => {
    global.reportCooldowns = {};
}, 1000 * 60 * 60);

async function connectDatabase() {
    try {
        if (!config.mongodbUrl) {
            console.log('⚠️ No MongoDB URL Provided');
            return;
        }

        await mongoose.connect(config.mongodbUrl);

        console.log('✅ MongoDB Connected');

    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
    }
}

async function startBot() {

    const sessionPath = path.join(__dirname, 'session');

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        msgRetryCounterCache,
        browser: ['Voltaria Nexus', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    store.bind(sock.ev);

    sock.ev.on('connection.update', async (update) => {

        const {
            connection,
            lastDisconnect,
            qr
        } = update;

        if (qr) {
            latestQR = qr;
        }

        if (connection === 'open') {
            isConnected = true;
            reconnecting = false;

            console.log('✅ Bot Connected Successfully');
        }

        if (connection === 'close') {

            isConnected = false;

            const statusCode = lastDisconnect?.error?.output?.statusCode;

            console.log('❌ Connection Closed:', statusCode);

            if (statusCode !== DisconnectReason.loggedOut) {

                if (reconnecting) return;

                reconnecting = true;

                console.log('🔄 Reconnecting in 5 seconds...');

                setTimeout(async () => {
                    reconnecting = false;
                    await startBot();
                }, 5000);

            } else {
                console.log('❌ Logged Out. Delete session folder and scan again.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {

        if (type !== 'notify') return;

        for (const msg of messages) {

            try {

                if (!msg.message) continue;
                if (msg.key.fromMe) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;

                await messageHandler(
                    sock,
                    msg,
                    commandHandler,
                    prefix,
                    botName
                );

            } catch (err) {
                console.error('❌ Message Handler Error:', err);
            }
        }
    });

    return sock;
}

app.get('/', async (req, res) => {

    const key = req.query.key;

    if (key !== process.env.ADMIN_KEY) {
        return res.status(403).send('Forbidden');
    }

    if (isConnected) {
        return res.send('✅ Voltaria Nexus Online');
    }

    if (latestQR) {

        const qrImage = await qrcode.toDataURL(latestQR);

        return res.send(`
            <html>
                <head>
                    <title>Voltaria QR</title>
                </head>
                <body style="background:#111;color:white;text-align:center;font-family:sans-serif;">
                    <h1>Scan QR Code</h1>
                    <img src="${qrImage}" width="300" />
                </body>
            </html>
        `);
    }

    res.send('⏳ Starting Bot...');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server Running On Port ${PORT}`);
});

process.on('uncaughtException', err => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', err => {
    console.error('❌ Unhandled Rejection:', err);
});

(async () => {
    await connectDatabase();
    await startBot();
})();
