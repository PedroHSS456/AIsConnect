'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const S = require('./security'), WS = require('./ws'), hub = require('./hub');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.AIS_DATA || path.join(__dirname, '..', 'data');
const PUB = path.join(__dirname, '..', 'public');
fs.mkdirSync(DATA, { recursive: true });
S.initKey(DATA);
const db = require('./db').open(DATA);
const C = require('./chat')(db, hub, DATA);
const A = require('./ai')(db, hub, C);

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const need = (c, status, msg) => { if (!c) throw new HttpError(status, msg); };
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, ...opts });
};
const ctx = { db, hub, C, A, S, route, need, HttpError, DATA, PORT };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const isHttps = req => !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.AIS_SECURE_COOKIES === '1';
const ipOf = req => (process.env.AIS_TRUST_PROXY === '1' && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || '?';
const parseCookies = h => Object.fromEntries((h || '').split(/;\s*/).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const deviceOf = ua => { ua = ua || ''; const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'; const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''; return o ? `${b} · ${o}` : b; };

function sessionFrom(cookieHeader) {
  const tok = parseCookies(cookieHeader).ais_sid; if (!tok) return null;
  const s = db.get('SELECT * FROM sessions WHERE token_hash=?', S.sha256(tok));
  if (!s || s.revoked || s.expires < Date.now()) return null;
  const user = db.get('SELECT * FROM users WHERE id=?', s.user_id); if (!user) return null;
  if (Date.now() - s.last_seen > 60000) db.run('UPDATE sessions SET last_seen=? WHERE id=?', Date.now(), s.id);
  return { session: s, user };
}
function createSession(req, res, userId) {
  const tok = S.token(32), id = S.rid('s_'), now = Date.now();
  db.run('INSERT INTO sessions(id,user_id,token_hash,device,ip,created,last_seen,expires) VALUES(?,?,?,?,?,?,?,?)', id, userId, S.sha256(tok), deviceOf(req.headers['user-agent']), ipOf(req), now, now, now + 30 * 864e5);
  res.setHeader('Set-Cookie', `ais_sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${isHttps(req) ? '; Secure' : ''}`);
  return id;
}
const logEvent = (uid, type, req) => db.run('INSERT INTO security_events(user_id,type,ip,ts) VALUES(?,?,?,?)', uid, type, req ? ipOf(req) : null, Date.now());
Object.assign(ctx, { createSession, logEvent, ipOf, deviceOf });

const SEC = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const json = (res, status, obj, headers = {}) => { const b = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC, ...headers }); res.end(b); };
function readBody(req, limit) {
  return new Promise((ok, bad) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > limit) { bad(new HttpError(413, 'Conteúdo grande demais.')); req.destroy(); } else ch.push(d); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', bad); });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (!p.startsWith('/api/')) {
      let f = p === '/' ? '/index.html' : decodeURIComponent(p); f = path.normalize(f).replace(/^(\.\.[/\\])+/, '');
      let full = path.join(PUB, f);
      if (!full.startsWith(PUB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) full = path.join(PUB, 'index.html');
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache', ...SEC });
      return fs.createReadStream(full).pipe(res);
    }
    const g = S.hit('g:' + ipOf(req), 600, 60000); need(g.ok, 429, 'Muitas requisições. Aguarde um instante.');
    const r = routes.find(r => r.method === req.method && r.re.test(p)); need(r, 404, 'Rota não encontrada.');
    if (req.method !== 'GET') { // proteção CSRF: cabeçalho personalizado + origem
      need(req.headers['x-ais'] === '1', 403, 'Requisição inválida.');
      const o = req.headers.origin; if (o) need(new URL(o).host === req.headers.host, 403, 'Origem não permitida.');
    }
    const auth = sessionFrom(req.headers.cookie);
    if (!r.public) need(auth, 401, 'Entre na sua conta para continuar.');
    const m = r.re.exec(p); const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {}, raw = null;
    if (req.method !== 'GET' && req.method !== 'DELETE' || (req.method === 'DELETE' && req.headers['content-length'])) {
      const buf = await readBody(req, r.raw ? 26 * 1024 * 1024 : 1024 * 1024);
      if (r.raw) raw = buf; else if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); } }
    }
    const out = await r.handler({ req, res, user: auth?.user, session: auth?.session, params, body, raw, query: Object.fromEntries(url.searchParams) });
    if (out !== undefined && !res.writableEnded) json(res, 200, out);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) json(res, e.status, { error: e.message, ...e.extra });
    else { console.error('[http]', e); json(res, 500, { error: 'Erro interno. Tente novamente.' }); }
  }
});

// ---------- Tempo real ----------
const calls = new Map(); // callId -> call
const callOf = id => calls.get(id);
const fmtDur = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function endCall(call, reason) {
  if (call.ended) return; call.ended = true; clearTimeout(call.timer); calls.delete(call.id);
  const label = call.video ? 'vídeo' : 'voz';
  let text;
  if (call.connectedAt) text = `Chamada de ${label} encerrada · ${fmtDur(Math.round((Date.now() - call.connectedAt) / 1000))}`;
  else if (reason === 'declined') text = `Chamada de ${label} recusada`;
  else text = `Chamada de ${label} perdida`;
  C.system(call.chatId, text);
  const ev = { t: 'call.ended', callId: call.id, chatId: call.chatId, reason };
  hub.emitMany([...call.participants, ...call.invited, ...C.chatUserIds(call.chatId)], ev);
}
function leaveCall(uid, call) {
  if (!call.participants.delete(uid)) return;
  hub.emitMany([...call.participants, uid], { t: 'call.left', callId: call.id, userId: uid });
  const dm = db.get('SELECT type FROM chats WHERE id=?', call.chatId)?.type === 'dm';
  if (call.participants.size === 0 || (dm && call.participants.size < 2 && call.connectedAt) || (call.participants.size < 2 && !call.connectedAt && dm && call.invited.size === 0)) endCall(call, 'left');
}

function onWsMessage(conn, uid, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  const rl = S.hit('ws:' + uid, 400, 10000); if (!rl.ok) return;
  switch (m.t) {
    case 'ping': return conn.send({ t: 'pong' });
    case 'typing': if (C.member(m.chatId, uid)) for (const o of C.chatUserIds(m.chatId)) if (o !== uid) hub.emit(o, { t: 'typing', chatId: m.chatId, userId: uid }); return;
    case 'ack': case 'read': {
      const mem = C.member(m.chatId, uid); if (!mem) return; const seq = Math.max(0, +m.seq || 0);
      if (m.t === 'ack') db.run('UPDATE members SET delivered_seq=MAX(delivered_seq,?) WHERE chat_id=? AND kind=\'user\' AND ref_id=?', seq, m.chatId, uid);
      else db.run('UPDATE members SET read_seq=MAX(read_seq,?), delivered_seq=MAX(delivered_seq,?) WHERE chat_id=? AND kind=\'user\' AND ref_id=?', seq, seq, m.chatId, uid);
      const mm = C.member(m.chatId, uid), pr = C.pj(C.getUser(uid).privacy, {});
      C.emitChat(m.chatId, { t: 'receipt', chatId: m.chatId, userId: uid, deliveredSeq: mm.delivered_seq, readSeq: pr.receipts === false ? 0 : mm.read_seq });
      return;
    }
    case 'call.invite': {
      const chat = db.get('SELECT * FROM chats WHERE id=?', m.chatId);
      if (!chat || chat.type === 'ai' || !C.member(chat.id, uid)) return conn.send({ t: 'call.error', text: 'Não é possível ligar nesta conversa.' });
      if (db.get("SELECT 1 FROM contacts WHERE other_id=? AND user_id IN (SELECT ref_id FROM members WHERE chat_id=? AND kind='user') AND status='blocked'", uid, chat.id) && chat.type === 'dm') return conn.send({ t: 'call.error', text: 'Não foi possível completar a chamada.' });
      const ex = [...calls.values()].find(c => c.chatId === chat.id);
      if (ex) return conn.send({ t: 'call.exists', callId: ex.id, chatId: chat.id, video: ex.video });
      if ([...calls.values()].some(c => c.participants.has(uid))) return conn.send({ t: 'call.error', text: 'Você já está em uma chamada.' });
      const others = C.chatUserIds(chat.id).filter(x => x !== uid);
      if (!others.some(o => hub.online(o))) return conn.send({ t: 'call.error', text: 'Ninguém está online para atender agora.' });
      const call = { id: S.rid('c_'), chatId: chat.id, video: !!m.video, initiator: uid, participants: new Set([uid]), invited: new Set(others), startedAt: Date.now(), connectedAt: 0 };
      call.timer = setTimeout(() => { if (!call.connectedAt && call.participants.size < 2) endCall(call, 'missed'); }, 45000);
      calls.set(call.id, call); conn.callId = call.id;
      conn.send({ t: 'call.created', callId: call.id, chatId: chat.id, video: call.video });
      for (const o of others) hub.emit(o, { t: 'call.incoming', callId: call.id, chatId: chat.id, video: call.video, from: C.userPublic(C.getUser(uid)), title: chat.title });
      return;
    }
    case 'call.accept': {
      const call = callOf(m.callId); if (!call || !C.member(call.chatId, uid) || call.participants.has(uid)) return;
      if ([...calls.values()].some(c => c.participants.has(uid))) return conn.send({ t: 'call.error', text: 'Você já está em uma chamada.' });
      if (call.participants.size >= 8) return conn.send({ t: 'call.error', text: 'A chamada atingiu o limite de 8 pessoas.' });
      const peers = [...call.participants]; call.participants.add(uid); call.invited.delete(uid); conn.callId = call.id;
      if (!call.connectedAt) { call.connectedAt = Date.now(); clearTimeout(call.timer); }
      hub.emitMany(peers, { t: 'call.joined', callId: call.id, userId: uid, user: C.userPublic(C.getUser(uid)) });
      conn.send({ t: 'call.peers', callId: call.id, chatId: call.chatId, video: call.video, peers: peers.map(id => C.userPublic(C.getUser(id))) });
      hub.emitMany(C.chatUserIds(call.chatId).filter(x => x !== uid && !call.participants.has(x)), { t: 'call.ongoing', callId: call.id, chatId: call.chatId, video: call.video });
      return;
    }
    case 'call.decline': {
      const call = callOf(m.callId); if (!call || !C.member(call.chatId, uid)) return;
      call.invited.delete(uid); hub.emit(uid, { t: 'call.dismiss', callId: call.id });
      const dm = db.get('SELECT type FROM chats WHERE id=?', call.chatId)?.type === 'dm';
      if (dm && !call.connectedAt) endCall(call, 'declined');
      return;
    }
    case 'call.signal': {
      const call = callOf(m.callId); if (!call || !call.participants.has(uid) || !call.participants.has(m.to)) return;
      hub.emit(m.to, { t: 'call.signal', callId: call.id, from: uid, data: m.data }); return;
    }
    case 'call.media': { const call = callOf(m.callId); if (call?.participants.has(uid)) hub.emitMany([...call.participants].filter(x => x !== uid), { t: 'call.media', callId: call.id, userId: uid, state: m.state }); return; }
    case 'call.leave': { const call = callOf(m.callId); if (call) { leaveCall(uid, call); conn.callId = null; } return; }
  }
}

server.on('upgrade', (req, socket) => {
  try {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) return socket.destroy();
    const auth = sessionFrom(req.headers.cookie); if (!auth) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    const conn = WS.upgrade(req, socket); if (!conn) return;
    const uid = auth.user.id; conn.sid = auth.session.id; conn.uid = uid;
    const first = !hub.online(uid); hub.add(uid, conn);
    const myCalls = [...calls.values()].filter(c => !c.participants.has(uid) && C.member(c.chatId, uid)).map(c => ({ callId: c.id, chatId: c.chatId, video: c.video, from: C.userPublic(C.getUser(c.initiator)) }));
    conn.send({ t: 'hello', userId: uid, calls: myCalls });
    // entrega: marca como entregues as mensagens pendentes
    for (const m of db.all("SELECT chat_id, delivered_seq FROM members WHERE kind='user' AND ref_id=?", uid)) {
      const mx = db.get('SELECT MAX(seq) s FROM messages WHERE chat_id=?', m.chat_id).s || 0;
      if (mx > m.delivered_seq) { db.run("UPDATE members SET delivered_seq=? WHERE chat_id=? AND kind='user' AND ref_id=?", mx, m.chat_id, uid); C.emitChat(m.chat_id, { t: 'receipt', chatId: m.chat_id, userId: uid, deliveredSeq: mx, readSeq: undefined }); }
    }
    const peers = () => db.all("SELECT DISTINCT ref_id FROM members WHERE kind='user' AND chat_id IN (SELECT chat_id FROM members WHERE kind='user' AND ref_id=?)", uid).map(r => r.ref_id).filter(x => x !== uid);
    const pres = on => { if (C.pj(auth.user.privacy, {}).presence !== 'nobody') hub.emitMany(peers(), { t: 'presence', userId: uid, online: on }); };
    if (first) pres(true);
    conn.on('message', raw => onWsMessage(conn, uid, raw));
    conn.on('close', () => {
      hub.remove(uid, conn);
      if (conn.callId) { const call = callOf(conn.callId); if (call && !hub.online(uid)) leaveCall(uid, call); }
      if (!hub.online(uid)) pres(false);
    });
    const hb = setInterval(() => { if (!conn.open) return clearInterval(hb); if (!conn.alive) return conn.socket.destroy(); conn.ping(); }, 25000); hb.unref();
  } catch (e) { socket.destroy(); }
});
hub.kickSession = sid => { for (const set of hub.all().values()) for (const c of set) if (c.sid === sid) { c.send({ t: 'session.revoked' }); c.close(1000); } };
Object.assign(ctx, { calls });

require('./routes')(ctx);
if (require.main === module) server.listen(PORT, () => console.log(`AIsConnect em http://localhost:${PORT}  (senhas: ${S.usingArgon2() ? 'Argon2id' : 'scrypt'})`));
module.exports = { server, ctx };
