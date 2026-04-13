import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import fs from 'fs';
import { pg } from '../config/db.js';
import { SESSION_DIR, syncSessionFromDB, syncSessionToDB } from './sessionService.js';
import { handleMessage } from '../controllers/messageController.js';

let isConnecting = false;

export async function startBot() {
    if (isConnecting) return; // جلوگیری از múltiplas instâncias
    isConnecting = true;

    await syncSessionFromDB();

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 10000,
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await syncSessionToDB();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan the QR code below with WhatsApp:');
            qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (!err) console.log(url);
            });
        }

        if (connection === 'open') {
            console.log('✅ Bot connected!');
            isConnecting = false;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('Connection closed:', statusCode);

            if (shouldReconnect) {
                console.log('Reconnecting in 5 seconds...');
                isConnecting = false;

                setTimeout(() => {
                    startBot();
                }, 1000); // ⬅️ KEY FIX
            } else {
                console.log('Logged out — clearing session');

                await pg.query('DELETE FROM whatsapp_sessions WHERE id = $1', ['baileys']);
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });

                isConnecting = false;
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const message of messages) {
            await handleMessage(sock, message);
        }
    });
}