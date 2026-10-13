import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { unlink, rename, statfs } from 'node:fs/promises';
import { openDatabase } from './db.mjs';
import { hashPassword, verifyPassword, digest, randomToken, cookieValue, safeUser } from './auth.mjs';
import { probeMedia, makeCover } from './media.mjs';
import { createAdminRouter } from './admin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const HttpError = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max, label, min = 1) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw HttpError(400, `${label}长度应为 ${min}–${max} 个字符`);
  return value.trim();
};
const idOf = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw HttpError(400, '无效的 ID');
  return number;
};
const requireAuth = (req, res, next) => req.user ? next() : next(HttpError(401, '请先登录'));
const cleanFiles = files => Promise.all(files.filter(Boolean).map(file => unlink(file).catch(() => {})));

export function createApp(options = {}) {
  const config = {
    dataDir: path.resolve(options.dataDir || process.env.DATA_DIR || './data'),
    adminUsername: options.adminUsername || process.env.ADMIN_USERNAME || 'admin',
    adminPassword: options.adminPassword ?? process.env.ADMIN_PASSWORD,
    allowRegistration: options.allowRegistration ?? process.env.ALLOW_REGISTRATION !== 'false',
    secureCookie: options.secureCookie ?? process.env.COOKIE_SECURE === 'true',
    maxUploadMb: Number(options.maxUploadMb || process.env.MAX_UPLOAD_MB || 2048),
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  };
  if (!Number.isFinite(config.maxUploadMb) || config.maxUploadMb < 1) throw new Error('MAX_UPLOAD_MB must be positive');
  const db = openDatabase(config.dataDir);
  if (!db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    if (!config.adminPassword || config.adminPassword.length < 12) { db.close(); throw new Error('ADMIN_PASSWORD must contain at least 12 characters on first launch. Run npm run init.'); }
    db.prepare('INSERT INTO users(username,display_name,password_hash,role) VALUES (?,?,?,?)').run(config.adminUsername, '空间管理员', hashPassword(config.adminPassword), 'admin');
  }
  const app = express();
  app.disable('x-powered-by');
  const trustProxy = Number(process.env.TRUST_PROXY || 0);
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' }, contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'blob:', 'data:'], 'media-src': ["'self'", 'blob:'], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'connect-src': ["'self'"], 'upgrade-insecure-requests': null } } }));
  app.use(express.json({ limit: '24kb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    const token = cookieValue(req.headers.cookie, 'yingyu_session');
    const session = token && /^[a-f0-9]{64}$/.test(token) ? db.prepare('SELECT s.*,u.username,u.display_name,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE token_hash=? AND expires_at>?').get(digest(token), Date.now()) : null;
    if (session) { req.user = { ...session, id: session.user_id }; req.csrfToken = session.csrf_token; req.sessionHash = session.token_hash; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        try {
          const url = new URL(origin);
          if (url.host !== req.get('host') || !['http:', 'https:'].includes(url.protocol)) return next(HttpError(403, '请求来源不匹配'));
        } catch { return next(HttpError(403, '请求来源无效')); }
      }
      if (req.get('sec-fetch-site') === 'cross-site') return next(HttpError(403, '不允许跨站请求'));
      if (session && req.get('x-csrf-token') !== req.csrfToken) return next(HttpError(403, '安全令牌已过期，请刷新页面'));
    }
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '尝试次数过多，请稍后再试' } });
  const writeLimit = rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '操作过于频繁，请稍后再试' } });
  app.use('/api', (req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : writeLimit(req, res, next));

  function login(req, res, user) {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash);
    const token = randomToken(), csrf = randomToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(digest(token), user.id, csrf, Date.now() + 7 * 86400000);
    res.cookie('yingyu_session', token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookie, path: '/', maxAge: 7 * 86400000 });
    res.json({ user: safeUser(user), csrfToken: csrf });
  }
  app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', database: db.prepare('SELECT 1 AS ok').get().ok === 1 }));
  app.get('/api/config', (req, res) => res.json({ name: '城哥的小视频站', allowRegistration: config.allowRegistration, maxUploadMb: config.maxUploadMb }));
  app.get('/api/auth/me', (req, res) => res.json({ user: safeUser(req.user), csrfToken: req.csrfToken || null }));
  app.post('/api/auth/login', authLimit, (req, res) => {
    const username = text(req.body.username, 32, '用户名');
    const password = text(req.body.password, 128, '密码');
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    // Equal-cost derivation also for unknown users reduces username timing leakage.
    const valid = verifyPassword(password, user?.password_hash || `00000000000000000000000000000000:${'00'.repeat(64)}`);
    if (!user || !valid) throw HttpError(401, '用户名或密码错误');
    login(req, res, user);
  });
  app.post('/api/auth/register', authLimit, (req, res) => {
    if (!config.allowRegistration) throw HttpError(403, '当前空间已关闭注册');
    const username = text(req.body.username, 32, '用户名', 3);
    if (!/^[a-zA-Z0-9_]+$/.test(username)) throw HttpError(400, '用户名仅支持字母、数字和下划线');
    const displayName = text(req.body.displayName || username, 32, '昵称');
    const password = text(req.body.password, 128, '密码', 12);
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw HttpError(409, '用户名已存在');
    const result = db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES (?,?,?)').run(username, displayName, hashPassword(password));
    login(req, res, db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid));
  });
  app.post('/api/auth/logout', requireAuth, (req, res) => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash); res.clearCookie('yingyu_session', { path: '/', sameSite: 'lax', secure: config.secureCookie }); res.json({ ok: true }); });
  app.get('/api/categories', (req, res) => res.json({ items: db.prepare('SELECT * FROM categories ORDER BY sort_order,id').all() }));
  const cardSelect = `SELECT v.*,u.display_name AS author,u.username AS author_username,c.name AS category,
    (SELECT COUNT(*) FROM video_likes WHERE video_id=v.id) AS likes,
    (SELECT COUNT(*) FROM comments WHERE video_id=v.id) AS comment_count FROM videos v JOIN users u ON v.owner_id=u.id JOIN categories c ON c.id=v.category_id`;
  const serialize = row => ({ id: row.id, title: row.title, description: row.description, categoryId: row.category_id, category: row.category, author: row.author, authorUsername: row.author_username, ownerId: row.owner_id, duration: row.duration, width: row.width, height: row.height, sizeBytes: row.size_bytes, views: row.views, likes: row.likes, commentCount: row.comment_count, isDemo: !!row.is_demo, createdAt: row.created_at, cover: row.cover_filename ? `/media/covers/${row.cover_filename}` : null, mediaUrl: `/media/videos/${row.filename}`, position: row.position || 0 });
  function getVideo(value) {
    const row = db.prepare(`${cardSelect} WHERE v.id=? AND v.status='ready'`).get(idOf(value));
    if (!row) throw HttpError(404, '视频不存在或尚未处理完成');
    return row;
  }
  app.get('/api/videos', (req, res) => {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page) || 1));
    const limit = Math.max(1, Math.min(48, Number.parseInt(req.query.limit) || 12));
    const where = ["v.status='ready'"], params = [];
    if (req.query.category) { where.push('v.category_id=?'); params.push(String(req.query.category)); }
    if (req.query.q) { const q = String(req.query.q).slice(0, 100).replace(/[!%_]/g, '!$&'); where.push("(v.title LIKE ? ESCAPE '!' OR v.description LIKE ? ESCAPE '!')"); params.push(`%${q}%`, `%${q}%`); }
    const order = req.query.sort === 'popular' ? 'v.views DESC,v.id DESC' : 'v.created_at DESC,v.id DESC';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM videos v WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db.prepare(`${cardSelect} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ items: rows.map(serialize), total, page, limit, hasMore: page * limit < total });
  });
  app.get('/api/videos/:id', (req, res) => {
    const row = getVideo(req.params.id), user = req.user?.id;
    const result = serialize(row);
    result.liked = user ? !!db.prepare('SELECT 1 FROM video_likes WHERE user_id=? AND video_id=?').get(user, row.id) : false;
    result.favorite = user ? !!db.prepare("SELECT 1 FROM library WHERE user_id=? AND video_id=? AND kind='favorite'").get(user, row.id) : false;
    result.later = user ? !!db.prepare("SELECT 1 FROM library WHERE user_id=? AND video_id=? AND kind='later'").get(user, row.id) : false;
    result.position = user ? db.prepare('SELECT position FROM history WHERE user_id=? AND video_id=?').get(user, row.id)?.position || 0 : 0;
    res.json(result);
  });
  const viewLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '播放计数过于频繁' } });
  app.post('/api/videos/:id/view', viewLimit, (req, res) => { const video = getVideo(req.params.id); db.prepare('UPDATE videos SET views=views+1 WHERE id=?').run(video.id); res.json({ views: video.views + 1 }); });
  app.put('/api/videos/:id/like', requireAuth, (req, res) => {
    const video = getVideo(req.params.id);
    if (typeof req.body.active !== 'boolean') throw HttpError(400, 'active 必须为布尔值');
    if (req.body.active) db.prepare('INSERT OR IGNORE INTO video_likes(user_id,video_id) VALUES (?,?)').run(req.user.id, video.id);
    else db.prepare('DELETE FROM video_likes WHERE user_id=? AND video_id=?').run(req.user.id, video.id);
    res.json({ liked: req.body.active, likes: db.prepare('SELECT COUNT(*) AS n FROM video_likes WHERE video_id=?').get(video.id).n });
  });
  app.put('/api/videos/:id/library', requireAuth, (req, res) => {
    const video = getVideo(req.params.id), { kind, active } = req.body;
    if (!['favorite', 'later'].includes(kind) || typeof active !== 'boolean') throw HttpError(400, '无效的收藏类型或状态');
    if (active) db.prepare('INSERT OR IGNORE INTO library(user_id,video_id,kind) VALUES (?,?,?)').run(req.user.id, video.id, kind);
    else db.prepare('DELETE FROM library WHERE user_id=? AND video_id=? AND kind=?').run(req.user.id, video.id, kind);
    res.json({ kind, active });
  });
  app.put('/api/videos/:id/history', requireAuth, (req, res) => {
    const video = getVideo(req.params.id), position = Number(req.body.position);
    if (!Number.isFinite(position) || position < 0) throw HttpError(400, '无效的播放位置');
    db.prepare('INSERT INTO history(user_id,video_id,position) VALUES (?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET position=excluded.position,updated_at=CURRENT_TIMESTAMP').run(req.user.id, video.id, Math.min(position, video.duration));
    res.json({ ok: true });
  });
  app.get('/api/me/library', requireAuth, (req, res) => {
    const kind = String(req.query.kind || 'favorite');
    const page = Math.max(1, Number.parseInt(req.query.page) || 1), limit = 24;
    let condition, parameters;
    if (kind === 'uploads') { condition = 'v.owner_id=?'; parameters = [req.user.id]; }
    else if (kind === 'history') { condition = 'v.id IN (SELECT video_id FROM history WHERE user_id=?)'; parameters = [req.user.id]; }
    else if (['favorite', 'later'].includes(kind)) { condition = 'v.id IN (SELECT video_id FROM library WHERE user_id=? AND kind=?)'; parameters = [req.user.id, kind]; }
    else throw HttpError(400, '无效的列表类型');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM videos v WHERE v.status='ready' AND ${condition}`).get(...parameters).n;
    const order = kind === 'history' ? `(SELECT updated_at FROM history WHERE user_id=${req.user.id} AND video_id=v.id) DESC,v.id DESC` : 'v.id DESC';
    const rows = db.prepare(`${cardSelect} WHERE v.status='ready' AND ${condition} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...parameters, limit, (page - 1) * limit);
    res.json({ items: rows.map(serialize), total, hasMore: page * limit < total, page });
  });
  app.delete('/api/me/history', requireAuth, (req, res) => { db.prepare('DELETE FROM history WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
  app.get('/api/videos/:id/comments', (req, res) => {
    const video = getVideo(req.params.id), page = Math.max(1, Number.parseInt(req.query.page) || 1);
    const total = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE video_id=?').get(video.id).n;
    const items = db.prepare('SELECT c.id,c.body,c.user_id AS userId,c.created_at AS createdAt,u.display_name AS author FROM comments c JOIN users u ON c.user_id=u.id WHERE video_id=? ORDER BY c.id DESC LIMIT 30 OFFSET ?').all(video.id, (page - 1) * 30);
    res.json({ items, total, hasMore: page * 30 < total });
  });
  app.post('/api/videos/:id/comments', requireAuth, (req, res) => {
    const video = getVideo(req.params.id), body = text(req.body.body, 1000, '评论');
    const inserted = db.prepare('INSERT INTO comments(video_id,user_id,body) VALUES (?,?,?)').run(video.id, req.user.id, body);
    res.status(201).json({ id: Number(inserted.lastInsertRowid), body, author: req.user.display_name, userId: req.user.id });
  });
  app.delete('/api/comments/:id', requireAuth, (req, res) => {
    const comment = db.prepare('SELECT * FROM comments WHERE id=?').get(idOf(req.params.id));
    if (!comment) throw HttpError(404, '评论不存在');
    if (req.user.id !== comment.user_id && req.user.role !== 'admin') throw HttpError(403, '无权删除此评论');
    db.prepare('DELETE FROM comments WHERE id=?').run(comment.id); res.json({ ok: true });
  });
  app.get('/api/videos/:id/danmaku', (req, res) => {
    const video = getVideo(req.params.id);
    res.json({ items: db.prepare('SELECT id,body,time,color FROM danmaku WHERE video_id=? ORDER BY time,id LIMIT 5000').all(video.id) });
  });
  app.post('/api/videos/:id/danmaku', requireAuth, (req, res) => {
    const video = getVideo(req.params.id), body = text(req.body.body, 80, '弹幕'), time = Number(req.body.time);
    const color = req.body.color || '#ffffff';
    if (!Number.isFinite(time) || time < 0 || time > video.duration || !/^#[a-fA-F0-9]{6}$/.test(color)) throw HttpError(400, '无效的弹幕时间或颜色');
    const result = db.prepare('INSERT INTO danmaku(video_id,user_id,body,time,color) VALUES (?,?,?,?,?)').run(video.id, req.user.id, body, time, color);
    res.status(201).json({ id: Number(result.lastInsertRowid), body, time, color });
  });
  let uploadsInProgress = 0;
  const uploader = multer({ dest: path.join(config.dataDir, 'tmp'), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 4, fieldSize: 8192 }, fileFilter: (req, file, cb) => {
    cb(['.mp4', '.webm'].includes(path.extname(file.originalname).toLowerCase()) ? null : HttpError(400, '仅支持 MP4 或 WebM 视频'), true);
  } }).single('video');
  app.post('/api/videos', requireAuth, async (req, res, next) => {
    if (uploadsInProgress >= 2) return next(HttpError(429, '正在处理其他视频，请稍后上传'));
    uploadsInProgress++;
    const release = () => { uploadsInProgress--; };
    try {
      const disk = await statfs(config.dataDir);
      if (disk.bavail * disk.bsize < (config.maxUploadMb + 512) * 1024 * 1024) throw HttpError(507, '可用磁盘空间不足');
      await new Promise((resolve, reject) => uploader(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw HttpError(400, '请选择视频文件');
      const title = text(req.body.title, 160, '标题');
      const description = text(req.body.description || '', 4000, '简介', 0);
      const category = text(req.body.categoryId, 32, '分类');
      if (!db.prepare('SELECT id FROM categories WHERE id=?').get(category)) throw HttpError(400, '分类不存在');
      let media;
      try { media = await probeMedia(req.file.path, config); }
      catch (error) { throw HttpError(422, error.message === 'UNSUPPORTED_CODEC' ? '视频编码不兼容，请先转换为 H.264 + AAC 的 MP4' : error.code === 'ENOENT' ? '服务端未安装 FFprobe' : '无法读取视频，请检查文件格式'); }
      const name = randomToken().slice(0, 32), filename = name + path.extname(req.file.originalname).toLowerCase(), cover = name + '.jpg';
      const videoPath = path.join(config.dataDir, 'videos', filename), coverPath = path.join(config.dataDir, 'covers', cover);
      try {
        await makeCover(req.file.path, coverPath, config);
        await rename(req.file.path, videoPath);
        const result = db.prepare('INSERT INTO videos(owner_id,category_id,title,description,filename,cover_filename,duration,size_bytes,width,height) VALUES (?,?,?,?,?,?,?,?,?,?)').run(req.user.id, category, title, description, filename, cover, media.duration, req.file.size, media.width, media.height);
        res.status(201).json(serialize(getVideo(Number(result.lastInsertRowid))));
      } catch (error) { await cleanFiles([videoPath, coverPath]); throw error; }
    } catch (error) { await cleanFiles([req.file?.path]); next(error); }
    finally { release(); }
  });
  app.delete('/api/videos/:id', requireAuth, async (req, res) => {
    const video = getVideo(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== video.owner_id) throw HttpError(403, '无权删除此视频');
    db.prepare('DELETE FROM videos WHERE id=?').run(video.id);
    await cleanFiles([path.join(config.dataDir, 'videos', video.filename), video.cover_filename && path.join(config.dataDir, 'covers', video.cover_filename)]);
    res.json({ ok: true });
  });
  app.get('/api/me/stats', requireAuth, (req, res) => {
    const where = req.user.role === 'admin' ? '' : 'WHERE owner_id=?';
    const row = db.prepare(`SELECT COUNT(*) AS videos,COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(SUM(views),0) AS views FROM videos ${where}`).get(...(where ? [req.user.id] : []));
    res.json({ ...row, scope: req.user.role === 'admin' ? 'space' : 'user' });
  });
  app.use('/api/admin', createAdminRouter({ db, config, HttpError, text, idOf, cardSelect, serialize }));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.get('/media/:kind/:filename', (req, res, next) => {
    const { kind, filename } = req.params;
    if (!['covers', 'videos'].includes(kind) || !/^[a-zA-Z0-9_-]+\.(mp4|webm|jpg)$/.test(filename)) return next(HttpError(404, '文件不存在'));
    const column = kind === 'covers' ? 'cover_filename' : 'filename';
    if (!db.prepare(`SELECT 1 FROM videos WHERE ${column}=? AND status='ready'`).get(filename)) return next(HttpError(404, '文件不存在'));
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(filename, { root: path.join(config.dataDir, kind), dotfiles: 'deny' }, error => error && !res.headersSent && next(error));
  });
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get('/{*path}', (req, res) => existsSync(path.join(dist, 'index.html')) ? res.sendFile(path.join(dist, 'index.html')) : res.status(503).send('Build the frontend first: npm run build'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status >= 500) console.error(error.message);
    res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? `文件不能超过 ${config.maxUploadMb} MB` : status >= 500 ? '服务暂时不可用，请检查服务端日志' : error.message });
  });
  return { app, db, config };
}
