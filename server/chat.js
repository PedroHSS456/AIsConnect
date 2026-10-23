'use strict';
const fs = require('fs'), path = require('path');
const { rid } = require('./security');
const { capabilities } = require('./providers');

const n = x => x === undefined ? null : x;
const fmtNumber = d => `+AI ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
const pj = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

module.exports = function (db, hub, dataDir) {
  const C = {};
  C.fmtNumber = fmtNumber; C.pj = pj;

  C.userPublic = (u, viewerId) => {
    if (!u) return null;
    const pr = pj(u.privacy, {});
    const showOnline = pr.presence !== 'nobody';
    return { id: u.id, username: u.username, number: fmtNumber(u.number), avatar: u.avatar, bio: u.bio || '', online: showOnline && hub.online(u.id) };
  };
  C.getUser = id => db.get('SELECT * FROM users WHERE id=?', id);
  C.aiPublic = a => a && ({ id: a.id, ownerId: a.owner_id, name: a.name, provider: a.provider, model: a.model, color: a.color, avatar: a.avatar, caps: capabilities(a) });

  C.chatUserIds = chatId => db.all("SELECT ref_id FROM members WHERE chat_id=? AND kind='user'", chatId).map(r => r.ref_id);
  C.member = (chatId, uid) => db.get("SELECT * FROM members WHERE chat_id=? AND kind='user' AND ref_id=?", chatId, uid);
  C.aiMember = (chatId, aiId) => db.get("SELECT * FROM members WHERE chat_id=? AND kind='ai' AND ref_id=?", chatId, aiId);
  C.emitChat = (chatId, ev) => hub.emitMany(C.chatUserIds(chatId), ev);
  C.isAdmin = (chatId, uid) => { const m = C.member(chatId, uid); return !!m && (m.role === 'owner' || m.role === 'admin'); };

  C.nextSeq = chatId => (db.get('SELECT COALESCE(MAX(seq),0)+1 AS s FROM messages WHERE chat_id=?', chatId).s);

  C.serializeMsg = row => {
    if (!row) return null;
    const reactions = {};
    for (const r of db.all('SELECT user_id, emoji FROM reactions WHERE msg_id=?', row.id)) (reactions[r.emoji] ||= []).push(r.user_id);
    let reply = null;
    if (row.reply_to) { const r = db.get('SELECT id, kind, sender_id, text, deleted FROM messages WHERE id=?', row.reply_to); if (r) reply = { id: r.id, kind: r.kind, senderId: r.sender_id, text: r.deleted ? '' : (r.text || '').slice(0, 140), deleted: !!r.deleted }; }
    const deleted = !!row.deleted;
    return {
      id: row.id, chatId: row.chat_id, seq: row.seq, kind: row.kind, senderId: row.sender_id,
      text: deleted ? '' : row.text, replyTo: reply, attachments: deleted ? [] : pj(row.attachments, []), mentions: pj(row.mentions, []),
      reactions: deleted ? {} : reactions, createdAt: row.created, editedAt: row.edited, deleted, status: row.status,
      model: row.model, error: pj(row.error, null), forwarded: !!row.forwarded, pinned: !!row.pinned,
    };
  };

  C.addMessage = m => {
    const id = rid('m_'), seq = C.nextSeq(m.chatId), t = Date.now();
    db.run('INSERT INTO messages(id,chat_id,seq,kind,sender_id,text,reply_to,attachments,mentions,created,status,model,forwarded) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, m.chatId, seq, m.kind, n(m.senderId), m.text || '', n(m.replyTo), JSON.stringify(m.attachments || []), JSON.stringify(m.mentions || []), t, m.status || 'done', n(m.model), m.forwarded ? 1 : 0);
    const msg = C.serializeMsg(db.get('SELECT * FROM messages WHERE id=?', id));
    C.emitChat(m.chatId, { t: 'msg.new', msg });
    return msg;
  };
  C.system = (chatId, text) => C.addMessage({ chatId, kind: 'system', text });

  C.chatAIs = (chatId, uid) => {
    const rows = db.all(`SELECT DISTINCT a.* FROM ais a WHERE a.id IN (SELECT ref_id FROM members WHERE chat_id=? AND kind='ai')
      OR a.id IN (SELECT sender_id FROM messages WHERE chat_id=? AND kind='ai')`, chatId, chatId);
    return rows.map(a => ({ ...C.aiPublic(a), member: !!C.aiMember(chatId, a.id), usable: C.authorizeAI(a.id, uid, chatId).ok }));
  };

  // Regra central: dono usa sempre; terceiros só com compartilhamento ativo (usuário ou chat), dentro dos limites.
  C.authorizeAI = (aiId, uid, chatId, { needImages = false, needFiles = false } = {}) => {
    const ai = db.get('SELECT * FROM ais WHERE id=?', aiId);
    if (!ai) return { ok: false, reason: 'IA não encontrada.' };
    if (ai.owner_id === uid) return { ok: true, ai, owner: true };
    const now = Date.now();
    const shares = db.all('SELECT * FROM shares WHERE ai_id=? AND revoked=0 AND expires>? AND (user_id=? OR chat_id=?)', aiId, now, uid, n(chatId));
    let why = 'Você não tem autorização para usar essa IA.';
    for (const s of shares) {
      if (s.chat_id && s.chat_id !== chatId) continue;
      if (s.chat_id && !C.member(s.chat_id, uid)) continue;
      if (s.max_messages != null && s.used_messages >= s.max_messages) { why = 'O limite de mensagens desse compartilhamento acabou.'; continue; }
      if (s.max_tokens != null && s.used_tokens >= s.max_tokens) { why = 'O limite de tokens desse compartilhamento acabou.'; continue; }
      const models = pj(s.models, []);
      if (models.length && !models.includes(ai.model)) { why = 'O modelo atual dessa IA não está liberado no compartilhamento.'; continue; }
      if (needImages && !s.allow_images) { why = 'Este compartilhamento não permite imagens.'; continue; }
      if (needFiles && !s.allow_files) { why = 'Este compartilhamento não permite arquivos.'; continue; }
      return { ok: true, ai, share: s };
    }
    return { ok: false, reason: why };
  };

  C.chatDetail = (chatId, uid) => {
    const c = db.get('SELECT * FROM chats WHERE id=?', chatId); if (!c) return null;
    const me = C.member(chatId, uid); if (!me) return null;
    const members = db.all("SELECT * FROM members WHERE chat_id=? AND kind='user'", chatId).map(m => {
      const u = C.getUser(m.ref_id); const pr = pj(u.privacy, {});
      return { ...C.userPublic(u), role: m.role, deliveredSeq: m.delivered_seq, readSeq: pr.receipts === false ? 0 : m.read_seq };
    });
    const now = Date.now();
    const shares = db.all('SELECT * FROM shares WHERE revoked=0 AND expires>? AND (chat_id=? OR (ai_id IN (SELECT id FROM ais WHERE owner_id=?) AND ai_id IN (SELECT ref_id FROM members WHERE chat_id=? AND kind=\'ai\')) OR user_id=?)', now, chatId, uid, chatId, uid)
      .map(s => ({ id: s.id, aiId: s.ai_id, ownerId: s.owner_id, userId: s.user_id, chatId: s.chat_id, expires: s.expires, maxMessages: s.max_messages, usedMessages: s.used_messages, maxTokens: s.max_tokens, usedTokens: s.used_tokens }));
    return {
      id: c.id, type: c.type, title: c.title, description: c.description, avatar: c.avatar, createdBy: c.created_by, sendBy: c.send_by,
      auto: pj(c.auto, null), members, ais: C.chatAIs(chatId, uid), shares,
      me: { role: me.role, pinned: !!me.pinned, muted: !!me.muted, archived: !!me.archived, readSeq: me.read_seq },
      pins: db.all('SELECT id FROM messages WHERE chat_id=? AND pinned=1 AND deleted=0 ORDER BY seq', chatId).map(r => r.id),
      ctx: { from: c.ctx_from, hasSummary: !!c.ctx_summary },
    };
  };

  C.chatListItem = (chatId, uid) => {
    const d = C.chatDetail(chatId, uid); if (!d) return null;
    const me = C.member(chatId, uid);
    const last = db.get('SELECT * FROM messages WHERE chat_id=? AND seq>? ORDER BY seq DESC LIMIT 1', chatId, me.cleared_seq);
    const unread = db.get("SELECT COUNT(*) AS c FROM messages WHERE chat_id=? AND seq>? AND seq>? AND deleted=0 AND kind!='system' AND NOT(kind='user' AND sender_id=?)", chatId, me.read_seq, me.cleared_seq, uid).c;
    d.last = last ? C.serializeMsg(last) : null; d.unread = unread; d.clearedSeq = me.cleared_seq;
    return d;
  };

  C.filePath = id => path.join(dataDir, 'files', id);
  C.canSeeFile = (fileId, uid) => {
    const f = db.get('SELECT * FROM files WHERE id=?', fileId); if (!f) return null;
    if (f.owner_id === uid || (f.chat_id && C.member(f.chat_id, uid))) return f;
    return null;
  };
  C.readFileB64 = id => { try { return fs.readFileSync(C.filePath(id)).toString('base64'); } catch { return null; } };
  C.readFileText = id => { try { return fs.readFileSync(C.filePath(id), 'utf8').slice(0, 20000); } catch { return ''; } };
  return C;
};
