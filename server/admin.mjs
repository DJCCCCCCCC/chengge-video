import { Router } from 'express';
import { stat, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hashPassword, safeUser } from './auth.mjs';

export function createAdminRouter({ db, config, HttpError, text, idOf, cardSelect, serialize }) {
  const router = Router();
  router.use((req, res, next) => {
    if (!req.user) return next(HttpError(401, '请先登录管理员账号'));
    if (req.user.role !== 'admin') return next(HttpError(403, '此页面仅管理员可访问'));
    next();
  });
  const pagination = req => ({
    page: Math.max(1, Math.min(10000, Number.parseInt(req.query.page) || 1)),
    limit: Math.max(1, Math.min(50, Number.parseInt(req.query.limit) || 20)),
  });
  const keyword = req => `%${String(req.query.q || '').slice(0, 100).replace(/[!%_]/g, '!$&')}%`;
  function list(res, req, from, where, params, select, order) {
    const { page: requestedPage, limit } = pagination(req);
    const total = db.prepare(`SELECT COUNT(*) AS n ${from} ${where}`).get(...params).n;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)));
    const items = db.prepare(`${select} ${from} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ items, total, page, limit, hasMore: page * limit < total });
  }
  const userOf = value => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(idOf(value));
    if (!user) throw HttpError(404, '用户不存在');
    return user;
  };
  const roleOf = value => {
    if (!['admin', 'user'].includes(value)) throw HttpError(400, '角色必须为 admin 或 user');
    return value;
  };
  const countTable = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  function audited(req, action, type, id, summary, mutate) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = mutate();
      db.prepare('INSERT INTO admin_audit(actor_id,actor_username,action,target_type,target_id,summary) VALUES (?,?,?,?,?,?)')
        .run(req.user.id, req.user.username, action, type, String(typeof id === 'function' ? id(result) : id), summary);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const categoryOf = id => {
    const category = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
    if (!category) throw HttpError(404, '分区不存在');
    return category;
  };
  const categoryFields = body => {
    const name = text(body.name, 32, '分区名称'), sortOrder = body.sortOrder;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw HttpError(400, '排序值应为 0–9999 的整数');
    return { name, sortOrder };
  };

  router.get('/overview', async (req, res) => {
    const totals = db.prepare('SELECT COUNT(*) AS videos,COALESCE(SUM(size_bytes),0) AS mediaBytes,COALESCE(SUM(views),0) AS views FROM videos').get();
    const [disk, database, wal] = await Promise.all([
      statfs(config.dataDir),
      stat(path.join(config.dataDir, 'yingyu.sqlite')),
      stat(path.join(config.dataDir, 'yingyu.sqlite-wal')).catch(() => ({ size: 0 })),
    ]);
    res.json({
      totals: { ...totals, users: countTable('users'), comments: countTable('comments'), danmaku: countTable('danmaku'), likes: countTable('video_likes') },
      videoStatuses: Object.fromEntries(['ready', 'processing', 'failed'].map(status => [status, db.prepare('SELECT COUNT(*) AS n FROM videos WHERE status=?').get(status).n])),
      categories: db.prepare('SELECT c.id,c.name,COUNT(v.id) AS videos,COALESCE(SUM(v.views),0) AS views FROM categories c LEFT JOIN videos v ON v.category_id=c.id GROUP BY c.id ORDER BY c.sort_order,c.id').all(),
      recentVideos: db.prepare(`${cardSelect} ORDER BY v.id DESC LIMIT 5`).all().map(row => ({ ...serialize(row), status: row.status })),
      system: {
        nodeVersion: process.version, platform: process.platform, architecture: process.arch,
        uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss,
        diskTotalBytes: disk.blocks * disk.bsize, diskFreeBytes: disk.bavail * disk.bsize,
        databaseBytes: database.size + wal.size, maxUploadMb: config.maxUploadMb,
        allowRegistration: config.allowRegistration, database: 'SQLite / WAL', uploadConcurrency: 2,
      },
    });
  });
  router.get('/videos', (req, res) => {
    const params = [keyword(req), keyword(req)], conditions = ["(v.title LIKE ? ESCAPE '!' OR u.username LIKE ? ESCAPE '!')"];
    if (req.query.category) { conditions.push('v.category_id=?'); params.push(String(req.query.category)); }
    if (req.query.status) {
      if (!['ready', 'processing', 'failed'].includes(req.query.status)) throw HttpError(400, '无效的视频状态');
      conditions.push('v.status=?'); params.push(req.query.status);
    }
    const where = `WHERE ${conditions.join(' AND ')}`, { page: requestedPage, limit } = pagination(req);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM videos v JOIN users u ON v.owner_id=u.id ${where}`).get(...params).n;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)));
    const items = db.prepare(`${cardSelect} ${where} ORDER BY v.id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(row => ({ ...serialize(row), status: row.status }));
    res.json({ items, total, page, limit, hasMore: page * limit < total });
  });
  router.patch('/videos/:id', (req, res) => {
    const videoId = idOf(req.params.id);
    if (!db.prepare('SELECT id FROM videos WHERE id=?').get(videoId)) throw HttpError(404, '视频不存在');
    const title = text(req.body.title, 160, '标题'), description = text(req.body.description ?? '', 4000, '简介', 0);
    const category = text(req.body.categoryId, 32, '分类');
    if (!db.prepare('SELECT id FROM categories WHERE id=?').get(category)) throw HttpError(400, '分类不存在');
    audited(req, 'update', 'video', videoId, `编辑视频：${title}`, () =>
      db.prepare('UPDATE videos SET title=?,description=?,category_id=? WHERE id=?').run(title, description, category, videoId));
    res.json(serialize(db.prepare(`${cardSelect} WHERE v.id=?`).get(videoId)));
  });
  router.delete('/videos/:id', async (req, res) => {
    const video = db.prepare('SELECT * FROM videos WHERE id=?').get(idOf(req.params.id));
    if (!video) throw HttpError(404, '视频不存在');
    audited(req, 'delete', 'video', video.id, `删除视频：${video.title}`, () => db.prepare('DELETE FROM videos WHERE id=?').run(video.id));
    const files = [['videos', video.filename], ['covers', video.cover_filename]].filter(([, name]) => name);
    await Promise.all(files.map(([folder, name]) => unlink(path.join(config.dataDir, folder, name)).catch(error => {
      if (error.code !== 'ENOENT') console.error(`Media cleanup failed: ${error.code}`);
    })));
    res.json({ ok: true });
  });
  router.get('/users', (req, res) => {
    const params = [keyword(req), keyword(req)], conditions = ["(u.username LIKE ? ESCAPE '!' OR u.display_name LIKE ? ESCAPE '!')"];
    if (req.query.role) { conditions.push('u.role=?'); params.push(roleOf(req.query.role)); }
    list(res, req, 'FROM users u', `WHERE ${conditions.join(' AND ')}`, params,
      `SELECT u.id,u.username,u.display_name AS displayName,u.role,u.created_at AS createdAt,
       (SELECT COUNT(*) FROM videos WHERE owner_id=u.id) AS videoCount,
       (SELECT COUNT(*) FROM sessions WHERE user_id=u.id AND expires_at>${Date.now()}) AS sessions`,
      'u.id DESC');
  });
  router.post('/users', (req, res) => {
    const username = text(req.body.username, 32, '用户名', 3);
    if (!/^[a-zA-Z0-9_]+$/.test(username)) throw HttpError(400, '用户名仅支持字母、数字和下划线');
    const displayName = text(req.body.displayName || username, 32, '昵称'), password = text(req.body.password, 128, '密码', 12);
    const role = roleOf(req.body.role || 'user');
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw HttpError(409, '用户名已存在');
    const result = audited(req, 'create', 'user', result => result.lastInsertRowid, `创建账号：@${username}（${role === 'admin' ? '管理员' : '普通用户'}）`, () =>
      db.prepare('INSERT INTO users(username,display_name,password_hash,role) VALUES (?,?,?,?)').run(username, displayName, hashPassword(password), role));
    res.status(201).json(safeUser(userOf(Number(result.lastInsertRowid))));
  });
  router.patch('/users/:id', (req, res) => {
    const user = userOf(req.params.id);
    if (req.body.role === undefined && req.body.displayName === undefined) throw HttpError(400, '请提供昵称或角色');
    const role = req.body.role === undefined ? user.role : roleOf(req.body.role);
    const displayName = req.body.displayName === undefined ? user.display_name : text(req.body.displayName, 32, '昵称');
    if (user.role === 'admin' && role !== 'admin') {
      if (user.id === req.user.id) throw HttpError(409, '不能取消自己的管理员权限');
      if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n <= 1) throw HttpError(409, '至少需要保留一名管理员');
    }
    audited(req, 'update', 'user', user.id, `编辑账号：@${user.username}，昵称：${displayName}，角色：${user.role} → ${role}`, () =>
      db.prepare('UPDATE users SET display_name=?,role=? WHERE id=?').run(displayName, role, user.id));
    res.json(safeUser(userOf(user.id)));
  });
  router.post('/users/:id/password', (req, res) => {
    const user = userOf(req.params.id), password = text(req.body.password, 128, '密码', 12);
    audited(req, 'reset_password', 'user', user.id, `重置密码并撤销会话：@${user.username}`, () => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    });
    res.json({ ok: true, signedOut: user.id === req.user.id });
  });
  router.delete('/users/:id/sessions', (req, res) => {
    const user = userOf(req.params.id);
    const result = audited(req, 'revoke_sessions', 'user', user.id, `撤销登录会话：@${user.username}`, () => db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id));
    res.json({ ok: true, revoked: Number(result.changes), signedOut: user.id === req.user.id });
  });
  for (const kind of ['comments', 'danmaku']) {
    router.get(`/${kind}`, (req, res) => {
      const params = [keyword(req), keyword(req), keyword(req)];
      const conditions = ["(m.body LIKE ? ESCAPE '!' OR v.title LIKE ? ESCAPE '!' OR u.username LIKE ? ESCAPE '!')"];
      if (req.query.videoId) { conditions.push('m.video_id=?'); params.push(idOf(req.query.videoId)); }
      list(res, req, `FROM ${kind} m JOIN users u ON m.user_id=u.id JOIN videos v ON m.video_id=v.id`,
        `WHERE ${conditions.join(' AND ')}`, params,
        `SELECT m.id,m.body,m.video_id AS videoId,v.title AS videoTitle,u.display_name AS author,u.username,m.created_at AS createdAt${kind === 'danmaku' ? ',m.time,m.color' : ''}`,
        'm.id DESC');
    });
    router.delete(`/${kind}/:id`, (req, res) => {
      const id = idOf(req.params.id), message = db.prepare(`SELECT id,video_id FROM ${kind} WHERE id=?`).get(id);
      if (!message) throw HttpError(404, kind === 'comments' ? '评论不存在' : '弹幕不存在');
      audited(req, 'delete', kind === 'comments' ? 'comment' : 'danmaku', id, `删除${kind === 'comments' ? '评论' : '弹幕'} #${id}，视频 #${message.video_id}`, () => db.prepare(`DELETE FROM ${kind} WHERE id=?`).run(id));
      res.json({ ok: true });
    });
  }
  router.get('/categories', (req, res) => {
    list(res, req, 'FROM categories c', "WHERE (c.name LIKE ? ESCAPE '!' OR c.id LIKE ? ESCAPE '!')", [keyword(req), keyword(req)],
      `SELECT c.id,c.name,c.sort_order AS sortOrder,(SELECT COUNT(*) FROM videos WHERE category_id=c.id) AS videos,
       (SELECT COALESCE(SUM(views),0) FROM videos WHERE category_id=c.id) AS views`, 'c.sort_order,c.id');
  });
  router.post('/categories', (req, res) => {
    const id = text(req.body.id, 32, '分区标识'), { name, sortOrder } = categoryFields(req.body);
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw HttpError(400, '分区标识需以小写字母开头，仅支持小写字母、数字、下划线和短横线');
    if (db.prepare('SELECT 1 FROM categories WHERE id=?').get(id)) throw HttpError(409, '分区标识已存在');
    audited(req, 'create', 'category', id, `创建分区：${name}`, () => db.prepare('INSERT INTO categories(id,name,sort_order) VALUES (?,?,?)').run(id, name, sortOrder));
    res.status(201).json({ id, name, sortOrder });
  });
  router.patch('/categories/:id', (req, res) => {
    const category = categoryOf(req.params.id), { name, sortOrder } = categoryFields(req.body);
    audited(req, 'update', 'category', category.id, `编辑分区：${category.name} → ${name}，排序：${sortOrder}`, () =>
      db.prepare('UPDATE categories SET name=?,sort_order=? WHERE id=?').run(name, sortOrder, category.id));
    res.json({ id: category.id, name, sortOrder });
  });
  router.delete('/categories/:id', (req, res) => {
    const category = categoryOf(req.params.id);
    if (countTable('categories') <= 1) throw HttpError(409, '至少需要保留一个分区');
    if (db.prepare('SELECT 1 FROM videos WHERE category_id=?').get(category.id)) throw HttpError(409, '该分区仍有视频，请先调整视频所属分区');
    audited(req, 'delete', 'category', category.id, `删除分区：${category.name}`, () => db.prepare('DELETE FROM categories WHERE id=?').run(category.id));
    res.json({ ok: true });
  });
  router.get('/audit', (req, res) => {
    const params = [keyword(req), keyword(req), keyword(req)], conditions = ["(a.actor_username LIKE ? ESCAPE '!' OR a.summary LIKE ? ESCAPE '!' OR a.target_id LIKE ? ESCAPE '!')"];
    if (req.query.type) {
      if (!['video', 'user', 'category', 'comment', 'danmaku'].includes(req.query.type)) throw HttpError(400, '无效的操作对象');
      conditions.push('a.target_type=?'); params.push(req.query.type);
    }
    list(res, req, 'FROM admin_audit a', `WHERE ${conditions.join(' AND ')}`, params,
      'SELECT a.id,a.actor_username AS actorUsername,a.action,a.target_type AS targetType,a.target_id AS targetId,a.summary,a.created_at AS createdAt', 'a.id DESC');
  });
  return router;
}
