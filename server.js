/**
 * My Confession 后端 —— 零依赖单文件：node server.js
 * 存储：SQLite（Node 24 内置 node:sqlite，不需要 npm install）
 *
 * 权限模型
 *   · 静态文件（正文 / 岁月史书 / 鸣谢栏 …）永远只读，任何人都改不到
 *   · 访客可写：人物册、留言板
 *   · 两个独立的审核开关（config.json）：
 *       peopleModerated  → 人物册的任何操作（新增 / 删除）都变成「请求」，进后台等你审批
 *       messagesModerated → 留言需审核后才上架
 *   · 删除一律软删除（status 变化），数据不会真没，管理口令可恢复
 *   · 管理口令：config.json 的 adminToken
 *
 * 人物状态机
 *   published  在线
 *   pending    访客新增，待审批
 *   hidden     管理员下架（可恢复）
 *   rejected   审批驳回
 *   deleted    已删除（可恢复）
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
  if (typeof cfg.peopleModerated !== 'boolean') { cfg.peopleModerated = false; dirty = true; }
  if (dirty) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}
const CONFIG = loadConfig();

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8');
}

function publicSettings() {
  return {
    peopleModerated: CONFIG.peopleModerated,
    messagesModerated: CONFIG.messagesModerated,
  };
}

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

  -- 删除申请：审核开启时，访客删词条不再直接生效，而是写一条请求等审批
  CREATE TABLE IF NOT EXISTS people_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL DEFAULT 'delete',
    target_id   INTEGER NOT NULL,
    reason      TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER,
    from_hash   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests ON people_requests(status, created_at DESC);
`);

const q = {
  listPublished: db.prepare(
    `SELECT id,name,category,note,created_at FROM people
     WHERE status='published' ORDER BY category, id`),
  insert: db.prepare(
    `INSERT INTO people (name,category,note,status,created_at,from_hash)
     VALUES (?,?,?,?,?,?)`),
  softDelete: db.prepare(`UPDATE people SET status='deleted', updated_at=? WHERE id=? AND status='published'`),
  setStatus: db.prepare(`UPDATE people SET status=?, updated_at=? WHERE id=?`),
  restore: db.prepare(`UPDATE people SET status='published', updated_at=? WHERE id=?`),
  purge: db.prepare(`DELETE FROM people WHERE id=?`),
  getPerson: db.prepare(`SELECT id,name,category,note,status,created_at FROM people WHERE id=?`),
  allPeople: db.prepare(`SELECT id,name,category,note,status,created_at FROM people ORDER BY id DESC`),
  pendingPeople: db.prepare(
    `SELECT id,name,category,note,status,created_at FROM people
     WHERE status='pending' ORDER BY id ASC`),

  listMsgs: db.prepare(
    `SELECT id,name,text,created_at FROM messages
     WHERE status='published' ORDER BY created_at DESC LIMIT 200`),
  insertMsg: db.prepare(
    `INSERT INTO messages (name,text,status,created_at,from_hash) VALUES (?,?,?,?,?)`),
  delMsg: db.prepare(`UPDATE messages SET status='deleted' WHERE id=?`),
  purgeMsg: db.prepare(`DELETE FROM messages WHERE id=?`),
  allMsgs: db.prepare(`SELECT id,name,text,status,created_at FROM messages ORDER BY id DESC LIMIT 500`),

  addRequest: db.prepare(
    `INSERT INTO people_requests (kind,target_id,reason,status,created_at,from_hash)
     VALUES (?,?,?,'pending',?,?)`),
  // 同一个人同一条重复申请只留一条
  findRequest: db.prepare(
    `SELECT id FROM people_requests
     WHERE kind='delete' AND target_id=? AND status='pending' LIMIT 1`),
  listRequests: db.prepare(
    `SELECT r.id, r.kind, r.target_id, r.reason, r.status, r.created_at,
            p.name AS target_name, p.category AS target_category
     FROM people_requests r LEFT JOIN people p ON p.id = r.target_id
     ORDER BY r.status='pending' DESC, r.id DESC LIMIT 300`),
  pendingRequests: db.prepare(
    `SELECT r.id, r.kind, r.target_id, r.reason, r.status, r.created_at,
            p.name AS target_name, p.category AS target_category
     FROM people_requests r LEFT JOIN people p ON p.id = r.target_id
     WHERE r.status='pending' ORDER BY r.id ASC`),
  getRequest: db.prepare(`SELECT * FROM people_requests WHERE id=?`),
  decideRequest: db.prepare(
    `UPDATE people_requests SET status=?, decided_at=? WHERE id=? AND status='pending'`),

  countPeople: db.prepare(`SELECT COUNT(*) c FROM people WHERE status='published'`),
  countMsgs: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status='published'`),
  countPendingPeople: db.prepare(`SELECT COUNT(*) c FROM people WHERE status='pending'`),
  countPendingRequests: db.prepare(`SELECT COUNT(*) c FROM people_requests WHERE status='pending'`),
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

  // ---- 公开：人物册
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
    const moderated = CONFIG.peopleModerated;
    const status = moderated ? 'pending' : 'published';
    const r = q.insert.run(name, category, note, status, now, h);
    if (moderated) {
      return send(res, 202, {
        ok: true, pending: true,
        message: '已提交，等管理员审核通过后才会出现在人物册里',
        item: { id: Number(r.lastInsertRowid), name, category, note, status, created_at: now },
      });
    }
    return send(res, 200, {
      ok: true, pending: false,
      item: { id: Number(r.lastInsertRowid), name, category, note, status, created_at: now },
    });
  }

  const mm = pathname.match(/^\/api\/people\/(\d+)$/);
  if (mm && m === 'DELETE') {
    const limited = rateLimit('d' + h, 3000, 200);
    if (limited) return send(res, 429, { ok: false, error: limited });
    const id = Number(mm[1]);
    const row = q.getPerson.get(id);
    if (!row || row.status !== 'published') {
      return send(res, 404, { ok: false, error: '没有这条（可能已被删）' });
    }
    if (CONFIG.peopleModerated) {
      // 审核开启：不直接删，落一条删除申请
      const dup = q.findRequest.get(id);
      if (dup) {
        return send(res, 202, {
          ok: true, pending: true, message: '这条已经提交过删除申请了，等管理员处理', requestId: Number(dup.id),
        });
      }
      const r = q.addRequest.run('delete', id, clip(req.headers['x-reason'] || '', 200), Date.now(), h);
      return send(res, 202, {
        ok: true, pending: true,
        message: '删除申请已提交，等管理员批准后才真正下架',
        requestId: Number(r.lastInsertRowid),
      });
    }
    const r = q.softDelete.run(Date.now(), id);
    if (!r.changes) return send(res, 404, { ok: false, error: '没有这条（可能已被删）' });
    return send(res, 200, { ok: true, pending: false });
  }

  // ---- 公开：留言板
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
    const moderated = CONFIG.messagesModerated;
    const status = moderated ? 'pending' : 'published';
    const now = Date.now();
    const r = q.insertMsg.run(name, text, status, now, h);
    return send(res, 200, {
      ok: true, pending: moderated,
      message: moderated ? '已提交，等管理员审核后才会显示' : '',
      item: { id: Number(r.lastInsertRowid), name, text, created_at: now },
    });
  }

  // ---- 公开：当前开关状态（前端用来决定提示文案）
  if (pathname === '/api/settings' && m === 'GET') {
    return send(res, 200, { ok: true, settings: publicSettings() });
  }

  // ---- 后台
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { ok: false, error: '管理口令不正确' });

    if (pathname === '/api/admin/settings' && m === 'GET') {
      return send(res, 200, { ok: true, settings: publicSettings() });
    }

    if (pathname === '/api/admin/settings' && m === 'POST') {
      const b = await readBody(req);
      const changed = [];
      if (typeof b.peopleModerated === 'boolean' && b.peopleModerated !== CONFIG.peopleModerated) {
        CONFIG.peopleModerated = b.peopleModerated; changed.push('peopleModerated');
      }
      if (typeof b.messagesModerated === 'boolean' && b.messagesModerated !== CONFIG.messagesModerated) {
        CONFIG.messagesModerated = b.messagesModerated; changed.push('messagesModerated');
      }
      if (changed.length) saveConfig();
      return send(res, 200, { ok: true, settings: publicSettings(), changed });
    }

    if (pathname === '/api/admin/all' && m === 'GET') {
      return send(res, 200, {
        ok: true,
        people: q.allPeople.all(),
        messages: q.allMsgs.all(),
        requests: q.listRequests.all(),
        settings: publicSettings(),
        stats: {
          people: q.countPeople.get().c,
          messages: q.countMsgs.get().c,
          pendingPeople: q.countPendingPeople.get().c,
          pendingRequests: q.countPendingRequests.get().c,
        },
      });
    }

    // 管理员直接加词条（跳过审核）
    if (pathname === '/api/admin/people' && m === 'POST') {
      const b = await readBody(req);
      const name = clip(b.name, 40);
      const note = clip(b.note, 1200);
      const category = clip(b.category, 10);
      if (!name) return send(res, 400, { ok: false, error: '名字不能空' });
      if (!note) return send(res, 400, { ok: false, error: '内容不能空' });
      if (!CATEGORIES.includes(category)) return send(res, 400, { ok: false, error: '分类不合法' });
      const now = Date.now();
      const r = q.insert.run(name, category, note, 'published', now, 'admin');
      return send(res, 200, {
        ok: true,
        item: { id: Number(r.lastInsertRowid), name, category, note, status: 'published', created_at: now },
      });
    }

    // 审批「访客新增」：approve / reject
    if (pathname === '/api/admin/people-review' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const action = String(b.action || '');
      const row = q.getPerson.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这条' });
      if (row.status !== 'pending') return send(res, 409, { ok: false, error: '这条不在待审核状态' });
      if (action === 'approve') { q.setStatus.run('published', Date.now(), id); return send(res, 200, { ok: true }); }
      if (action === 'reject') { q.setStatus.run('rejected', Date.now(), id); return send(res, 200, { ok: true }); }
      return send(res, 400, { ok: false, error: 'action 只能是 approve / reject' });
    }

    // 下架（published → hidden），可恢复
    if (pathname === '/api/admin/people-hide' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const row = q.getPerson.get(id);
      if (!row) return send(res, 404, { ok: false, error: '没有这条' });
      q.setStatus.run('hidden', Date.now(), id);
      return send(res, 200, { ok: true });
    }

    // 审批「删除申请」：approve / reject
    if (pathname === '/api/admin/delete-review' && m === 'POST') {
      const b = await readBody(req);
      const id = Number(b.id);
      const action = String(b.action || '');
      const reqRow = q.getRequest.get(id);
      if (!reqRow) return send(res, 404, { ok: false, error: '没有这条申请' });
      if (reqRow.status !== 'pending') return send(res, 409, { ok: false, error: '这条申请已处理过' });
      const now = Date.now();
      if (action === 'approve') {
        q.setStatus.run('deleted', now, Number(reqRow.target_id));
        q.decideRequest.run('approved', now, id);
        return send(res, 200, { ok: true });
      }
      if (action === 'reject') {
        q.decideRequest.run('rejected', now, id);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false, error: 'action 只能是 approve / reject' });
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
  console.log('  词条审核 : ' + (CONFIG.peopleModerated ? '开' : '关') +
              '   留言审核 : ' + (CONFIG.messagesModerated ? '开' : '关'));
  console.log('  数据库 : data/app.db');
  console.log('');
});
