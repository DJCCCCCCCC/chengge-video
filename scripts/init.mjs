import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function initEnv() {
  if (existsSync('.env')) return;
  if (process.env.NODE_ENV === 'production') return;
  const password = randomBytes(18).toString('base64url');
  writeFileSync('.env', `PORT=4300\nHOST=127.0.0.1\nDATA_DIR=./data\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${password}\nALLOW_REGISTRATION=true\nCOOKIE_SECURE=false\nTRUST_PROXY=0\nMAX_UPLOAD_MB=2048\nFFMPEG_PATH=ffmpeg\nFFPROBE_PATH=ffprobe\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created .env with a unique administrator password. Keep this file private.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) initEnv();
