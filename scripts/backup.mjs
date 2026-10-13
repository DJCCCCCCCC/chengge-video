import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve(process.env.DATA_DIR || './data');
const output = path.resolve(process.argv[2] || `./backups/${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (output === source || output.startsWith(source + path.sep)) throw new Error('Backup directory must be outside DATA_DIR');
// Run with the application stopped: the DB snapshot is consistent, and the media inventory cannot change.
await mkdir(output, { recursive: true });
const db = new DatabaseSync(path.join(source, 'yingyu.sqlite'));
try { db.prepare('VACUUM INTO ?').run(path.join(output, 'yingyu.sqlite')); } finally { db.close(); }
for (const folder of ['videos', 'covers']) {
  await mkdir(path.join(output, folder), { recursive: true });
  for (const entry of await readdir(path.join(source, folder), { withFileTypes: true })) {
    if (entry.isFile()) await copyFile(path.join(source, folder, entry.name), path.join(output, folder, entry.name));
  }
}
await writeFile(path.join(output, 'backup-info.json'), JSON.stringify({ createdAt: new Date().toISOString(), schemaVersion: 1, source, note: 'Restore with application stopped; do not retain stale -wal/-shm files.' }, null, 2));
console.log(`Backup written to ${output}`);
