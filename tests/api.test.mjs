import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';

const exec = promisify(execFile);
test('local end-to-end API, persistence, authorization and media lifecycle', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yingyu-test-'));
  const { app, db } = createApp({ dataDir: dir, adminPassword: 'test-admin-12-characters', maxUploadMb: 1 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = { anonymous: {}, admin: {}, alice: {}, bob: {} };
  async function call(client, url, method = 'GET', body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (client.cookie) headers.Cookie = client.cookie;
    if (client.csrf) headers['X-CSRF-Token'] = client.csrf;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await fetch(base + url, { method, body, headers });
    const data = await response.json();
    const cookie = response.headers.get('set-cookie');
    if (cookie) client.cookie = cookie.split(';')[0];
    if (data.csrfToken) client.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  let videoId, aliceId;
  try {
    await t.test('health, categories and bootstrap admin', async () => {
      assert.equal((await call(clients.anonymous, '/api/health')).data.status, 'ok');
      assert.equal((await call(clients.anonymous, '/api/config')).data.name, '城哥的小视频站');
      assert.equal((await call(clients.anonymous, '/api/categories')).data.items.length, 6);
      assert.equal((await call(clients.admin, '/api/auth/login', 'POST', { username: 'admin', password: 'test-admin-12-characters' })).status, 200);
      assert.equal((await call(clients.admin, '/api/auth/me')).data.user.role, 'admin');
    });
    await t.test('registration, duplicate users, login validation', async () => {
      const result = await call(clients.alice, '/api/auth/register', 'POST', { username: 'alice', displayName: 'Alice', password: 'strong-password-alice' });
      assert.equal(result.status, 200); aliceId = result.data.user.id;
      assert.equal((await call(clients.anonymous, '/api/auth/register', 'POST', { username: 'alice', password: 'strong-password-alice' })).status, 409);
      assert.equal((await call(clients.anonymous, '/api/auth/register', 'POST', { username: 'bad', password: '123' })).status, 400);
      assert.equal((await call(clients.anonymous, '/api/auth/login', 'POST', { username: 'alice', password: 'not-the-password' })).status, 401);
      assert.equal((await call(clients.anonymous, '/api/auth/login', 'POST')).status, 400);
      assert.equal((await call(clients.bob, '/api/auth/register', 'POST', { username: 'bob', password: 'strong-password-bob' })).status, 200);
    });
    await t.test('anonymous writes, cross-origin and CSRF denied', async () => {
      assert.equal((await call(clients.anonymous, '/api/videos', 'POST')).status, 401);
      assert.equal((await call({ cookie: clients.alice.cookie }, '/api/me/history', 'DELETE')).status, 403);
      assert.equal((await call(clients.alice, '/api/me/history', 'DELETE', undefined, { Origin: 'https://evil.example' })).status, 403);
    });
    const sample = path.join(dir, 'sample.mp4');
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-y', sample], { windowsHide: true });
    const bytes = await readFile(sample);
    const form = (blob = new Blob([bytes], { type: 'video/mp4' }), name = 'sample.mp4') => {
      const data = new FormData(); data.append('video', blob, name); data.append('title', '测试视频 100%'); data.append('categoryId', 'tech'); data.append('description', 'Local API fixture'); return data;
    };
    await t.test('real multipart upload, ffprobe and generated cover', async () => {
      const result = await call(clients.alice, '/api/videos', 'POST', form());
      assert.equal(result.status, 201, JSON.stringify(result.data)); videoId = result.data.id;
      assert.equal(result.data.width, 320); assert.equal(result.data.ownerId, aliceId);
      assert.ok(result.data.duration >= 1.9); assert.ok(result.data.cover.endsWith('.jpg'));
      assert.equal((await fetch(base + result.data.cover)).status, 200);
    });
    await t.test('media range and missing routes', async () => {
      const video = (await call(clients.alice, `/api/videos/${videoId}`)).data;
      const response = await fetch(base + video.mediaUrl, { headers: { Range: 'bytes=0-99' } });
      assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 100);
      assert.match(response.headers.get('content-range'), /^bytes 0-99\//);
      const invalidRange = await fetch(base + video.mediaUrl, { headers: { Range: 'bytes=999999999-' } });
      assert.equal(invalidRange.status, 416);
      assert.equal((await fetch(base + '/media/videos/missing.mp4')).status, 404);
      assert.equal((await call(clients.anonymous, '/api/videos/not-a-number')).status, 400);
      assert.equal((await call(clients.anonymous, '/api/videos/999999')).status, 404);
    });
    await t.test('search wildcard escaping and category filter', async () => {
      assert.equal((await call(clients.anonymous, '/api/videos?q=100%25')).data.total, 1);
      assert.equal((await call(clients.anonymous, '/api/videos?category=music')).data.total, 0);
      assert.equal((await call(clients.anonymous, '/api/videos?category=tech')).data.total, 1);
      assert.equal((await call(clients.anonymous, '/api/videos?q=%27%20OR%201%3D1--')).data.total, 0);
    });
    await t.test('idempotent likes, lists, history and bounded positions', async () => {
      for (let i = 0; i < 2; i++) assert.equal((await call(clients.alice, `/api/videos/${videoId}/like`, 'PUT', { active: true })).data.likes, 1);
      await call(clients.alice, `/api/videos/${videoId}/library`, 'PUT', { kind: 'favorite', active: true });
      await call(clients.alice, `/api/videos/${videoId}/library`, 'PUT', { kind: 'later', active: true });
      assert.equal((await call(clients.alice, '/api/me/library?kind=favorite')).data.total, 1);
      assert.equal((await call(clients.bob, '/api/me/library?kind=favorite')).data.total, 0);
      await call(clients.alice, `/api/videos/${videoId}/history`, 'PUT', { position: 999 });
      assert.ok((await call(clients.alice, `/api/videos/${videoId}`)).data.position <= 2.1);
      assert.equal((await call(clients.alice, `/api/videos/${videoId}/history`, 'PUT', { position: -1 })).status, 400);
      assert.equal((await call(clients.alice, '/api/me/library?kind=history')).data.total, 1);
      await call(clients.alice, '/api/me/history', 'DELETE');
      assert.equal((await call(clients.alice, '/api/me/library?kind=history')).data.total, 0);
    });
    await t.test('comments and ownership checks', async () => {
      const comment = await call(clients.alice, `/api/videos/${videoId}/comments`, 'POST', { body: '<script>alert(1)</script>' });
      assert.equal(comment.status, 201);
      assert.equal((await call(clients.bob, `/api/comments/${comment.data.id}`, 'DELETE')).status, 403);
      assert.equal((await call(clients.anonymous, `/api/videos/${videoId}/comments`)).data.items[0].body, '<script>alert(1)</script>');
      assert.equal((await call(clients.admin, `/api/comments/${comment.data.id}`, 'DELETE')).status, 200);
      assert.equal((await call(clients.alice, `/api/videos/${videoId}/comments`, 'POST', { body: ' ' })).status, 400);
    });
    await t.test('timestamped danmaku validation', async () => {
      assert.equal((await call(clients.alice, `/api/videos/${videoId}/danmaku`, 'POST', { body: 'Hello', time: 1, color: '#ffffff' })).status, 201);
      assert.equal((await call(clients.anonymous, `/api/videos/${videoId}/danmaku`)).data.items.length, 1);
      assert.equal((await call(clients.alice, `/api/videos/${videoId}/danmaku`, 'POST', { body: 'Bad', time: 100 })).status, 400);
      assert.equal((await call(clients.alice, `/api/videos/${videoId}/danmaku`, 'POST', { body: 'Bad', time: 1, color: 'red;position:absolute' })).status, 400);
    });
    await t.test('invalid uploads and cleanup', async () => {
      assert.equal((await call(clients.alice, '/api/videos', 'POST', form(new Blob(['not video']), 'fake.mp4'))).status, 422);
      assert.equal((await call(clients.alice, '/api/videos', 'POST', form(new Blob(['x']), 'fake.html'))).status, 400);
      assert.equal((await call(clients.alice, '/api/videos', 'POST', form(new Blob([new Uint8Array(1100000)])))).status, 413);
      assert.equal((await readdir(path.join(dir, 'tmp'))).length, 0);
    });
    await t.test('persistence through a separate database connection', async () => {
      const reopened = openDatabase(dir);
      try { assert.equal(reopened.prepare('SELECT title FROM videos WHERE id=?').get(videoId).title, '测试视频 100%'); assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM library').get().n, 2); }
      finally { reopened.close(); }
    });
    await t.test('backup snapshot and media restore integrity', async () => {
      const scratch = await mkdtemp(path.join(tmpdir(), 'yingyu-backup-test-'));
      const source = path.join(scratch, 'source'), output = path.join(scratch, 'snapshot');
      try {
        const fixture = createApp({ dataDir: source, adminPassword: 'backup-test-password' });
        fixture.db.prepare("INSERT INTO videos(owner_id,category_id,title,filename,cover_filename) VALUES (1,'life','Backup fixture','fixture.mp4','fixture.jpg')").run();
        fixture.db.close();
        await writeFile(path.join(source, 'videos', 'fixture.mp4'), bytes);
        await writeFile(path.join(source, 'covers', 'fixture.jpg'), Buffer.from('cover-test'));
        await exec(process.execPath, ['scripts/backup.mjs', output], { env: { ...process.env, DATA_DIR: source }, windowsHide: true });
        const restored = openDatabase(output);
        try { assert.equal(restored.prepare('SELECT title FROM videos').get().title, 'Backup fixture'); assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
        finally { restored.close(); }
        assert.deepEqual(await readFile(path.join(output, 'videos', 'fixture.mp4')), bytes);
        assert.equal((await readFile(path.join(output, 'covers', 'fixture.jpg'))).toString(), 'cover-test');
      } finally {
        assert.equal(path.dirname(scratch), path.resolve(tmpdir())); assert.ok(path.basename(scratch).startsWith('yingyu-backup-test-'));
        await rm(scratch, { recursive: true, force: true });
      }
    });
    await t.test('deletion cascades and media removed', async () => {
      assert.equal((await call(clients.bob, `/api/videos/${videoId}`, 'DELETE')).status, 403);
      assert.equal((await call(clients.alice, `/api/videos/${videoId}`, 'DELETE')).status, 200);
      for (const table of ['video_likes', 'library', 'history', 'comments', 'danmaku']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
      assert.equal((await readdir(path.join(dir, 'videos'))).length, 0);
      assert.equal((await readdir(path.join(dir, 'covers'))).length, 0);
    });
    await t.test('logout invalidates session', async () => {
      const cookie = clients.alice.cookie;
      assert.equal((await call(clients.alice, '/api/auth/logout', 'POST')).status, 200);
      assert.equal((await call({ cookie }, '/api/auth/me')).data.user, null);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
    // Only remove the exact temporary directory allocated by this test.
    assert.equal(path.dirname(dir), path.resolve(tmpdir())); assert.ok(path.basename(dir).startsWith('yingyu-test-'));
    await rm(dir, { recursive: true, force: true });
  }
});
