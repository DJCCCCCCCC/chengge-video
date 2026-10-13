import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const categories = [
  ['life', '生活记录'], ['travel', '旅行风景'], ['tech', '数码科技'],
  ['music', '音乐现场'], ['creative', '创作灵感'], ['knowledge', '知识分享'],
];

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  for (const folder of ['videos', 'covers', 'tmp']) mkdirSync(path.join(dataDir, folder), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'yingyu.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  db.exec(readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8'));
  // Seed once so categories intentionally removed by an admin stay removed on restart.
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO categories(id,name,sort_order) VALUES (?,?,?)');
      categories.forEach(([id, name], index) => insert.run(id, name, index));
      db.prepare('INSERT INTO schema_migrations(version) VALUES (2)').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  return db;
}
