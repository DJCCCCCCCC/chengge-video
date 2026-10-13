import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { chromium } from 'playwright';

const directory = path.resolve('local-docker');
const settings = parse(await readFile(path.join(directory, '.env')));
assert.equal(settings.COMPOSE_PROJECT_NAME, 'chengge-video-local');
assert.equal(settings.NAS_BIND_IP, '127.0.0.1');
assert.equal(settings.ALLOW_REGISTRATION, 'true');
const exec = promisify(execFile);
const composeArgs = ['compose', '--project-name', settings.COMPOSE_PROJECT_NAME, '--env-file', path.join(directory, '.env'), '--file', path.join(directory, 'compose.yaml')];
const username = `regcheck_${randomBytes(8).toString('hex')}`;
const baseURL = `http://127.0.0.1:${settings.PORT}`;
const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
try {
  await mkdir('test-results', { recursive: true });
  const config = await fetch(`${baseURL}/api/config`).then(response => response.json());
  assert.equal(config.allowRegistration, true);
  const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '还没有账号？创建账号', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/docker-registration-entry.png', fullPage: true });
  await page.getByRole('button', { name: '还没有账号？创建账号', exact: true }).click();
  await page.getByRole('heading', { name: '注册账号', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/docker-registration-form.png', fullPage: true });
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('昵称', { exact: true }).fill('注册验证临时账号');
  await page.getByLabel('密码', { exact: true }).fill(randomBytes(24).toString('base64url'));
  const registration = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  assert.equal((await registration).status(), 200);
  await page.locator('.auth-modal').waitFor({ state: 'hidden' });
  const session = await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
  assert.equal(session.user.username, username);
  assert.equal(session.user.role, 'user');
  assert.deepEqual(errors, []);
  console.log('Registration entry visible; form submission creates an ordinary account and logs in.');
} finally {
  await browser.close();
  assert.match(username, /^regcheck_[a-f0-9]{16}$/);
  // Remove only the uniquely marked account created by this verification run.
  const cleanup = "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/yingyu.sqlite');db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');const result=db.prepare(\"DELETE FROM users WHERE username=? AND role='user' AND NOT EXISTS (SELECT 1 FROM videos WHERE owner_id=users.id)\").run(process.argv[1]);console.log(JSON.stringify({testAccountsRemoved:Number(result.changes),users:db.prepare('SELECT COUNT(*) AS n FROM users').get().n,videos:db.prepare('SELECT COUNT(*) AS n FROM videos').get().n}));db.close();";
  const result = await exec('docker', [...composeArgs, 'exec', '-T', 'yingyu', 'node', '-e', cleanup, username], { env: { ...process.env, ...settings }, windowsHide: true, timeout: 30000 });
  console.log(result.stdout.trim());
}
await writeFile('test-results/docker-registration-result.json', JSON.stringify({ status: 'passed', testedAt: new Date().toISOString(), baseURL, allowRegistration: true, checks: ['visible registration entry', 'registration form', 'account creation', 'ordinary user role', 'authenticated session'], testAccountCleanedUp: true }, null, 2) + '\n');
