'use strict';
const fs = require('fs'), dns = require('dns').promises, net = require('net');
const P = require('./providers');

module.exports = function (X) {
  const { db, hub, C, A, S, route: R, need, HttpError, createSession, logEvent, ipOf, calls } = X;
  const n = x => x === undefined ? null : x;
  const str = (v, max, min = 0) => { v = typeof v === 'string' ? v.trim() : ''; return v.length >= min && v.length <= max ? v : null; };
  const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  const avatarOk = a => a == null || a === '' ? null : (typeof a === 'string' && a.length < 200000 && AVATAR_RE.test(a) ? a : (() => { throw new HttpError(400, 'Imagem de perfil inválida.'); })());
  const priv = u => ({ ...C.userPublic(u), privacy: { add: 'request', presence: 'all', receipts: true, ...C.pj(u.privacy, {}) }, totpOn: !!u.totp_on, recoveryLeft: C.pj(u.recovery, []).length, argon2: S.usingArgon2() });
  const chatItem = (id, uid) => C.chatListItem(id, uid);
  const mem = (chatId, uid) => { const m = C.member(chatId, uid); need(m, 404, 'Conversa não encontrada.'); return m; };
  const ownAI = (id, uid) => { const a = db.get('SELECT * FROM ais WHERE id=? AND deleted=0', id); need(a && a.owner_id === uid, 404, 'IA não encontrada.'); return a; };
  const aiOwnerView = a => ({ ...C.aiPublic(a), keyHint: a.key_hint, baseUrl: a.base_url, instructions: a.instructions, temperature: a.temperature });
  const refresh = chatId => C.emitChat(chatId, { t: 'chat.update', chatId });
  const confirmCreds = async (user, body, strict = true) => {
    need(await S.verifyPassword(String(body.password || ''), user.pw_hash), 403, 'Senha atual incorreta.');
    if (user.totp_on && strict) { const step = S.totpCheck(user.totp_secret ? S.decrypt(user.totp_secret) : '', body.code, user.totp_step); need(step, 403, 'Código de verificação inválido.'); db.run('UPDATE users SET totp_step=? WHERE id=?', step, user.id); }
  };
  const newCodes = () => { const codes = S.newRecoveryCodes(); return { codes, hashes: codes.map(c => S.sha256(c)) }; };
  const takeRecovery = (user, code) => { const list = C.pj(user.recovery, []), h = S.sha256(String(code || '').trim().toLowerCase()), i = list.indexOf(h); if (i < 0) return false; list.splice(i, 1); db.run('UPDATE users SET recovery=? WHERE id=?', JSON.stringify(list), user.id); return true; };

  // ---------- Conta ----------
  R('POST', '/api/register', async ({ req, res, body }) => {
    const rl = S.hit('reg:' + ipOf(req), 8, 3600000); need(rl.ok, 429, 'Muitas contas criadas deste dispositivo. Tente mais tarde.');
    const username = str(body.username, 24, 3); need(username && /^[a-z0-9_.]+$/i.test(username), 400, 'Nome de usuário: 3 a 24 caracteres (letras, números, ponto e _).');
    const bad = S.passwordProblem(body.password); need(!bad, 400, bad);
    need(body.password === body.confirm || body.confirm === undefined, 400, 'As senhas não coincidem.');
    need(!db.get('SELECT 1 FROM users WHERE username=?', username), 409, 'Esse nome de usuário já está em uso.');
    const hash = await S.hashPassword(body.password), { codes, hashes } = newCodes(), id = S.rid('u_');
    let number; for (let i = 0; i < 20; i++) { number = String(require('crypto').randomInt(1, 10)) + String(require('crypto').randomInt(0, 1e8)).padStart(8, '0'); if (!db.get('SELECT 1 FROM users WHERE number=?', number)) break; }
    db.run('INSERT INTO users(id,username,number,pw_hash,avatar,recovery,created,privacy) VALUES(?,?,?,?,?,?,?,?)', id, username, number, hash, avatarOk(body.avatar), JSON.stringify(hashes), Date.now(), '{}');
    createSession(req, res, id); logEvent(id, 'conta_criada', req);
    return { user: priv(C.getUser(id)), recoveryCodes: codes };
  }, { public: true });

  R('POST', '/api/login', async ({ req, res, body }) => {
    const username = str(body.username, 40) || '', ip = ipOf(req), key = `login:${ip}:${username.toLowerCase()}`;
    for (const [k, max] of [[key, 8], ['loginip:' + ip, 60]]) { const rl = S.hit(k, max, 900000); need(rl.ok, 429, `Muitas tentativas. Tente de novo em ${Math.ceil(rl.retryAfter / 60)} min.`, { retryAfter: rl.retryAfter }); }
    const u = db.get('SELECT * FROM users WHERE username=?', username);
    if (!u) { await S.dummyVerify(String(body.password || '')); throw new HttpError(401, 'Usuário ou senha incorretos.'); }
    if (!await S.verifyPassword(String(body.password || ''), u.pw_hash)) { logEvent(u.id, 'login_falhou', req); throw new HttpError(401, 'Usuário ou senha incorretos.'); }
    if (u.totp_on) {
      if (!body.code) return { need2fa: true };
      const step = S.totpCheck(S.decrypt(u.totp_secret), body.code, u.totp_step);
      if (step) db.run('UPDATE users SET totp_step=? WHERE id=?', step, u.id);
      else if (!takeRecovery(u, body.code)) { logEvent(u.id, '2fa_falhou', req); throw new HttpError(401, 'Código inválido.'); }
    }
    S.clearHits(key); createSession(req, res, u.id); logEvent(u.id, 'login', req);
    return { user: priv(db.get('SELECT * FROM users WHERE id=?', u.id)) };
  }, { public: true });

  R('POST', '/api/recover', async ({ req, res, body }) => {
    const ip = ipOf(req), rl = S.hit('rec:' + ip, 6, 3600000); need(rl.ok, 429, 'Muitas tentativas. Tente mais tarde.');
    const bad = S.passwordProblem(body.newPassword); need(!bad, 400, bad);
    const u = db.get('SELECT * FROM users WHERE username=?', str(body.username, 40) || '');
    const ok = u && takeRecovery(u, body.code);
    if (!ok) { await S.dummyVerify('x'); throw new HttpError(400, 'Não foi possível recuperar com esses dados. Confira o usuário e o código de recuperação.'); }
    db.run('UPDATE users SET pw_hash=? WHERE id=?', await S.hashPassword(body.newPassword), u.id);
    for (const s of db.all('SELECT id FROM sessions WHERE user_id=? AND revoked=0', u.id)) { db.run('UPDATE sessions SET revoked=1 WHERE id=?', s.id); hub.kickSession(s.id); }
    logEvent(u.id, 'senha_recuperada', req); createSession(req, res, u.id);
    return { user: priv(C.getUser(u.id)), recoveryLeft: C.pj(C.getUser(u.id).recovery, []).length };
  }, { public: true });

  R('POST', '/api/logout', ({ req, res, session }) => { db.run('UPDATE sessions SET revoked=1 WHERE id=?', session.id); hub.kickSession(session.id); res.setHeader('Set-Cookie', 'ais_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); return { ok: true }; });
  R('GET', '/api/me', ({ user }) => ({ user: priv(user) }));
  R('GET', '/api/config', () => {
    const ice = [{ urls: process.env.AIS_STUN || 'stun:stun.l.google.com:19302' }];
    if (process.env.AIS_TURN_URL) ice.push({ urls: process.env.AIS_TURN_URL, username: process.env.AIS_TURN_USER, credential: process.env.AIS_TURN_PASS });
    return { iceServers: ice, providers: Object.fromEntries(Object.entries(P.PROVIDERS).map(([k, v]) => [k, { label: v.label, defaultModel: v.defaultModel, keyUrl: v.keyUrl, needsBase: !!v.needsBase }])) };
  });
  R('PATCH', '/api/me', ({ user, body }) => {
    const bio = body.bio !== undefined ? str(body.bio, 140) ?? '' : user.bio;
    const pr = { ...C.pj(user.privacy, {}) };
    if (body.privacy) { if (['all', 'request'].includes(body.privacy.add)) pr.add = body.privacy.add; if (['all', 'nobody'].includes(body.privacy.presence)) pr.presence = body.privacy.presence; if (typeof body.privacy.receipts === 'boolean') pr.receipts = body.privacy.receipts; }
    db.run('UPDATE users SET bio=?, avatar=?, privacy=? WHERE id=?', bio, body.avatar !== undefined ? avatarOk(body.avatar) : user.avatar, JSON.stringify(pr), user.id);
    return { user: priv(C.getUser(user.id)) };
  });
  R('POST', '/api/me/password', async ({ req, user, session, body }) => {
    await confirmCreds(user, body); const bad = S.passwordProblem(body.newPassword); need(!bad, 400, bad);
    db.run('UPDATE users SET pw_hash=? WHERE id=?', await S.hashPassword(body.newPassword), user.id);
    for (const s of db.all('SELECT id FROM sessions WHERE user_id=? AND revoked=0 AND id!=?', user.id, session.id)) { db.run('UPDATE sessions SET revoked=1 WHERE id=?', s.id); hub.kickSession(s.id); }
    logEvent(user.id, 'senha_alterada', req); hub.emit(user.id, { t: 'security', text: 'A senha da conta foi alterada e as outras sessões foram encerradas.' });
    return { ok: true };
  });
  R('POST', '/api/me/2fa/setup', async ({ user, body }) => {
    need(await S.verifyPassword(String(body.password || ''), user.pw_hash), 403, 'Senha incorreta.'); need(!user.totp_on, 400, 'A verificação em duas etapas já está ativa.');
    const secret = S.newTotpSecret(); db.run('UPDATE users SET totp_secret=? WHERE id=?', S.encrypt(secret), user.id);
    return { secret, uri: `otpauth://totp/AIsConnect:${encodeURIComponent(user.username)}?secret=${secret}&issuer=AIsConnect` };
  });
  R('POST', '/api/me/2fa/enable', ({ req, user, body }) => {
    need(user.totp_secret && !user.totp_on, 400, 'Inicie a configuração primeiro.');
    const step = S.totpCheck(S.decrypt(user.totp_secret), body.code, 0); need(step, 400, 'Código incorreto. Confira o app autenticador.');
    const { codes, hashes } = newCodes(); db.run('UPDATE users SET totp_on=1, totp_step=?, recovery=? WHERE id=?', step, JSON.stringify(hashes), user.id);
    logEvent(user.id, '2fa_ativado', req); return { recoveryCodes: codes };
  });
  R('POST', '/api/me/2fa/disable', async ({ req, user, body }) => { await confirmCreds(user, body); db.run('UPDATE users SET totp_on=0, totp_secret=NULL WHERE id=?', user.id); logEvent(user.id, '2fa_desativado', req); hub.emit(user.id, { t: 'security', text: 'A verificação em duas etapas foi desativada.' }); return { ok: true }; });
  R('POST', '/api/me/recovery-codes', async ({ req, user, body }) => { await confirmCreds(user, body); const { codes, hashes } = newCodes(); db.run('UPDATE users SET recovery=? WHERE id=?', JSON.stringify(hashes), user.id); logEvent(user.id, 'codigos_regenerados', req); return { recoveryCodes: codes }; });
  R('GET', '/api/sessions', ({ user, session }) => ({ sessions: db.all('SELECT id, device, ip, created, last_seen FROM sessions WHERE user_id=? AND revoked=0 AND expires>? ORDER BY last_seen DESC', user.id, Date.now()).map(s => ({ ...s, current: s.id === session.id })) }));
  R('DELETE', '/api/sessions/:id', ({ user, params, req }) => { const s = db.get('SELECT * FROM sessions WHERE id=? AND user_id=?', params.id, user.id); need(s, 404, 'Sessão não encontrada.'); db.run('UPDATE sessions SET revoked=1 WHERE id=?', s.id); hub.kickSession(s.id); logEvent(user.id, 'sessao_encerrada', req); return { ok: true }; });
  R('POST', '/api/sessions/revoke-others', ({ user, session, req }) => { for (const s of db.all('SELECT id FROM sessions WHERE user_id=? AND revoked=0 AND id!=?', user.id, session.id)) { db.run('UPDATE sessions SET revoked=1 WHERE id=?', s.id); hub.kickSession(s.id); } logEvent(user.id, 'outras_sessoes_encerradas', req); return { ok: true }; });
  R('GET', '/api/security-events', ({ user }) => ({ events: db.all('SELECT type, ip, ts FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id) }));
  R('DELETE', '/api/me', async ({ user, body, res }) => {
    await confirmCreds(user, body);
    for (const s of db.all('SELECT id FROM sessions WHERE user_id=?', user.id)) hub.kickSession(s.id);
    db.run('DELETE FROM users WHERE id=?', user.id); res.setHeader('Set-Cookie', 'ais_sid=; Path=/; HttpOnly; Max-Age=0'); return { ok: true };
  });

  // ---------- Contatos ----------
  const contactRows = uid => db.all('SELECT * FROM contacts WHERE user_id=?', uid);
  R('GET', '/api/contacts', ({ user }) => ({ contacts: contactRows(user.id).map(r => ({ ...C.userPublic(C.getUser(r.other_id)), status: r.status })) }));
  R('GET', '/api/users/lookup', ({ user, query }) => {
    const rl = S.hit('look:' + user.id, 30, 60000); need(rl.ok, 429, 'Muitas buscas. Aguarde um minuto.');
    const num = String(query.number || '').replace(/\D/g, ''); need(num.length === 9, 400, 'Digite o número completo no formato +AI 000 000 000.');
    const u = db.get('SELECT * FROM users WHERE number=?', num); need(u && u.id !== user.id, 404, 'Nenhum usuário com esse número.');
    const blocked = db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='blocked'", u.id, user.id);
    need(!blocked, 404, 'Nenhum usuário com esse número.');
    const p = C.userPublic(u); const mine = db.get('SELECT status FROM contacts WHERE user_id=? AND other_id=?', user.id, u.id);
    return { profile: { username: p.username, number: p.number, avatar: p.avatar, bio: p.bio }, status: mine?.status || null };
  });
  R('POST', '/api/contacts', ({ user, body }) => {
    const rl = S.hit('addc:' + user.id, 20, 3600000); need(rl.ok, 429, 'Muitas solicitações enviadas. Tente mais tarde.');
    const u = db.get('SELECT * FROM users WHERE number=?', String(body.number || '').replace(/\D/g, '')); need(u && u.id !== user.id, 404, 'Nenhum usuário com esse número.');
    const mine = db.get('SELECT status FROM contacts WHERE user_id=? AND other_id=?', user.id, u.id);
    need(mine?.status !== 'blocked', 400, 'Desbloqueie esse contato antes de adicioná-lo.');
    if (mine?.status === 'accepted') return { status: 'accepted', userId: u.id };
    if (db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='blocked'", u.id, user.id)) return { status: 'pending_out' }; // não revela bloqueio
    const theirs = db.get('SELECT status FROM contacts WHERE user_id=? AND other_id=?', u.id, user.id);
    const auto = theirs?.status === 'pending_out' || C.pj(u.privacy, {}).add === 'all';
    const t = Date.now();
    db.tx(() => { for (const [a, b, s] of [[user.id, u.id, auto ? 'accepted' : 'pending_out'], [u.id, user.id, auto ? 'accepted' : 'pending_in']]) db.run('INSERT INTO contacts(user_id,other_id,status,created) VALUES(?,?,?,?) ON CONFLICT(user_id,other_id) DO UPDATE SET status=excluded.status', a, b, s, t); });
    hub.emit(u.id, { t: 'contacts.update' }); hub.emit(user.id, { t: 'contacts.update' });
    return { status: auto ? 'accepted' : 'pending_out', userId: u.id };
  });
  R('POST', '/api/contacts/:id/accept', ({ user, params }) => {
    need(db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='pending_in'", user.id, params.id), 404, 'Solicitação não encontrada.');
    db.run("UPDATE contacts SET status='accepted' WHERE (user_id=? AND other_id=?) OR (user_id=? AND other_id=?)", user.id, params.id, params.id, user.id);
    hub.emit(params.id, { t: 'contacts.update' }); return { ok: true };
  });
  R('DELETE', '/api/contacts/:id', ({ user, params }) => { db.run("DELETE FROM contacts WHERE ((user_id=? AND other_id=?) OR (user_id=? AND other_id=?)) AND status!='blocked'", user.id, params.id, params.id, user.id); hub.emit(params.id, { t: 'contacts.update' }); return { ok: true }; });
  R('POST', '/api/contacts/:id/block', ({ user, params }) => { need(C.getUser(params.id), 404, 'Usuário não encontrado.'); db.run("INSERT INTO contacts(user_id,other_id,status,created) VALUES(?,?, 'blocked',?) ON CONFLICT(user_id,other_id) DO UPDATE SET status='blocked'", user.id, params.id, Date.now()); db.run("DELETE FROM contacts WHERE user_id=? AND other_id=? AND status!='blocked'", params.id, user.id); return { ok: true }; });
  R('DELETE', '/api/contacts/:id/block', ({ user, params }) => { db.run("DELETE FROM contacts WHERE user_id=? AND other_id=? AND status='blocked'", user.id, params.id); return { ok: true }; });

  // ---------- Chats ----------
  const isBlockedPair = (a, b) => !!db.get("SELECT 1 FROM contacts WHERE status='blocked' AND ((user_id=? AND other_id=?) OR (user_id=? AND other_id=?))", a, b, b, a);
  const addMember = (chatId, kind, ref, role = 'member') => db.run('INSERT OR IGNORE INTO members(chat_id,kind,ref_id,role,joined) VALUES(?,?,?,?,?)', chatId, kind, ref, role, Date.now());
  R('GET', '/api/chats', ({ user }) => ({ chats: db.all("SELECT chat_id FROM members WHERE kind='user' AND ref_id=?", user.id).map(r => chatItem(r.chat_id, user.id)).filter(Boolean) }));
  R('GET', '/api/chats/:id', ({ user, params }) => { mem(params.id, user.id); return { chat: chatItem(params.id, user.id) }; });
  R('POST', '/api/chats/dm', ({ user, body }) => {
    const o = C.getUser(body.userId); need(o && o.id !== user.id, 404, 'Usuário não encontrado.');
    need(!isBlockedPair(user.id, o.id), 403, 'Não é possível conversar com esse contato.');
    need(db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='accepted'", user.id, o.id), 403, 'Adicione essa pessoa como contato primeiro.');
    const key = [user.id, o.id].sort().join(':'); let c = db.get('SELECT id FROM chats WHERE dm_key=?', key);
    if (!c) { const id = S.rid('c_'); db.tx(() => { db.run("INSERT INTO chats(id,type,created_by,created,dm_key) VALUES(?, 'dm', ?, ?, ?)", id, user.id, Date.now(), key); addMember(id, 'user', user.id); addMember(id, 'user', o.id); }); c = { id }; hub.emit(o.id, { t: 'chat.update', chatId: id }); }
    return { chat: chatItem(c.id, user.id) };
  });
  R('POST', '/api/chats/ai', ({ user, body }) => {
    const a = db.get('SELECT * FROM ais WHERE id=? AND deleted=0', body.aiId); need(a, 404, 'IA não encontrada.');
    const au = C.authorizeAI(a.id, user.id, null); need(au.ok, 403, au.reason);
    const id = S.rid('c_'); db.tx(() => { db.run("INSERT INTO chats(id,type,title,created_by,created) VALUES(?, 'ai', ?, ?, ?)", id, a.name, user.id, Date.now()); addMember(id, 'user', user.id, 'owner'); addMember(id, 'ai', a.id); });
    return { chat: chatItem(id, user.id) };
  });
  R('POST', '/api/chats/group', ({ user, body }) => {
    const title = str(body.title, 60, 1); need(title, 400, 'Dê um nome ao grupo.');
    const users = [...new Set(Array.isArray(body.userIds) ? body.userIds : [])].slice(0, 99), ais = [...new Set(Array.isArray(body.aiIds) ? body.aiIds : [])].slice(0, 10);
    for (const u of users) need(db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='accepted'", user.id, u), 400, 'Só é possível adicionar seus contatos.');
    for (const a of ais) ownAI(a, user.id);
    const id = S.rid('c_');
    db.tx(() => { db.run("INSERT INTO chats(id,type,title,description,avatar,created_by,created) VALUES(?, 'group', ?, ?, ?, ?, ?)", id, title, str(body.description, 300) || '', avatarOk(body.avatar), user.id, Date.now()); addMember(id, 'user', user.id, 'owner'); for (const u of users) addMember(id, 'user', u); for (const a of ais) addMember(id, 'ai', a); });
    C.system(id, `${user.username} criou o grupo "${title}".`); refresh(id);
    return { chat: chatItem(id, user.id) };
  });
  R('PATCH', '/api/chats/:id', ({ user, params, body }) => {
    const m = mem(params.id, user.id), c = db.get('SELECT * FROM chats WHERE id=?', params.id); need(c.type === 'group' && C.isAdmin(c.id, user.id), 403, 'Apenas administradores podem editar o grupo.');
    db.run('UPDATE chats SET title=?, description=?, avatar=?, send_by=? WHERE id=?', body.title !== undefined ? str(body.title, 60, 1) || c.title : c.title, body.description !== undefined ? str(body.description, 300) ?? '' : c.description, body.avatar !== undefined ? avatarOk(body.avatar) : c.avatar, ['all', 'admins'].includes(body.sendBy) ? body.sendBy : c.send_by, c.id);
    refresh(c.id); return { chat: chatItem(c.id, user.id) };
  });
  R('POST', '/api/chats/:id/flags', ({ user, params, body }) => {
    mem(params.id, user.id);
    for (const k of ['pinned', 'muted', 'archived']) if (typeof body[k] === 'boolean') db.run(`UPDATE members SET ${k}=? WHERE chat_id=? AND kind='user' AND ref_id=?`, body[k] ? 1 : 0, params.id, user.id);
    return { chat: chatItem(params.id, user.id) };
  });
  R('DELETE', '/api/chats/:id/history', ({ user, params }) => { mem(params.id, user.id); const mx = db.get('SELECT COALESCE(MAX(seq),0) s FROM messages WHERE chat_id=?', params.id).s; db.run("UPDATE members SET cleared_seq=?, read_seq=? WHERE chat_id=? AND kind='user' AND ref_id=?", mx, mx, params.id, user.id); return { ok: true }; });
  R('POST', '/api/chats/:id/members', ({ user, params, body }) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', params.id); mem(params.id, user.id); need(c.type === 'group' && C.isAdmin(c.id, user.id), 403, 'Apenas administradores podem convidar.');
    const added = [];
    for (const u of (Array.isArray(body.userIds) ? body.userIds : []).slice(0, 50)) { if (C.member(c.id, u)) continue; need(db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='accepted'", user.id, u), 400, 'Só é possível adicionar seus contatos.'); need(C.chatUserIds(c.id).length < 100, 400, 'O grupo atingiu o limite de 100 pessoas.'); addMember(c.id, 'user', u); added.push(u); }
    if (added.length) { C.system(c.id, `${user.username} adicionou ${added.map(a => C.getUser(a).username).join(', ')}.`); refresh(c.id); }
    return { chat: chatItem(c.id, user.id) };
  });
  const removeUser = (c, uid, byName, self) => {
    const mine = db.all("SELECT id FROM ais WHERE owner_id=?", uid).map(a => a.id);
    const was = C.member(c.id, uid); const recipients = C.chatUserIds(c.id);
    db.run("DELETE FROM members WHERE chat_id=? AND kind='user' AND ref_id=?", c.id, uid);
    for (const a of mine) db.run("DELETE FROM members WHERE chat_id=? AND kind='ai' AND ref_id=?", c.id, a);
    db.run('UPDATE shares SET revoked=1 WHERE chat_id=? AND owner_id=?', c.id, uid);
    const left = C.chatUserIds(c.id);
    if (!left.length) { db.run('DELETE FROM chats WHERE id=?', c.id); hub.emitMany(recipients, { t: 'chat.removed', chatId: c.id }); return; }
    if (was.role === 'owner') db.run("UPDATE members SET role='owner' WHERE chat_id=? AND kind='user' AND ref_id=?", c.id, db.get("SELECT ref_id FROM members WHERE chat_id=? AND kind='user' ORDER BY (role='admin') DESC, joined LIMIT 1", c.id).ref_id);
    C.system(c.id, self ? `${C.getUser(uid).username} saiu do grupo.` : `${byName} removeu ${C.getUser(uid).username}.`);
    hub.emit(uid, { t: 'chat.removed', chatId: c.id }); refresh(c.id);
  };
  R('DELETE', '/api/chats/:id/members/:uid', ({ user, params }) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', params.id); mem(params.id, user.id); need(c.type === 'group', 400, 'Só grupos têm participantes.');
    const target = C.member(c.id, params.uid); need(target, 404, 'Participante não encontrado.');
    if (params.uid !== user.id) { need(C.isAdmin(c.id, user.id) && target.role !== 'owner', 403, 'Você não pode remover essa pessoa.'); }
    removeUser(c, params.uid, user.username, params.uid === user.id); return { ok: true };
  });
  R('POST', '/api/chats/:id/members/:uid/role', ({ user, params, body }) => {
    const m = mem(params.id, user.id); need(m.role === 'owner', 403, 'Só quem criou o grupo promove administradores.');
    need(['admin', 'member'].includes(body.role) && C.member(params.id, params.uid) && params.uid !== user.id, 400, 'Solicitação inválida.');
    db.run("UPDATE members SET role=? WHERE chat_id=? AND kind='user' AND ref_id=?", body.role, params.id, params.uid);
    C.system(params.id, `${C.getUser(params.uid).username} ${body.role === 'admin' ? 'agora é administrador' : 'deixou de ser administrador'}.`); refresh(params.id); return { ok: true };
  });
  R('POST', '/api/chats/:id/ais', ({ user, params, body }) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', params.id); mem(params.id, user.id); need(c.type === 'group', 400, 'Adicione IAs apenas em grupos.');
    const a = ownAI(body.aiId, user.id); addMember(c.id, 'ai', a.id); C.system(c.id, `${user.username} adicionou a IA ${a.name} ao grupo. Use @${a.name} para falar com ela.`); refresh(c.id); return { ok: true };
  });
  R('DELETE', '/api/chats/:id/ais/:aiId', ({ user, params }) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', params.id); mem(params.id, user.id); const a = db.get('SELECT * FROM ais WHERE id=?', params.aiId); need(a && c.type === 'group' && C.aiMember(c.id, a.id), 404, 'IA não encontrada neste grupo.');
    need(a.owner_id === user.id || C.isAdmin(c.id, user.id), 403, 'Sem permissão.');
    db.run("DELETE FROM members WHERE chat_id=? AND kind='ai' AND ref_id=?", c.id, a.id); db.run('UPDATE shares SET revoked=1 WHERE chat_id=? AND ai_id=?', c.id, a.id);
    C.system(c.id, `${a.name} foi removida do grupo.`); refresh(c.id); return { ok: true };
  });

  // Trocar IA do chat: o histórico fica no chat; apenas a IA responsável muda.
  R('POST', '/api/chats/:id/switch-ai', async ({ user, params, body }) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', params.id); mem(c?.id, user.id); need(c.type === 'ai', 400, 'Só conversas individuais com IA podem trocar a IA.');
    const to = db.get('SELECT * FROM ais WHERE id=? AND deleted=0', body.aiId); need(to, 404, 'IA não encontrada.');
    const au = C.authorizeAI(to.id, user.id, c.id); need(au.ok, 403, au.reason);
    const cur = db.get("SELECT ref_id FROM members WHERE chat_id=? AND kind='ai'", c.id); need(cur?.ref_id !== to.id, 400, 'Essa já é a IA da conversa.');
    const from = db.get('SELECT name FROM ais WHERE id=?', cur?.ref_id), last = db.get('SELECT COALESCE(MAX(seq),0) s FROM messages WHERE chat_id=?', c.id).s;
    let ctxFrom = 0, summary = null;
    if (body.context === 'none') ctxFrom = last;
    else if (body.context === 'summary') { try { summary = await A.summarize(c, to, user.id); ctxFrom = last; } catch (e) { throw new HttpError(502, e.message || 'Não foi possível gerar o resumo.'); } }
    db.tx(() => { db.run("DELETE FROM members WHERE chat_id=? AND kind='ai'", c.id); addMember(c.id, 'ai', to.id); db.run('UPDATE chats SET title=?, ctx_from=?, ctx_summary=? WHERE id=?', to.name, ctxFrom, summary, c.id); });
    C.system(c.id, `IA alterada de ${from?.name || 'nenhuma'} para ${to.name}.${body.context === 'none' ? ' A nova IA começa sem o contexto anterior.' : body.context === 'summary' ? ' A nova IA recebeu um resumo da conversa.' : ''}`);
    refresh(c.id); return { chat: chatItem(c.id, user.id) };
  });

  // ---------- Mensagens ----------
  const cleanMentions = (c, list) => (Array.isArray(list) ? list : []).slice(0, 10).flatMap(m => {
    if (m?.kind === 'ai' && C.aiMember(c.id, m.id)) return [{ kind: 'ai', id: m.id, name: db.get('SELECT name FROM ais WHERE id=?', m.id).name }];
    if (m?.kind === 'user' && C.member(c.id, m.id)) return [{ kind: 'user', id: m.id, name: C.getUser(m.id).username }];
    return [];
  });
  R('GET', '/api/chats/:id/messages', ({ user, params, query }) => {
    const m = mem(params.id, user.id), before = +query.before || 1e12, lim = Math.min(+query.limit || 50, 100);
    const rows = db.all('SELECT * FROM messages WHERE chat_id=? AND seq<? AND seq>? ORDER BY seq DESC LIMIT ?', params.id, before, m.cleared_seq, lim).reverse();
    return { messages: rows.map(C.serializeMsg), more: rows.length === lim };
  });
  R('POST', '/api/chats/:id/messages', ({ user, params, body }) => {
    mem(params.id, user.id); const c = db.get('SELECT * FROM chats WHERE id=?', params.id);
    const rl = S.hit('msg:' + user.id, 40, 10000); need(rl.ok, 429, 'Você está enviando mensagens rápido demais.');
    if (c.type === 'group' && c.send_by === 'admins') need(C.isAdmin(c.id, user.id), 403, 'Somente administradores podem enviar mensagens neste grupo.');
    if (c.type === 'dm') { const o = C.chatUserIds(c.id).find(x => x !== user.id); need(!o || !isBlockedPair(user.id, o), 403, 'Não foi possível enviar a mensagem.'); }
    const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : ''; const files = [];
    for (const fid of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 10)) { const f = db.get('SELECT * FROM files WHERE id=? AND owner_id=?', fid, user.id); need(f && (!f.chat_id || f.chat_id === c.id), 400, 'Anexo inválido.'); db.run('UPDATE files SET chat_id=? WHERE id=?', c.id, f.id); files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size }); }
    need(text.trim() || files.length, 400, 'Mensagem vazia.');
    let replyTo = null; if (body.replyTo) { const r = db.get('SELECT id FROM messages WHERE id=? AND chat_id=?', body.replyTo, c.id); need(r, 400, 'Mensagem respondida não encontrada.'); replyTo = r.id; }
    const msg = C.addMessage({ chatId: c.id, kind: 'user', senderId: user.id, text, replyTo, attachments: files, mentions: cleanMentions(c, body.mentions), forwarded: !!body.forwarded });
    A.dispatch(c, msg, user.id); return { message: msg };
  });
  const msgFor = (id, uid) => { const m = db.get('SELECT * FROM messages WHERE id=?', id); need(m && C.member(m.chat_id, uid), 404, 'Mensagem não encontrada.'); return m; };
  const upd = id => { const m = C.serializeMsg(db.get('SELECT * FROM messages WHERE id=?', id)); C.emitChat(m.chatId, { t: 'msg.update', msg: m }); return m; };
  R('PATCH', '/api/messages/:id', ({ user, params, body }) => { const m = msgFor(params.id, user.id); need(m.kind === 'user' && m.sender_id === user.id && !m.deleted, 403, 'Você só pode editar suas próprias mensagens.'); const t = str(body.text, 20000, 1); need(t, 400, 'Texto vazio.'); db.run('UPDATE messages SET text=?, edited=? WHERE id=?', t, Date.now(), m.id); return { message: upd(m.id) }; });
  R('DELETE', '/api/messages/:id', ({ user, params }) => {
    const m = msgFor(params.id, user.id), ai = m.kind === 'ai' ? db.get('SELECT owner_id FROM ais WHERE id=?', m.sender_id) : null;
    need((m.kind === 'user' && m.sender_id === user.id) || (m.kind === 'ai' && (ai?.owner_id === user.id || C.isAdmin(m.chat_id, user.id))), 403, 'Você não pode apagar essa mensagem.');
    db.run("UPDATE messages SET deleted=1, text='', attachments='[]', pinned=0 WHERE id=?", m.id); return { message: upd(m.id) };
  });
  R('POST', '/api/messages/:id/react', ({ user, params, body }) => {
    const m = msgFor(params.id, user.id); const e = str(body.emoji, 16, 1); need(e && !m.deleted, 400, 'Reação inválida.');
    if (db.get('SELECT 1 FROM reactions WHERE msg_id=? AND user_id=? AND emoji=?', m.id, user.id, e)) db.run('DELETE FROM reactions WHERE msg_id=? AND user_id=? AND emoji=?', m.id, user.id, e);
    else db.run('INSERT INTO reactions VALUES(?,?,?)', m.id, user.id, e);
    return { message: upd(m.id) };
  });
  R('POST', '/api/messages/:id/pin', ({ user, params }) => { const m = msgFor(params.id, user.id); need(!m.deleted && m.kind !== 'system', 400, 'Não é possível fixar essa mensagem.'); db.run('UPDATE messages SET pinned=? WHERE id=?', m.pinned ? 0 : 1, m.id); upd(m.id); refresh(m.chat_id); return { ok: true }; });
  R('POST', '/api/messages/:id/stop', ({ user, params }) => { const m = msgFor(params.id, user.id); const ai = db.get('SELECT owner_id FROM ais WHERE id=?', m.sender_id); need(m.kind === 'ai' && (ai?.owner_id === user.id || C.isAdmin(m.chat_id, user.id) || db.get('SELECT type FROM chats WHERE id=?', m.chat_id).type !== 'group'), 403, 'Sem permissão.'); return { stopped: A.stop(m.id) }; });
  R('GET', '/api/search', ({ user, query }) => {
    const q = String(query.q || '').trim(); need(q.length >= 2, 400, 'Digite pelo menos 2 letras.');
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = db.all("SELECT m.* FROM messages m JOIN members mb ON mb.chat_id=m.chat_id AND mb.kind='user' AND mb.ref_id=? WHERE m.deleted=0 AND m.kind!='system' AND m.seq>mb.cleared_seq AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created DESC LIMIT 40", user.id, like);
    return { results: rows.map(C.serializeMsg) };
  });

  // ---------- Arquivos (acesso sempre autenticado, sem links permanentes) ----------
  R('POST', '/api/files', ({ user, query, raw }) => {
    const rl = S.hit('up:' + user.id, 30, 60000); need(rl.ok, 429, 'Muitos envios. Aguarde.');
    need(raw?.length, 400, 'Arquivo vazio.'); const name = (str(query.name, 120, 1) || 'arquivo').replace(/[\\/\0]/g, '_'); const mime = /^[a-z]+\/[\w.+-]+$/i.test(query.mime || '') ? query.mime.toLowerCase() : 'application/octet-stream';
    if (query.chat) mem(query.chat, user.id);
    const id = S.rid('f_'); fs.writeFileSync(C.filePath(id), raw); db.run('INSERT INTO files VALUES(?,?,?,?,?,?,?)', id, user.id, n(query.chat), name, mime, raw.length, Date.now());
    return { file: { id, name, mime, size: raw.length } };
  }, { raw: true });
  R('GET', '/api/files/:id', ({ user, params, req, res }) => {
    const f = C.canSeeFile(params.id, user.id); need(f, 404, 'Arquivo não encontrado.');
    const inline = /^(image\/(png|jpeg|gif|webp)|audio\/|video\/|application\/pdf)/.test(f.mime);
    const h = { 'content-type': f.mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'content-security-policy': "sandbox; default-src 'none'" };
    const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (rg) { const s = rg[1] ? +rg[1] : 0, e = rg[2] ? Math.min(+rg[2], f.size - 1) : f.size - 1; res.writeHead(206, { ...h, 'content-range': `bytes ${s}-${e}/${f.size}`, 'content-length': e - s + 1 }); fs.createReadStream(C.filePath(f.id), { start: s, end: e }).pipe(res); }
    else { res.writeHead(200, { ...h, 'content-length': f.size }); fs.createReadStream(C.filePath(f.id)).pipe(res); }
  });

  // Pré-visualização de link (com bloqueio de endereços internos)
  R('GET', '/api/preview', async ({ user, query }) => {
    const rl = S.hit('prev:' + user.id, 40, 60000); need(rl.ok, 429, 'Muitas pré-visualizações.');
    let u; try { u = new URL(query.url); } catch { throw new HttpError(400, 'Link inválido.'); } need(/^https?:$/.test(u.protocol), 400, 'Link inválido.');
    for (let hop = 0; hop < 3; hop++) {
      need(!P.privateHost(u.hostname), 400, 'Link não permitido.');
      if (!net.isIP(u.hostname)) { const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []); need(addrs.length && !addrs.some(a => P.privateHost(a.address)), 400, 'Link não permitido.'); }
      const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { 'user-agent': 'AIsConnectBot/1.0', accept: 'text/html' } }).catch(() => null); need(r, 502, 'Não foi possível abrir o link.');
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
      need(/text\/html/.test(r.headers.get('content-type') || ''), 400, 'Sem pré-visualização.');
      const reader = r.body.getReader(); let html = ''; const dec = new TextDecoder();
      while (html.length < 300000) { const { done, value } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; } reader.cancel().catch(() => {});
      const meta = p => (new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i').exec(html) || [])[1];
      const dec2 = s => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const title = dec2(meta('og:title') || (/<title[^>]*>([^<]*)/i.exec(html) || [])[1]);
      return { url: u.href, title: title?.slice(0, 140), description: dec2(meta('og:description') || meta('description'))?.slice(0, 220), site: dec2(meta('og:site_name')) || u.hostname };
    }
    throw new HttpError(400, 'Redirecionamentos demais.');
  });

  // ---------- IAs ----------
  R('GET', '/api/ais', ({ user }) => {
    const now = Date.now();
    const shared = db.all('SELECT s.*, a.id AS aid FROM shares s JOIN ais a ON a.id=s.ai_id AND a.deleted=0 WHERE s.revoked=0 AND s.expires>? AND (s.user_id=? OR s.chat_id IN (SELECT chat_id FROM members WHERE kind=\'user\' AND ref_id=?))', now, user.id, user.id)
      .map(s => ({ ...C.aiPublic(db.get('SELECT * FROM ais WHERE id=?', s.ai_id)), share: { id: s.id, expires: s.expires, chatId: s.chat_id, maxMessages: s.max_messages, usedMessages: s.used_messages, maxTokens: s.max_tokens, usedTokens: s.used_tokens }, ownerName: C.getUser(s.owner_id)?.username }));
    return { mine: db.all('SELECT * FROM ais WHERE owner_id=? AND deleted=0 ORDER BY created', user.id).map(aiOwnerView), shared };
  });
  const pickModel = (prov, list) => {
    const ok = list.filter(m => !/embed|tts|whisper|dall|image|moderation|audio|realtime|transcribe|guard|rerank/i.test(m));
    const prefs = { openrouter: [/llama-3\.3-70b.*:free$/, /gemini.*:free$/, /deepseek.*:free$/, /:free$/], gemini: [/gemini-2\.\d-flash$/, /flash/], openai: [/^gpt-4o-mini$/, /^gpt-4\.1-mini$/, /^gpt-/], anthropic: [/sonnet/, /haiku/] };
    for (const re of prefs[prov] || []) { const f = ok.find(m => re.test(m)); if (f) return f; }
    return ok[0];
  };
  R('POST', '/api/ais', async ({ user, body }) => {
    const prov = P.PROVIDERS[body.provider]; need(prov, 400, 'Provedor não suportado.');
    need(db.get('SELECT COUNT(*) c FROM ais WHERE owner_id=? AND deleted=0', user.id).c < 20, 400, 'Limite de 20 IAs conectadas.');
    const name = str(body.name, 30, 1) || prov.label.split(' ').pop(); need(name && !/[@\n]/.test(name), 400, 'Dê um nome à IA (até 30 caracteres, sem @).');
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''; need(key || body.provider === 'custom', 400, 'Cole a chave de API do provedor.');
    let model = str(body.model, 120, 1);
    if (!model) { try { model = pickModel(body.provider, await P.listModels({ provider: body.provider, base_url: body.baseUrl }, key)); } catch (e) { if (e.code === 'auth') throw new HttpError(400, e.message); } model ||= prov.defaultModel; }
    need(model, 400, 'Informe o modelo.');
    need(body.provider !== 'custom' || /^https?:\/\//.test(body.baseUrl || ''), 400, 'Informe a URL base (ex.: https://servidor/v1).');
    const id = S.rid('a_'); const t = body.temperature === '' || body.temperature == null ? null : Math.min(Math.max(+body.temperature, 0), 2);
    db.run('INSERT INTO ais(id,owner_id,name,provider,base_url,model,enc_key,key_hint,color,avatar,instructions,temperature,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, user.id, name, body.provider, body.provider === 'custom' ? body.baseUrl.trim() : null, model, key ? S.encrypt(key) : null, key ? '••••' + key.slice(-4) : '', /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#7c5cff', avatarOk(body.avatar), str(body.instructions, 4000) || '', Number.isNaN(t) ? null : t, Date.now());
    return { ai: aiOwnerView(db.get('SELECT * FROM ais WHERE id=?', id)) };
  });
  R('PATCH', '/api/ais/:id', ({ user, params, body }) => {
    const a = ownAI(params.id, user.id); const model = body.model !== undefined ? str(body.model, 120, 1) || a.model : a.model;
    const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null; const t = body.temperature === undefined ? a.temperature : (body.temperature === '' || body.temperature === null ? null : Math.min(Math.max(+body.temperature, 0), 2));
    db.run('UPDATE ais SET name=?, model=?, instructions=?, temperature=?, color=?, avatar=?, base_url=?, enc_key=?, key_hint=? WHERE id=?', body.name !== undefined ? (str(body.name, 30, 1) || a.name).replace(/@/g, '') : a.name, model, body.instructions !== undefined ? str(body.instructions, 4000) ?? '' : a.instructions, Number.isNaN(t) ? a.temperature : t, /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : a.color, body.avatar !== undefined ? avatarOk(body.avatar) : a.avatar, a.provider === 'custom' && body.baseUrl ? body.baseUrl : a.base_url, key ? S.encrypt(key) : a.enc_key, key ? '••••' + key.slice(-4) : a.key_hint, a.id);
    if (model !== a.model) for (const m of db.all("SELECT chat_id FROM members WHERE kind='ai' AND ref_id=?", a.id)) C.system(m.chat_id, `Modelo de ${a.name} alterado: ${a.model} → ${model}.`);
    for (const m of db.all("SELECT chat_id FROM members WHERE kind='ai' AND ref_id=?", a.id)) refresh(m.chat_id);
    return { ai: aiOwnerView(db.get('SELECT * FROM ais WHERE id=?', a.id)) };
  });
  R('DELETE', '/api/ais/:id', ({ user, params }) => {
    const a = ownAI(params.id, user.id); const chats = db.all("SELECT chat_id FROM members WHERE kind='ai' AND ref_id=?", a.id).map(r => r.chat_id);
    db.tx(() => { db.run("UPDATE ais SET deleted=1, enc_key=NULL, instructions='' WHERE id=?", a.id); db.run("DELETE FROM members WHERE kind='ai' AND ref_id=?", a.id); db.run('UPDATE shares SET revoked=1 WHERE ai_id=?', a.id); });
    for (const c of chats) { C.system(c, `${a.name} foi desconectada pelo dono.`); refresh(c); } return { ok: true };
  });
  const aiKey = a => { try { return a.enc_key ? S.decrypt(a.enc_key) : ''; } catch { return ''; } };
  R('POST', '/api/ais/:id/test', async ({ user, params }) => {
    const a = ownAI(params.id, user.id); const rl = S.hit('aitest:' + user.id, 20, 60000); need(rl.ok, 429, 'Muitos testes. Aguarde.');
    try { const models = await P.listModels(a, aiKey(a)); return { ok: true, models: models.length, modelFound: models.some(m => m === a.model) || !models.length }; }
    catch (e) { return { ok: false, code: e.code || 'request', error: e instanceof P.AIError ? e.message : 'Falha ao testar a conexão.' }; }
  });
  R('GET', '/api/ais/:id/models', async ({ user, params }) => {
    const a = ownAI(params.id, user.id);
    try { return { models: await P.listModels(a, aiKey(a)) }; } catch (e) { throw new HttpError(502, e instanceof P.AIError ? e.message : 'Não foi possível listar os modelos.'); }
  });
  R('GET', '/api/ais/:id/usage', ({ user, params }) => {
    const a = ownAI(params.id, user.id);
    return { usage: db.all('SELECT user_id, messages, tokens_in, tokens_out FROM usage WHERE ai_id=?', a.id).map(r => ({ ...r, username: C.getUser(r.user_id)?.username })), note: 'Tokens informados pelo provedor quando disponíveis; caso contrário, estimados.' };
  });
  // Conversas desta IA (menu ⋮): todos os chats do usuário em que a IA participa ou já respondeu.
  R('GET', '/api/ais/:id/chats', ({ user, params }) => {
    const a = db.get('SELECT * FROM ais WHERE id=?', params.id); need(a, 404, 'IA não encontrada.');
    const ids = db.all(`SELECT DISTINCT m.chat_id FROM members m WHERE m.kind='user' AND m.ref_id=? AND (m.chat_id IN (SELECT chat_id FROM members WHERE kind='ai' AND ref_id=?) OR m.chat_id IN (SELECT chat_id FROM messages WHERE kind='ai' AND sender_id=?))`, user.id, a.id, a.id).map(r => r.chat_id);
    const items = ids.map(id => chatItem(id, user.id)).filter(Boolean).sort((x, y) => (y.last?.createdAt || 0) - (x.last?.createdAt || 0));
    return { ai: C.aiPublic(a), chats: items };
  });
  R('POST', '/api/ais/:id/shares', ({ user, params, body }) => {
    const a = ownAI(params.id, user.id); const minutes = Math.min(Math.max(+body.minutes || 0, 1), 60 * 24 * 7); need(minutes, 400, 'Escolha a duração.');
    need(!!body.userId !== !!body.chatId, 400, 'Compartilhe com uma pessoa ou com um grupo.');
    if (body.chatId) { mem(body.chatId, user.id); need(C.aiMember(body.chatId, a.id), 400, 'A IA precisa estar no grupo para ser compartilhada com ele.'); }
    else need(C.getUser(body.userId) && body.userId !== user.id && !isBlockedPair(user.id, body.userId) && db.get("SELECT 1 FROM contacts WHERE user_id=? AND other_id=? AND status='accepted'", user.id, body.userId), 400, 'Escolha um dos seus contatos.');
    const lim = v => (v === '' || v == null || !(+v > 0)) ? null : Math.floor(+v);
    const id = S.rid('sh_'), exp = Date.now() + minutes * 60000;
    db.run('INSERT INTO shares(id,ai_id,owner_id,user_id,chat_id,expires,max_messages,max_tokens,models,allow_images,allow_files,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, a.id, user.id, n(body.userId), n(body.chatId), exp, lim(body.maxMessages), lim(body.maxTokens), JSON.stringify((Array.isArray(body.models) ? body.models : []).filter(x => typeof x === 'string').slice(0, 20)), body.allowImages === false ? 0 : 1, body.allowFiles === false ? 0 : 1, Date.now());
    const label = minutes >= 60 ? (minutes % 60 ? `${minutes} min` : `${minutes / 60} h`) : `${minutes} min`;
    if (body.chatId) { C.system(body.chatId, `${user.username} compartilhou ${a.name} com este grupo por ${label}. Use @${a.name} para falar com ela.`); refresh(body.chatId); }
    else hub.emit(body.userId, { t: 'share.new', aiId: a.id, text: `${user.username} compartilhou a IA ${a.name} com você por ${label}.` });
    return { share: { id, expires: exp } };
  });
  R('GET', '/api/ais/:id/shares', ({ user, params }) => {
    const a = ownAI(params.id, user.id);
    return { shares: db.all('SELECT * FROM shares WHERE ai_id=? ORDER BY created DESC LIMIT 30', a.id).map(s => ({ id: s.id, userId: s.user_id, username: s.user_id ? C.getUser(s.user_id)?.username : null, chatId: s.chat_id, chatTitle: s.chat_id ? db.get('SELECT title FROM chats WHERE id=?', s.chat_id)?.title : null, expires: s.expires, revoked: !!s.revoked, active: !s.revoked && s.expires > Date.now(), maxMessages: s.max_messages, usedMessages: s.used_messages, maxTokens: s.max_tokens, usedTokens: s.used_tokens })) };
  });
  R('DELETE', '/api/shares/:id', ({ user, params }) => {
    const s = db.get('SELECT * FROM shares WHERE id=? AND owner_id=?', params.id, user.id); need(s, 404, 'Compartilhamento não encontrado.');
    db.run('UPDATE shares SET revoked=1 WHERE id=?', s.id); const ev = { t: 'share.expired', id: s.id, aiId: s.ai_id, revoked: true };
    hub.emit(user.id, ev); if (s.user_id) hub.emit(s.user_id, ev); if (s.chat_id) { C.emitChat(s.chat_id, ev); C.system(s.chat_id, `${user.username} encerrou o compartilhamento de ${db.get('SELECT name FROM ais WHERE id=?', s.ai_id).name}.`); }
    return { ok: true };
  });

  // IAs conversam
  R('POST', '/api/chats/:id/auto', ({ user, params, body }) => { mem(params.id, user.id); const c = db.get('SELECT * FROM chats WHERE id=?', params.id); need(c.type !== 'ai', 400, 'Use um grupo com pelo menos duas IAs.'); const r = A.startAuto(c.id, user.id, body); need(r.ok, 400, r.reason); return { ok: true }; });
  R('DELETE', '/api/chats/:id/auto', ({ user, params }) => { mem(params.id, user.id); A.stopAuto(params.id); return { ok: true }; });

  // Conexão com um toque via OpenRouter (OAuth PKCE): o usuário autoriza no site e a chave vem direto para o servidor.
  const pending = new Map();
  const baseOf = req => `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}`;
  R('POST', '/api/oauth/openrouter/start', ({ user, req }) => {
    const verifier = S.token(48), challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
    pending.set(user.id, { verifier, exp: Date.now() + 600000 });
    const cb = baseOf(req) + '/oauth/openrouter';
    return { url: `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256` };
  });
  R('POST', '/api/oauth/openrouter/finish', async ({ user, body }) => {
    const p = pending.get(user.id); pending.delete(user.id); need(p && p.exp > Date.now() && typeof body.code === 'string', 400, 'A autorização expirou. Tente conectar de novo.');
    let key; try { const r = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: body.code, code_verifier: p.verifier, code_challenge_method: 'S256' }), signal: AbortSignal.timeout(15000) }); key = (await r.json()).key; } catch {}
    need(key, 502, 'Não foi possível concluir a conexão com o OpenRouter. Tente de novo.');
    let model; try { model = pickModel('openrouter', await P.listModels({ provider: 'openrouter' }, key)); } catch {} model ||= P.PROVIDERS.openrouter.defaultModel;
    const id = S.rid('a_'); db.run('INSERT INTO ais(id,owner_id,name,provider,model,enc_key,key_hint,color,instructions,created) VALUES(?,?,?,?,?,?,?,?,?,?)', id, user.id, 'OpenRouter', 'openrouter', model, S.encrypt(key), '••••' + key.slice(-4), '#7c5cff', '', Date.now());
    return { ai: aiOwnerView(db.get('SELECT * FROM ais WHERE id=?', id)) };
  });
};
