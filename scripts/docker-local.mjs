import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'local-docker');
await mkdir(directory, { recursive: true });
async function missing(file) {
  try { await access(file); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
if (await missing(path.join(directory, 'compose.yaml'))) {
  await copyFile(path.join(root, 'releases/chengge-video-2026.10.13-linux-amd64/compose.yaml'), path.join(directory, 'compose.yaml'));
}
if (await missing(path.join(directory, '.env'))) {
  const password = randomBytes(24).toString('base64url');
  await writeFile(path.join(directory, '.env'), [
    'COMPOSE_PROJECT_NAME=chengge-video-local', 'PORT=4303', 'NAS_BIND_IP=127.0.0.1',
    'ADMIN_USERNAME=admin', `ADMIN_PASSWORD=${password}`, 'ALLOW_REGISTRATION=false',
    'COOKIE_SECURE=false', 'TRUST_PROXY=0', 'MAX_UPLOAD_MB=2048', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
}
console.log(`Local deployment prepared: ${directory}. Credentials are in its .env; existing settings were preserved.`);
