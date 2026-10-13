import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/auth.mjs';
import { openDatabase } from '../server/db.mjs';

test('admin permissions, management actions and session safety', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chengge-admin-test-'));
  const { app, db } = createApp({ dataDir: dir, adminPassword: 'admin-test-password-strong', allowRegistration: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = {}, member = {}, secondary = {};
  const userId = Number(db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES ('member','测试用户',?)").run(hashPassword('member-test-password-strong')).lastInsertRowid);
  const videoId = Number(db.prepare("INSERT INTO videos(owner_id,category_id,title,filename,cover_filename,size_bytes,duration) VALUES (?,'life','管理测试','fixture.mp4','fixture.jpg',100,10)").run(userId).lastInsertRowid);
  await writeFile(path.join(dir, 'videos', 'fixture.mp4'), 'test-media');
  await writeFile(path.join(dir, 'covers', 'fixture.jpg'), 'test-cover');
  async function call(client, url, method = 'GET', body) {
    const headers = {};
    if (client.cookie) headers.Cookie = client.cookie;
    if (client.csrf) headers['X-CSRF-Token'] = client.csrf;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(), cookie = response.headers.get('set-cookie');
    if (cookie) client.cookie = cookie.split(';')[0];
    if (data.csrfToken) client.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  try {
    await call(admin, '/api/auth/login', 'POST', { username: 'admin', password: 'admin-test-password-strong' });
    await call(member, '/api/auth/login', 'POST', { username: 'member', password: 'member-test-password-strong' });
    await t.test('all admin resources deny anonymous and ordinary accounts', async () => {
      for (const kind of ['overview', 'videos', 'users', 'comments', 'danmaku', 'categories', 'audit']) {
        assert.equal((await call({}, `/api/admin/${kind}`)).status, 401);
        assert.equal((await call(member, `/api/admin/${kind}`)).status, 403);
      }
      assert.equal((await call(member, `/api/admin/videos/${videoId}`, 'PATCH', { title: 'no' })).status, 403);
      assert.equal((await call({ cookie: admin.cookie }, `/api/admin/videos/${videoId}`, 'DELETE')).status, 403);
      assert.equal((await call(member, '/api/admin/users', 'POST', { username: 'evil', role: 'admin' })).status, 403);
      assert.equal((await call(member, '/api/admin/categories', 'POST', { id: 'evil', name: '非法分区', sortOrder: 1 })).status, 403);
      assert.equal((await call({ cookie: admin.cookie }, '/api/admin/categories/tech', 'DELETE')).status, 403);
    });
    await t.test('overview statistics and safe paginated listings', async () => {
      const summary = (await call(admin, '/api/admin/overview')).data;
      assert.equal(summary.totals.users, 2); assert.equal(summary.totals.videos, 1); assert.equal(summary.totals.mediaBytes, 100);
      assert.ok(summary.system.diskFreeBytes > 0); assert.equal(summary.system.allowRegistration, false);
      assert.deepEqual(summary.videoStatuses, { ready: 1, processing: 0, failed: 0 });
      assert.equal(summary.recentVideos[0].status, 'ready');
      const users = (await call(admin, '/api/admin/users')).data;
      assert.equal(users.total, 2);
      for (const user of users.items) { assert.equal(user.password_hash, undefined); assert.equal(user.csrf_token, undefined); assert.equal(user.token_hash, undefined); }
      assert.equal((await call(admin, '/api/admin/videos?limit=1')).data.items.length, 1);
      assert.equal((await call(admin, '/api/admin/videos?q=%27%20OR%201%3D1--')).data.total, 0);
      assert.equal((await call(admin, '/api/admin/videos?status=invalid')).status, 400);
      for (const kind of ['videos', 'users', 'categories', 'audit']) {
        const result = (await call(admin, `/api/admin/${kind}?page=9999&limit=1`)).data;
        assert.equal(result.page, Math.max(1, result.total));
      }
    });
    await t.test('video edits validate fields and persist to public API', async () => {
      assert.equal((await call(admin, `/api/admin/videos/${videoId}`, 'PATCH', { title: '修改标题', description: '<script>safe text</script>', categoryId: 'tech' })).status, 200);
      const publicVideo = (await call({}, `/api/videos/${videoId}`)).data;
      assert.equal(publicVideo.title, '修改标题'); assert.equal(publicVideo.categoryId, 'tech');
      assert.equal((await call(admin, `/api/admin/videos/${videoId}`, 'PATCH', { title: '', categoryId: 'tech' })).status, 400);
      assert.equal((await call(admin, `/api/admin/videos/${videoId}`, 'PATCH', { title: 'Valid', categoryId: 'missing' })).status, 400);
      assert.equal((await call(admin, '/api/admin/videos/999999', 'PATCH', { title: 'Valid', categoryId: 'life' })).status, 404);
    });
    let secondaryId;
    await t.test('admin can create accounts while public registration is closed', async () => {
      assert.equal((await call({}, '/api/auth/register', 'POST', { username: 'closed', password: 'long-test-password' })).status, 403);
      const result = await call(admin, '/api/admin/users', 'POST', { username: 'second_admin', displayName: '第二管理员', password: 'second-admin-password', role: 'admin' });
      assert.equal(result.status, 201); secondaryId = result.data.id;
      assert.equal(result.data.password_hash, undefined);
      assert.equal((await call(admin, '/api/admin/users', 'POST', { username: 'SECOND_ADMIN', password: 'second-admin-password' })).status, 409);
      assert.equal((await call(admin, '/api/admin/users', 'POST', { username: 'weak', password: 'short' })).status, 400);
      assert.equal((await call(admin, '/api/admin/users', 'POST', { username: 'bad.name', password: 'long-test-password' })).status, 400);
      assert.equal((await call(secondary, '/api/auth/login', 'POST', { username: 'second_admin', password: 'second-admin-password' })).status, 200);
    });
    await t.test('role changes apply to existing sessions and protect current admin', async () => {
      assert.equal((await call(admin, '/api/admin/users/1', 'PATCH', { role: 'user' })).status, 409);
      assert.equal((await call(admin, `/api/admin/users/${secondaryId}`, 'PATCH', { role: 'user', displayName: '普通成员' })).status, 200);
      assert.equal((await call(secondary, '/api/admin/overview')).status, 403);
      assert.equal((await call(secondary, '/api/auth/me')).data.user.role, 'user');
      assert.equal((await call(admin, `/api/admin/users/${userId}`, 'PATCH', { role: 'root' })).status, 400);
      assert.equal((await call(admin, `/api/admin/users/${userId}`, 'PATCH', {})).status, 400);
      assert.equal((await call(admin, `/api/admin/users/${userId}`, 'PATCH', { displayName: '更新昵称' })).data.displayName, '更新昵称');
    });
    await t.test('password reset invalidates every old session and replaces password', async () => {
      const oldCookie = member.cookie;
      assert.equal((await call(admin, `/api/admin/users/${userId}/password`, 'POST', { password: 'new-member-password-strong' })).status, 200);
      assert.equal((await call({ cookie: oldCookie }, '/api/auth/me')).data.user, null);
      assert.equal((await call({}, '/api/auth/login', 'POST', { username: 'member', password: 'member-test-password-strong' })).status, 401);
      assert.equal((await call(member, '/api/auth/login', 'POST', { username: 'member', password: 'new-member-password-strong' })).status, 200);
      assert.equal((await call(admin, `/api/admin/users/${userId}/password`, 'POST', { password: 'weak' })).status, 400);
    });
    await t.test('session revocation signs target out without affecting the admin', async () => {
      const oldCookie = member.cookie;
      assert.equal((await call(admin, `/api/admin/users/${userId}/sessions`, 'DELETE')).data.revoked, 1);
      assert.equal((await call({ cookie: oldCookie }, '/api/auth/me')).data.user, null);
      assert.equal((await call(admin, '/api/admin/overview')).status, 200);
      assert.equal((await call(admin, '/api/admin/users/999999/sessions', 'DELETE')).status, 404);
    });
    await t.test('comment and danmaku moderation is reflected in public feeds', async () => {
      const commentId = Number(db.prepare('INSERT INTO comments(video_id,user_id,body) VALUES (?,?,?)').run(videoId, userId, '评论审核测试').lastInsertRowid);
      const dmId = Number(db.prepare('INSERT INTO danmaku(video_id,user_id,body,time) VALUES (?,?,?,?)').run(videoId, userId, '弹幕审核测试', 1).lastInsertRowid);
      assert.equal((await call(admin, '/api/admin/comments?q=审核')).data.total, 1);
      assert.equal((await call(admin, `/api/admin/danmaku?videoId=${videoId}`)).data.total, 1);
      assert.equal((await call(member, `/api/admin/danmaku/${dmId}`, 'DELETE')).status, 401);
      assert.equal((await call(admin, `/api/admin/comments/${commentId}`, 'DELETE')).status, 200);
      assert.equal((await call(admin, `/api/admin/danmaku/${dmId}`, 'DELETE')).status, 200);
      assert.equal((await call({}, `/api/videos/${videoId}/comments`)).data.total, 0);
      assert.equal((await call({}, `/api/videos/${videoId}/danmaku`)).data.items.length, 0);
      assert.equal((await call(admin, `/api/admin/comments/${commentId}`, 'DELETE')).status, 404);
    });
    await t.test('category management validates input and updates public listings', async () => {
      const create = await call(admin, '/api/admin/categories', 'POST', { id: 'test_category', name: '测试分区', sortOrder: 50 });
      assert.equal(create.status, 201);
      assert.equal((await call(admin, '/api/admin/categories', 'POST', { id: 'test_category', name: '重复分区', sortOrder: 50 })).status, 409);
      for (const body of [
        { id: '../bad', name: '非法', sortOrder: 1 }, { id: 'bad', name: '', sortOrder: 1 },
        { id: 'bad', name: '非法', sortOrder: -1 }, { id: 'bad', name: '非法', sortOrder: 1.2 },
        { id: 'bad', name: '非法', sortOrder: '1' }, { id: 'bad', name: '非法', sortOrder: 10000 },
      ]) assert.equal((await call(admin, '/api/admin/categories', 'POST', body)).status, 400);
      assert.equal((await call(admin, '/api/admin/categories/test_category', 'PATCH', { name: '新分区名称', sortOrder: 999 })).status, 200);
      const publicCategories = (await call({}, '/api/categories')).data.items;
      assert.equal(publicCategories.at(-1).name, '新分区名称');
      const category = (await call(admin, '/api/admin/categories?q=test_')).data.items[0];
      assert.equal(category.id, 'test_category'); assert.equal(category.sortOrder, 999); assert.equal(category.videos, 0);
      assert.equal((await call(admin, '/api/admin/categories?limit=1')).data.items.length, 1);
      assert.equal((await call(admin, '/api/admin/categories/missing', 'PATCH', { name: '未找到', sortOrder: 0 })).status, 404);
      assert.equal((await call(admin, '/api/admin/categories/tech', 'DELETE')).status, 409);
      assert.equal((await call(admin, '/api/admin/categories/test_category', 'DELETE')).status, 200);
      assert.equal((await call(admin, '/api/admin/categories/test_category', 'DELETE')).status, 404);
    });
    await t.test('deleted defaults stay deleted after reopening and one category must remain', async () => {
      assert.equal((await call(admin, '/api/admin/categories/life', 'DELETE')).status, 200);
      const reopened = openDatabase(dir);
      try {
        assert.equal(reopened.prepare("SELECT id FROM categories WHERE id='life'").get(), undefined);
        assert.equal(reopened.prepare("SELECT name FROM categories WHERE id='tech'").get().name, '数码科技');
      } finally { reopened.close(); }
      for (const id of ['travel', 'music', 'creative', 'knowledge']) assert.equal((await call(admin, `/api/admin/categories/${id}`, 'DELETE')).status, 200);
      assert.equal((await call(admin, '/api/admin/categories/tech', 'DELETE')).status, 409);
      assert.equal((await call(admin, '/api/admin/categories', 'POST', { id: 'life', name: '生活记录', sortOrder: 0 })).status, 201);
    });
    await t.test('audit log records only successful actions without credentials', async () => {
      const logs = (await call(admin, '/api/admin/audit?limit=50')).data;
      assert.ok(logs.total >= 15);
      assert.ok(logs.items.every(entry => entry.actorUsername === 'admin'));
      assert.ok(logs.items.some(entry => entry.action === 'reset_password'));
      assert.ok(logs.items.some(entry => entry.targetType === 'comment'));
      assert.ok(logs.items.some(entry => entry.targetType === 'danmaku'));
      const categories = (await call(admin, '/api/admin/audit?type=category&limit=50')).data;
      assert.ok(categories.items.every(entry => entry.targetType === 'category'));
      assert.equal(categories.items.filter(entry => entry.targetId === 'test_category').length, 3);
      assert.ok((await call(admin, '/api/admin/audit?q=重置密码')).data.total > 0);
      assert.equal((await call(admin, '/api/admin/audit?type=invalid')).status, 400);
      const serialized = JSON.stringify(logs);
      for (const secret of ['new-member-password-strong', 'password_hash', 'csrf_token', 'token_hash', admin.csrf]) assert.equal(serialized.includes(secret), false);
      assert.equal((await call(admin, `/api/admin/audit/${logs.items[0].id}`, 'DELETE')).status, 404);
    });
    await t.test('audit failure rolls back the underlying admin mutation', async () => {
      db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
      try {
        assert.equal((await call(admin, `/api/admin/videos/${videoId}`, 'PATCH', { title: '不得保存', description: '', categoryId: 'tech' })).status, 500);
        assert.equal(db.prepare('SELECT title FROM videos WHERE id=?').get(videoId).title, '修改标题');
      } finally { db.exec('DROP TRIGGER reject_audit'); }
    });
    await t.test('admin deletes failed media and cascades ready media records', async () => {
      const failedId = Number(db.prepare("INSERT INTO videos(owner_id,category_id,title,filename,status) VALUES (?,'life','失败记录','failed.mp4','failed')").run(userId).lastInsertRowid);
      assert.equal((await call(admin, `/api/admin/videos/${failedId}`, 'DELETE')).status, 200);
      db.prepare("INSERT INTO library(user_id,video_id,kind) VALUES (?,?,'favorite')").run(userId, videoId);
      assert.equal((await call(admin, `/api/admin/videos/${videoId}`, 'DELETE')).status, 200);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM library').get().n, 0);
      await assert.rejects(access(path.join(dir, 'videos', 'fixture.mp4')));
      await assert.rejects(access(path.join(dir, 'covers', 'fixture.jpg')));
      assert.equal((await call({}, `/api/videos/${videoId}`)).status, 404);
    });
    await t.test('resetting own password returns sign-out flag and ends admin session', async () => {
      assert.equal((await call(admin, '/api/admin/users/1/password', 'POST', { password: 'replacement-admin-password' })).data.signedOut, true);
      assert.equal((await call(admin, '/api/admin/overview')).status, 401);
      assert.equal((await call(admin, '/api/auth/login', 'POST', { username: 'admin', password: 'replacement-admin-password' })).status, 200);
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
    assert.equal(path.dirname(dir), path.resolve(tmpdir())); assert.ok(path.basename(dir).startsWith('chengge-admin-test-'));
    await rm(dir, { recursive: true, force: true });
  }
});
