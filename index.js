import dotenv from 'dotenv';
import { startHeartbeat } from './src/config/db.js';
import { startBot } from './src/services/whatsappService.js';

dotenv.config();

async function main() {
    try {
        console.log('🚀 Starting WhatsApp bot...');
        startHeartbeat();
        await startBot();
    } catch (err) {
        console.error('❌ Failed to start bot:', err);
        process.exit(1);
    }
}

main();
