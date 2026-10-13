import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { parse } from 'dotenv';
import { chromium } from 'playwright';

const directory = path.resolve('local-docker');
const settings = parse(await readFile(path.join(directory, '.env')));
assert.equal(settings.COMPOSE_PROJECT_NAME, 'chengge-video-local');
assert.equal(settings.NAS_BIND_IP, '127.0.0.1');
const baseURL = `http://127.0.0.1:${settings.PORT}`;
const exec = promisify(execFile);
const compose = async args => (await exec('docker', ['compose', '--project-name', settings.COMPOSE_PROJECT_NAME, '--env-file', path.join(directory, '.env'), '--file', path.join(directory, 'compose.yaml'), ...args], { windowsHide: true, timeout: 180000, env: { ...process.env, ...settings } })).stdout.trim();
let cookie, csrf;
async function call(url, { method = 'GET', body, form } = {}) {
  const response = await fetch(baseURL + url, {
    method, headers: { ...(cookie && { Cookie: cookie }), ...(csrf && { 'X-CSRF-Token': csrf }), ...(body && { 'Content-Type': 'application/json' }) },
    body: form || (body && JSON.stringify(body)), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  if (data.csrfToken) csrf = data.csrfToken;
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
assert.equal((await call('/api/health')).database, true);
assert.equal((await call('/api/config')).allowRegistration, settings.ALLOW_REGISTRATION !== 'false');
assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: settings.ADMIN_USERNAME, password: settings.ADMIN_PASSWORD } })).user.role, 'admin');
const overview = await call('/api/admin/overview');
assert.equal(overview.system.platform, 'linux');
const marker = 'Docker 本机部署测试视频';
const existing = await call(`/api/admin/videos?q=${encodeURIComponent(marker)}`);
let video = existing.items.find(item => item.title === marker && item.authorUsername === settings.ADMIN_USERNAME);
if (!video) {
  const categories = await call('/api/categories');
  const form = new FormData();
  form.append('title', marker);
  form.append('description', '本地演示素材，10 秒无声样片。用于验证 Docker 上传、封面和播放，测试结束后保留供手动体验。');
  form.append('categoryId', categories.items[0].id);
  form.append('video', new Blob([await readFile('data/videos/demo-mountains.mp4')], { type: 'video/mp4' }), 'docker-demo.mp4');
  video = await call('/api/videos', { method: 'POST', form });
}
assert.ok(video.duration > 0);
const cover = await fetch(baseURL + video.cover);
assert.equal(cover.status, 200); assert.ok((await cover.arrayBuffer()).byteLength > 100);
const media = await fetch(baseURL + video.mediaUrl, { headers: { Range: 'bytes=0-99' } });
assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 100);
const markerId = randomBytes(4).toString('hex');
const comment = await call(`/api/videos/${video.id}/comments`, { method: 'POST', body: { body: `Docker verification ${markerId}` } });
const danmaku = await call(`/api/videos/${video.id}/danmaku`, { method: 'POST', body: { body: `Docker ${markerId}`, time: 1, color: '#ffffff' } });
await call(`/api/admin/comments/${comment.id}`, { method: 'DELETE' });
await call(`/api/admin/danmaku/${danmaku.id}`, { method: 'DELETE' });
const auditBefore = await call('/api/admin/audit');
assert.ok(auditBefore.items.some(entry => entry.targetType === 'comment' && entry.targetId === String(comment.id)));
console.log('Health, administrator login, video upload/cover/Range, moderation and audit passed.');

const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await page.getByRole('button', { name: '管理员登录', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(settings.ADMIN_USERNAME);
  await page.getByLabel('密码', { exact: true }).fill(settings.ADMIN_PASSWORD);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await page.locator('.admin-system').waitFor();
  await page.screenshot({ path: 'test-results/docker-local-admin.png', fullPage: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ['overview', 'videos', 'users', 'comments', 'danmaku', 'categories', 'audit']) {
      await page.goto(`/admin?tab=${tab}`);
      await page.locator('.admin-main[aria-busy="false"]').waitFor();
      assert.equal(await page.locator('.admin-error').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  }
  await page.goto('/');
  await page.getByRole('heading', { name: '城哥的小视频站', exact: true }).waitFor();
  await page.locator('.video-card').first().waitFor();
  await page.screenshot({ path: 'test-results/docker-local-home.png', fullPage: true });
  await page.goto(`/watch/${video.id}`);
  await page.locator('video').evaluate(async element => { element.muted = true; await element.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5);
  const pixels = await page.locator('video').evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, 64, 36);
    return [...context.getImageData(0, 0, 64, 36).data].filter((value, index) => index % 4 !== 3 && value > 20).length;
  });
  assert.ok(pixels > 500);
  await page.screenshot({ path: 'test-results/docker-local-watch.png', fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }
console.log('Desktop/mobile admin pages, homepage and actual video playback passed.');
await compose(['restart', 'yingyu']);
await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120']);
assert.equal((await call(`/api/videos/${video.id}`)).title, marker);
assert.equal((await call('/api/admin/audit')).total, auditBefore.total);
assert.equal((await call('/api/auth/me')).user.role, 'admin');
const persistedMedia = await fetch(baseURL + video.mediaUrl, { headers: { Range: 'bytes=0-99' } });
assert.equal(persistedMedia.status, 206);
assert.equal((await persistedMedia.arrayBuffer()).byteLength, 100);
const result = {
  status: 'passed', testedAt: new Date().toISOString(), baseURL,
  project: settings.COMPOSE_PROJECT_NAME, image: 'chengge-video:2026.10.13',
  retained: true, demoVideoId: video.id, existingSiteDataModified: false,
  checks: ['health', 'admin login', 'registration matches deployment configuration', 'video upload and FFmpeg cover', 'Range playback', 'comment and danmaku moderation', 'audit', 'desktop/mobile seven admin tabs', 'homepage', 'video time advance and decoded pixels', 'container restart persistence for session/database/media/audit'],
};
await writeFile('test-results/docker-local-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
