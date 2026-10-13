import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const architecture = process.argv[2] || 'amd64';
assert.ok(['amd64', 'arm64'].includes(architecture), 'Architecture must be amd64 or arm64');
const release = path.resolve(`releases/chengge-video-2026.10.13-linux-${architecture}`);
const image = `chengge-video:2026.10.13${architecture === 'arm64' ? '-arm64' : ''}`;
const project = `chengge-image-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, PORT: '0', NAS_BIND_IP: '127.0.0.1', ALLOW_REGISTRATION: 'false' };
const composeArgs = ['compose', '--project-name', project, '--env-file', path.join(release, '.env.example'), '--file', path.join(release, 'compose.yaml')];
function docker(args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Docker command timed out: ${args[0]}`)); }, timeout);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error(`Docker exit ${code}: ${stderr || stdout}`)); });
  });
}
const compose = args => docker([...composeArgs, ...args]);
const checks = [];
let browser;
try {
  await mkdir('test-results', { recursive: true });
  await compose(['config', '--quiet']);
  await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '240']);
  const binding = await compose(['port', 'yingyu', '4300']);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  let baseURL = `http://${binding}`;
  let cookie, csrf;
  async function call(url, { method = 'GET', body, form } = {}) {
    const headers = { ...(cookie && { Cookie: cookie }), ...(csrf && { 'X-CSRF-Token': csrf }), ...(body && { 'Content-Type': 'application/json' }) };
    const response = await fetch(baseURL + url, { method, headers, body: form || (body && JSON.stringify(body)), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  }
  assert.equal((await call('/api/health')).data.database, true);
  assert.equal((await call('/api/config')).data.allowRegistration, false);
  assert.equal((await call('/api/admin/overview')).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password } })).status, 200);
  assert.equal((await call('/api/admin/overview')).data.totals.videos, 0);
  checks.push('Compose import-only deployment, healthy container, fresh database, admin login, registration disabled');
  console.log('Container healthy; administrator login verified.');

  const isolation = JSON.parse(await compose(['exec', '-T', 'yingyu', 'node', '-e', "const fs=require('node:fs'); console.log(JSON.stringify({uid:process.getuid(),envFile:fs.existsSync('/app/.env'),testFiles:fs.existsSync('/app/test-results'),devDependencies:fs.existsSync('/app/node_modules/vite'),node:process.version,architecture:process.arch}))"]));
  assert.equal(isolation.architecture, architecture === 'amd64' ? 'x64' : 'arm64');
  assert.equal(isolation.uid, 1000);
  assert.equal(isolation.envFile, false);
  assert.equal(isolation.testFiles, false);
  assert.equal(isolation.devDependencies, false);
  checks.push('Non-root runtime, no local secrets or development dependencies in image');

  assert.equal((await call('/api/admin/categories', { method: 'POST', body: { id: 'docker_test', name: 'Docker test', sortOrder: 100 } })).status, 201);
  const form = new FormData();
  form.append('title', 'Docker deployment verification');
  form.append('description', 'Isolated image smoke test');
  form.append('categoryId', 'docker_test');
  form.append('video', new Blob([await readFile('data/videos/demo-mountains.mp4')], { type: 'video/mp4' }), 'fixture.mp4');
  const upload = await call('/api/videos', { method: 'POST', form });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const video = upload.data;
  assert.ok(video.duration > 0);
  const cover = await fetch(baseURL + video.cover);
  assert.equal(cover.status, 200);
  assert.ok((await cover.arrayBuffer()).byteLength > 100);
  const stream = await fetch(baseURL + video.mediaUrl, { headers: { Range: 'bytes=0-99' } });
  assert.equal(stream.status, 206);
  assert.equal((await stream.arrayBuffer()).byteLength, 100);
  assert.equal((await call(`/api/admin/videos/${video.id}`, { method: 'PATCH', body: { title: 'Docker persisted video', description: '', categoryId: 'docker_test' } })).status, 200);
  assert.equal((await call('/api/admin/audit')).data.total, 2);
  checks.push('FFprobe/FFmpeg upload and JPEG cover, video Range playback, admin edits and audit records');
  console.log('Upload, cover, media streaming and admin API verified.');

  const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await page.getByRole('button', { name: '管理员登录' }).click();
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await page.locator('.admin-system').waitFor();
  await page.screenshot({ path: `test-results/docker-${architecture}-admin.png`, fullPage: true });
  await page.getByRole('button', { name: '分区管理', exact: true }).click();
  await page.getByRole('button', { name: '编辑分区：Docker test', exact: true }).waitFor();
  await page.getByRole('button', { name: '操作日志', exact: true }).click();
  await page.getByRole('cell', { name: /编辑视频：Docker persisted video/ }).waitFor();
  await page.goto(`/watch/${video.id}`);
  await page.locator('video').evaluate(async node => { node.muted = true; await node.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5);
  const pixels = await page.locator('video').evaluate(video => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 64, 36);
    return [...context.getImageData(0, 0, 64, 36).data].filter((value, index) => index % 4 !== 3 && value > 20).length;
  });
  assert.ok(pixels > 500);
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close(); browser = null;
  checks.push('Container-served admin pages, login, categories, audit, playing video and nonblank decoded frame');
  console.log('Browser admin pages and decoded video playback verified.');

  await compose(['restart', 'yingyu']);
  await compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '240']);
  const restartedBinding = await compose(['port', 'yingyu', '4300']);
  assert.match(restartedBinding, /^127\.0\.0\.1:\d+$/);
  baseURL = `http://${restartedBinding}`;
  assert.equal((await call(`/api/videos/${video.id}`)).data.title, 'Docker persisted video');
  assert.equal((await call('/api/admin/audit')).data.total, 2);
  assert.equal((await call('/api/admin/overview')).data.totals.users, 1);
  const persistedMedia = await fetch(baseURL + video.mediaUrl, { headers: { Range: 'bytes=0-99' } });
  assert.equal(persistedMedia.status, 206);
  assert.equal((await persistedMedia.arrayBuffer()).byteLength, 100);
  checks.push('Database, media, administrator session and audit persist across container restart');
  const inspected = JSON.parse(await docker(['image', 'inspect', image]))[0];
  assert.equal(inspected.Os, 'linux'); assert.equal(inspected.Architecture, architecture);
  const dockerArchitecture = (await docker(['info', '--format', '{{.Architecture}}'])).trim();
  const hostArchitecture = ({ x86_64: 'amd64', aarch64: 'arm64' })[dockerArchitecture] || dockerArchitecture;
  const result = { status: 'passed', testedAt: new Date().toISOString(), image, imageId: inspected.Id, platform: `${inspected.Os}/${inspected.Architecture}`, imageSizeBytes: inspected.Size, runtimeNode: isolation.node, runtimeArchitecture: isolation.architecture, hostArchitecture, emulated: architecture !== hostArchitecture, checks, nasHardwareTested: false };
  await writeFile(path.join(release, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  // Delete only this run's randomly named Compose project and its isolated test volume.
  assert.match(project, /^chengge-image-test-[a-f0-9]{12}$/);
  await compose(['down', '--volumes', '--remove-orphans']);
}
