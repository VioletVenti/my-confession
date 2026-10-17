/**
 * My Confession 后端 —— 零依赖单文件：node server.js
 * 存储：SQLite（Node 24 内置 node:sqlite，不需要 npm install）
 *
 * 权限模型
 *   · 静态文件（正文 / 岁月史书 / 鸣谢栏 …）永远只读，任何人都改不到
 *   · 访客可写：人物册「自由添加 + 自由删减」、留言板「自由发言」
 *   · 删除是软删除（status='deleted'），数据不会真没，管理口令可恢复
 *   · 管理口令：config.json 的 adminToken —— 可恢复/彻底清除/导出静态快照
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const CATEGORIES = ['正常人', '神人', '全唐', '半唐', '**'];

// ---------------------------------------------------------------- 配置
function loadConfig() {
  let cfg = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { cfg = {}; }
  }
  let dirty = false;
  if (!cfg.adminToken) { cfg.adminToken = crypto.randomBytes(18).toString('hex'); dirty = true; }
  if (typeof cfg.messagesModerated !== 'boolean') { cfg.messagesModerated = false; dirty = true; }
  if (dirty) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
const CONFIG = loadConfig();

// ---------------------------------------------------------------- 数据库
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS people (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    note        TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'published',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER,
    from_hash   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_people ON people(status, category);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL DEFAULT '匿名',
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'published',
    created_at INTEGER NOT NULL,
    from_hash  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages ON messages(status, created_at DESC);
`);

const q = {
  listPublished: db.prepare(
    `SELECT id,name,category,note,created_at FROM people
     WHERE status='published' ORDER BY category, id`),
  insert: db.prepare(
    `INSERT INTO people (name,category,note,status,created_at,from_hash)
     VALUES (?,?,?,'published',?,?)`),
  softDelete: db.prepare(`UPDATE people SET status='deleted', updated_at=? WHERE id=? AND status='published'`),
  restore: db.prepare(`UPDATE people SET status='published', updated_at=? WHERE id=?`),
  purge: db.prepare(`DELETE FROM people WHERE id=?`),
  allPeople: db.prepare(`SELECT id,name,category,note,status,created_at FROM people ORDER BY id DESC`),

  listMsgs: db.prepare(
    `SELECT id,name,text,created_at FROM messages
     WHERE status='published' ORDER BY created_at DESC LIMIT 200`),
  insertMsg: db.prepare(
    `INSERT INTO messages (name,text,status,created_at,from_hash) VALUES (?,?,?,?,?)`),
  delMsg: db.prepare(`UPDATE messages SET status='deleted' WHERE id=?`),
  purgeMsg: db.prepare(`DELETE FROM messages WHERE id=?`),
  allMsgs: db.prepare(`SELECT id,name,text,status,created_at FROM messages ORDER BY id DESC LIMIT 500`),

  countPeople: db.prepare(`SELECT COUNT(*) c FROM people WHERE status='published'`),
  countMsgs: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status='published'`),
};

// ---------------------------------------------------------------- 工具
function clientHash(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = xf ? String(xf).split(',')[0].trim() : ((req.socket && req.socket.remoteAddress) || '');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);   // 不存原 IP
}

const buckets = new Map();
function rateLimit(key, minGapMs = 8000, hourlyMax = 120) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < 3600e3);
  if (arr.length && now - arr[arr.length - 1] < minGapMs) return '操作太频繁，请稍等几秒';
  if (arr.length >= hourlyMax) return '这一小时操作太多了，请稍后再试';
  arr.push(now);
  buckets.set(key, arr);
  return null;
}

function send(res, code, body) {
  const isObj = body !== null && typeof body === 'object';
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(isObj ? JSON.stringify(body) : String(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('内容太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

const clip = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);

function isAdmin(req) {
  const t = req.headers['x-admin-token'];
  if (!t) return false;
  const a = Buffer.from(String(t)), b = Buffer.from(String(CONFIG.adminToken));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};
const DENY = [/^\/data\//i, /^\/config\.json$/i, /^\/server\.js$/i, /^\/\./];

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (DENY.some((re) => re.test(rel))) return send(res, 404, 'Not Found');
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- API
async function api(req, res, pathname) {
  const m = req.method;
  const h = clientHash(req);

  if (pathname === '/api/people' && m === 'GET') {
    return send(res, 200, { ok: true, items: q.listPublished.all() });
  }

  if (pathname === '/api/people' && m === 'POST') {
    const limited = rateLimit('p' + h);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const b = await readBody(req);
    const name = clip(b.name, 40);
    const note = clip(b.note, 1200);
    const category = clip(b.category, 10);
    if (!name) return send(res, 400, { ok: false, error: '名字不能空' });
    if (!note) return send(res, 400, { ok: false, error: '内容不能空' });
    if (!CATEGORIES.includes(category)) return send(res, 400, { ok: false, error: '分类不合法' });
    const now = Date.now();
    const r = q.insert.run(name, category, note, now, h);
    return send(res, 200, { ok: true, item: { id: Number(r.lastInsertRowid), name, category, note, created_at: now } });
  }

  const mm = pathname.match(/^\/api\/people\/(\d+)$/);
  if (mm && m === 'DELETE') {
    const limited = rateLimit('d' + h, 3000, 200);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const r = q.softDelete.run(Date.now(), Number(mm[1]));
    if (!r.changes) return send(res, 404, { ok: false, error: '没有这条（可能已被删）' });
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/messages' && m === 'GET') {
    return send(res, 200, { ok: true, items: q.listMsgs.all() });
  }

  if (pathname === '/api/messages' && m === 'POST') {
    const limited = rateLimit('m' + h);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const b = await readBody(req);
    const name = clip(b.name, 20) || '匿名';
    const text = clip(b.text, 500);
    if (!text) return send(res, 400, { ok: false, error: '内容不能空' });
    const status = CONFIG.messagesModerated ? 'pending' : 'published';
    const now = Date.now();
    const r = q.insertMsg.run(name, text, status, now, h);
    return send(res, 200, { ok: true, item: { id: Number(r.lastInsertRowid), name, text, created_at: now } });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { ok: false, error: '管理口令不正确' });

    if (pathname === '/api/admin/all' && m === 'GET') {
      return send(res, 200, {
        ok: true,
        people: q.allPeople.all(),
        messages: q.allMsgs.all(),
        stats: { people: q.countPeople.get().c, messages: q.countMsgs.get().c },
      });
    }
    if (pathname === '/api/admin/restore' && m === 'POST') {
      const { id } = await readBody(req);
      q.restore.run(Date.now(), Number(id));
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/purge' && m === 'POST') {
      const { id, type } = await readBody(req);
      if (type === 'message') q.purgeMsg.run(Number(id)); else q.purge.run(Number(id));
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/message-delete' && m === 'POST') {
      const { id } = await readBody(req);
      q.delMsg.run(Number(id));
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/snapshot' && m === 'POST') {
      const out = { exportedAt: new Date().toISOString(), people: q.listPublished.all() };
      fs.writeFileSync(path.join(DATA_DIR, 'people.json'), JSON.stringify(out, null, 2), 'utf8');
      return send(res, 200, { ok: true, path: 'data/people.json', count: out.people.length });
    }
    return send(res, 404, { ok: false, error: 'no such admin route' });
  }

  return send(res, 404, { ok: false, error: 'no such api' });
}

// ---------------------------------------------------------------- 启动
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/api/')) {
    api(req, res, pathname).catch((e) => {
      console.error('[api]', e && e.message);
      if (!res.headersSent) send(res, 500, { ok: false, error: '服务器内部错误' });
    });
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('');
  console.log('  My Confession 已启动（SQLite）');
  console.log('  站点   : http://' + shown + ':' + PORT + '/');
  console.log('  审核台 : http://' + shown + ':' + PORT + '/admin.html');
  console.log('  口令   : ' + CONFIG.adminToken);
  console.log('  数据库 : data/app.db');
  console.log('');
});
