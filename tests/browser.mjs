import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const executablePath = process.env.BROWSER_PATH || (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4300';
await mkdir('test-results', { recursive: true });
const results = [], errors = [];
const username = `ui_${randomBytes(5).toString('hex')}`;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('.video-card').first().waitFor();
  assert.equal(await page.title(), '城哥的小视频站');
  await page.getByRole('heading', { name: '城哥的小视频站', exact: true }).waitFor();
  assert.equal(await page.locator('.site-banner img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  await page.getByRole('button', { name: '下一个视频', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '轮播第 2 项', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '轮播第 1 项', exact: true }).click();
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  assert.equal(await page.locator('.video-card').count(), 8);
  assert.equal(await page.locator('.thumbnail img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
  results.push('Chengge branding, banner, working carousel, desktop feed and local images');
  await page.getByRole('button', { name: '数码科技', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 1);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索视频' }).fill('山野');
  await page.getByRole('textbox', { name: '搜索视频' }).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 1);
  assert.match(await page.locator('.video-title').innerText(), /山野/);
  results.push('Category and search connected to backend');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '还没有账号？创建账号' }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('昵称', { exact: true }).fill('浏览器测试');
  await page.getByLabel('密码', { exact: true }).fill('ui-test-password-strong');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await page.locator('.auth-modal').waitFor({ state: 'hidden' });
  results.push('UI registration and session');
  await page.locator('.video-title').first().click();
  await page.locator('video').waitFor();
  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5);
  const pixels = await page.locator('video').evaluate(video => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36; const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 64, 36); const pixels = ctx.getImageData(0, 0, 64, 36).data; return [...pixels].filter((value, index) => index % 4 !== 3 && value > 20).length;
  });
  assert.ok(pixels > 500); results.push('Video plays and decoded frame is nonblank');
  await page.getByRole('button', { name: '收藏', exact: true }).click(); await page.getByRole('button', { name: '已收藏', exact: true }).waitFor();
  await page.locator('.interaction-bar').getByRole('button', { name: '稍后再看', exact: true }).click(); await page.getByRole('button', { name: '已加入', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '评论内容' }).fill('浏览器端到端测试评论');
  await page.getByRole('button', { name: '发布', exact: true }).click(); await page.getByText('浏览器端到端测试评论', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '发送弹幕' }).fill('本地弹幕测试');
  await page.getByRole('button', { name: '发送弹幕', exact: true }).click();
  await page.locator('.danmaku-layer').getByText('本地弹幕测试', { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/watch-desktop.png', fullPage: true });
  results.push('Favorite, watch-later, comment and timestamped danmaku');
  await page.goto('/library/favorite'); await page.locator('.video-card').waitFor();
  await page.goto('/upload'); await page.locator('.dropzone').waitFor();
  await page.screenshot({ path: 'test-results/upload-desktop.png', fullPage: true });
  await page.getByLabel('选择视频', { exact: true }).setInputFiles('data/videos/demo-mountains.mp4');
  await page.getByLabel('作品标题').fill('浏览器上传测试');
  await page.getByRole('button', { name: '发布作品' }).click();
  await page.waitForURL(/\/watch\/\d+/, { timeout: 60000 });
  await page.getByRole('heading', { name: '浏览器上传测试', exact: true }).waitFor();
  results.push('UI upload through ffprobe/cover generation to playback page');
  const uploadedId = new URL(page.url()).pathname.split('/').pop();
  // Clean up this test account and its content through an isolated, explicit marker.
  await page.evaluate(async id => { const session = await fetch('/api/auth/me').then(r => r.json()); await fetch(`/api/videos/${id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken } }); }, uploadedId);
  for (const width of [320, 390, 768, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/'); await page.locator('.video-card').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}`);
    const headerLayout = await page.evaluate(() => {
      const brand = document.querySelector('.header-left').getBoundingClientRect();
      const actions = document.querySelector('.top-actions').getBoundingClientRect();
      const search = document.querySelector('.search-box').getBoundingClientRect();
      return { separate: brand.right <= actions.left, searchSeparate: innerWidth <= 600 ? search.top >= brand.bottom - 1 : search.left >= brand.right && search.right <= actions.left, headerTop: document.querySelector('.topbar').getBoundingClientRect().top };
    });
    assert.ok(headerLayout.separate && headerLayout.searchSeparate, `Header overlap at ${width}: ${JSON.stringify(headerLayout)}`);
    assert.equal(headerLayout.headerTop, 0);
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true });
    await page.locator('.video-title').first().click(); await page.locator('video').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Watch overflow at ${width}`);
    await page.screenshot({ path: `test-results/watch-${width}.png`, fullPage: true });
    if (width === 390) { await page.getByRole('button', { name: '展开导航' }).click(); await page.locator('.sidebar.open').waitFor(); }
  }
  results.push('320px, 390px, 768px and 1920px layouts; non-overlapping header; navigation and player framing');
  assert.deepEqual(errors, []);
  await writeFile('test-results/browser-result.json', JSON.stringify({ status: 'passed', results, errors, testUsername: username }, null, 2));
  console.log(JSON.stringify({ status: 'passed', results, errors, testUsername: username }, null, 2));
  await context.close();
} finally {
  await browser.close();
  if (!process.env.TEST_BASE_URL && /^ui_[a-f0-9]{10}$/.test(username)) {
    const db = new DatabaseSync(path.resolve(process.env.DATA_DIR || 'data', 'yingyu.sqlite'));
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (user && !db.prepare('SELECT id FROM videos WHERE owner_id=?').get(user.id)) db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    db.close();
  }
}
