import { initEnv } from './init.mjs';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { createApp } from '../server/app.mjs';

initEnv();
loadEnv({ quiet: true });
const { app, db } = createApp({ dataDir: path.resolve(process.env.DATA_DIR || './data') });
const port = Number(process.env.PORT || 4300);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Chengge Video running at http://${host}:${port}. Admin credentials are in .env.`));
server.on('error', error => { console.error(error.message); db.close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
