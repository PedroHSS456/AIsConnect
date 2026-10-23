'use strict';
const { decrypt } = require('./security');
const P = require('./providers');

module.exports = function (db, hub, C) {
  const A = {}; const running = new Map(); // msgId -> AbortController
  const TEXT_RE = /^(text\/|application\/(json|xml|javascript|x-sh|sql))|\.(md|txt|csv|json|js|ts|py|lua|luau|html|css|java|c|cpp|cs|go|rs|sh|yml|yaml|xml|sql|log)$/i;
  const esc = s => String(s);

  // Monta o histórico completo da conversa para a IA atual. Trocar de IA não apaga nada.
  A.buildContext = (chat, ai, requesterId, share) => {
    const rows = db.all("SELECT * FROM messages WHERE chat_id=? AND seq>? AND deleted=0 AND kind IN ('user','ai') AND status IN ('done','stopped') AND (text!='' OR attachments!='[]') ORDER BY seq", chat.id, chat.ctx_from || 0);
    const group = chat.type !== 'ai' || db.get("SELECT COUNT(*) c FROM members WHERE chat_id=? AND kind='user'", chat.id).c > 1;
    const nameOf = (m) => m.kind === 'ai' ? (db.get('SELECT name FROM ais WHERE id=?', m.sender_id)?.name || 'IA') + ' (IA)' : (C.getUser(m.sender_id)?.username || 'usuário');
    const caps = P.capabilities(ai); const msgs = [];
    for (const m of rows) {
      const mine = m.kind === 'ai' && m.sender_id === ai.id;
      let text = m.text || ''; const images = [];
      for (const a of C.pj(m.attachments, [])) {
        if (/^image\//.test(a.mime) && caps.images && (!share || share.allow_images) && a.size < 5e6) { const b = C.readFileB64(a.id); if (b) images.push({ mime: a.mime, b64: b }); }
        else if (TEXT_RE.test(a.mime) || TEXT_RE.test(a.name)) { if (!share || share.allow_files) text += `\n\n[Arquivo: ${a.name}]\n${C.readFileText(a.id)}`; }
        else text += `\n\n[Arquivo anexado: ${a.name}]`;
      }
      const role = mine ? 'assistant' : 'user';
      if (!mine && (group || m.kind === 'ai')) text = `${nameOf(m)}: ${text}`;
      const last = msgs[msgs.length - 1];
      if (last && last.role === role) { last.text += '\n\n' + text; last.images.push(...images); } else msgs.push({ role, text, images });
    }
    if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', text: '(início da conversa)', images: [] });
    if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', text: 'Continue.', images: [] });
    const people = db.all("SELECT ref_id FROM members WHERE chat_id=? AND kind='user'", chat.id).map(r => C.getUser(r.ref_id)?.username).filter(Boolean);
    const others = db.all("SELECT ref_id FROM members WHERE chat_id=? AND kind='ai' AND ref_id!=?", chat.id, ai.id).map(r => db.get('SELECT name FROM ais WHERE id=?', r.ref_id)?.name).filter(Boolean);
    let system = `Você é ${ai.name}, uma IA participante de uma conversa no AIsConnect (mensageiro com pessoas e IAs).`;
    if (group) system += ` Pessoas na conversa: ${people.join(', ')}.` + (others.length ? ` Outras IAs: ${others.join(', ')}.` : '') + ' As mensagens aparecem como "nome: texto". Responda apenas como você mesma, sem prefixar seu nome.';
    if (chat.ctx_summary) system += `\n\nResumo da conversa até aqui (gerado ao trocar de IA):\n${chat.ctx_summary}`;
    if (ai.instructions) system += `\n\nInstruções do dono desta IA:\n${ai.instructions}`;
    return { system, messages: msgs };
  };

  function account(ai, requesterId, share, usage, textLen) {
    const tin = usage?.in ?? 0, tout = usage?.out ?? Math.ceil(textLen / 4);
    db.run('INSERT INTO usage(ai_id,user_id,messages,tokens_in,tokens_out) VALUES(?,?,1,?,?) ON CONFLICT(ai_id,user_id) DO UPDATE SET messages=messages+1, tokens_in=tokens_in+excluded.tokens_in, tokens_out=tokens_out+excluded.tokens_out', ai.id, requesterId, tin, tout);
    if (share) db.run('UPDATE shares SET used_messages=used_messages+1, used_tokens=used_tokens+? WHERE id=?', tin + tout, share.id);
  }

  // Gera uma resposta real, com streaming, e a publica no chat para todos os participantes.
  A.run = async (chatId, aiId, requesterId, { autoMeta } = {}) => {
    const chat = db.get('SELECT * FROM chats WHERE id=?', chatId);
    const auth = C.authorizeAI(aiId, requesterId, chatId);
    const ai = auth.ai;
    if (!chat || !auth.ok) return { ok: false, reason: auth.reason };
    const msg0 = C.addMessage({ chatId, kind: 'ai', senderId: aiId, text: '', status: 'streaming', model: ai.model });
    const ctl = new AbortController(); running.set(msg0.id, { ctl, requesterId });
    let text = '', usage = null, error = null, flushed = 0, timer = null, status = 'done';
    const flush = () => { timer = null; if (text.length > flushed) { C.emitChat(chatId, { t: 'msg.delta', chatId, id: msg0.id, delta: text.slice(flushed) }); flushed = text.length; } };
    try {
      if (!ai.enc_key) throw new P.AIError('auth', 'Esta IA não tem chave de API configurada.');
      const ctx = A.buildContext(chat, ai, requesterId, auth.share);
      for await (const ev of P.stream(ai, decrypt(ai.enc_key), ctx.system, ctx.messages, ctl.signal)) {
        if (ev.text) { text += ev.text; if (!timer) timer = setTimeout(flush, 40); }
        if (ev.usage) usage = ev.usage;
      }
      if (!text.trim()) throw new P.AIError('empty', 'O modelo não devolveu texto.');
    } catch (e) {
      if (e.name === 'AbortError') status = 'stopped';
      else { status = 'error'; error = { code: e.code || 'request', message: e instanceof P.AIError ? e.message : 'Erro inesperado ao falar com a IA.' }; if (!(e instanceof P.AIError)) console.error('[ai]', e.message); }
    }
    if (timer) clearTimeout(timer);
    running.delete(msg0.id);
    db.run('UPDATE messages SET text=?, status=?, error=? WHERE id=?', text, status, error ? JSON.stringify(error) : null, msg0.id);
    if (status !== 'error' || text) account(ai, requesterId, auth.share, usage, text.length);
    C.emitChat(chatId, { t: 'msg.done', msg: C.serializeMsg(db.get('SELECT * FROM messages WHERE id=?', msg0.id)) });
    return { ok: status !== 'error', status, error, id: msg0.id };
  };
  A.stop = (msgId, uid) => { const r = running.get(msgId); if (r) { r.ctl.abort(); return true; } return false; };
  A.stopChat = chatId => { for (const [id, r] of running) if (db.get('SELECT chat_id FROM messages WHERE id=?', id)?.chat_id === chatId) r.ctl.abort(); };

  // Decide quais IAs respondem a uma mensagem nova.
  A.dispatch = (chat, msg, senderId) => {
    const targets = new Set();
    if (chat.type === 'ai') { const m = db.get("SELECT ref_id FROM members WHERE chat_id=? AND kind='ai'", chat.id); if (m) targets.add(m.ref_id); }
    else for (const mn of msg.mentions) if (mn.kind === 'ai' && C.aiMember(chat.id, mn.id)) targets.add(mn.id);
    for (const aiId of targets) {
      const auth = C.authorizeAI(aiId, senderId, chat.id);
      if (!auth.ok) { hub.emit(senderId, { t: 'notice', chatId: chat.id, level: 'warn', text: `${db.get('SELECT name FROM ais WHERE id=?', aiId)?.name || 'A IA'} não respondeu: ${auth.reason}` }); continue; }
      A.run(chat.id, aiId, senderId).catch(e => console.error('[dispatch]', e.message));
    }
  };

  // Resumo para continuar a conversa em outro modelo sem enviar o histórico inteiro.
  A.summarize = async (chat, ai, requesterId) => {
    const auth = C.authorizeAI(ai.id, requesterId, chat.id); if (!auth.ok) throw new P.AIError('auth', auth.reason);
    const ctx = A.buildContext({ ...chat, ctx_summary: null }, ai, requesterId, auth.share);
    ctx.messages.push({ role: 'user', text: 'Resuma de forma fiel e objetiva toda a conversa acima (decisões, fatos, pendências e tom), para que outra IA possa continuar de onde paramos.', images: [] });
    ctx.messages = ctx.messages.reduce((a, m) => { const l = a[a.length - 1]; if (l && l.role === m.role) { l.text += '\n\n' + m.text; } else a.push(m); return a; }, []);
    let out = ''; for await (const ev of P.stream(ai, decrypt(ai.enc_key), ctx.system, ctx.messages)) if (ev.text) out += ev.text;
    return out.trim();
  };

  // IAs conversam: loop controlado no servidor, com limites e botão de parar.
  const setAuto = (chatId, patch) => {
    const c = db.get('SELECT auto FROM chats WHERE id=?', chatId); const cur = { ...C.pj(c?.auto, {}), ...patch };
    db.run('UPDATE chats SET auto=? WHERE id=?', JSON.stringify(cur), chatId);
    C.emitChat(chatId, { t: 'auto', chatId, auto: cur }); return cur;
  };
  A.startAuto = (chatId, starterId, o) => {
    const cur = C.pj(db.get('SELECT auto FROM chats WHERE id=?', chatId)?.auto, null);
    if (cur?.active) return { ok: false, reason: 'Já existe uma conversa automática ativa.' };
    const aiIds = o.aiIds.filter(id => C.aiMember(chatId, id));
    if (aiIds.length < 2) return { ok: false, reason: 'Escolha pelo menos duas IAs que estejam na conversa.' };
    for (const id of aiIds) { const a = C.authorizeAI(id, starterId, chatId); if (!a.ok) return { ok: false, reason: `${db.get('SELECT name FROM ais WHERE id=?', id)?.name}: ${a.reason}` }; }
    const rounds = Math.min(Math.max(+o.rounds || 3, 1), 20), maxMessages = Math.min(Math.max(+o.maxMessages || rounds * aiIds.length, 1), 100);
    const deadline = Date.now() + Math.min(Math.max(+o.maxMinutes || 10, 1), 60) * 60000;
    if (o.topic) C.addMessage({ chatId, kind: 'user', senderId: starterId, text: String(o.topic).slice(0, 4000) });
    const order = o.startAiId && aiIds.includes(o.startAiId) ? [o.startAiId, ...aiIds.filter(x => x !== o.startAiId)] : aiIds;
    setAuto(chatId, { active: true, aiIds: order, rounds, maxMessages, deadline, count: 0, starter: starterId, reason: null, startedAt: Date.now() });
    C.system(chatId, `Conversa automática entre IAs iniciada: ${rounds} rodada(s), até ${maxMessages} mensagens.`);
    (async () => {
      let reason = 'limite de rodadas atingido', i = 0;
      for (;;) {
        const st = C.pj(db.get('SELECT auto FROM chats WHERE id=?', chatId)?.auto, null);
        if (!st?.active) { reason = 'interrompida'; break; }
        if (st.count >= st.maxMessages || i >= st.rounds * order.length) { reason = st.count >= st.maxMessages ? 'limite de mensagens atingido' : 'limite de rodadas atingido'; break; }
        if (Date.now() > st.deadline) { reason = 'tempo máximo atingido'; break; }
        const r = await A.run(chatId, order[i % order.length], starterId);
        i++;
        if (!r.ok) { reason = r.status === 'stopped' ? 'interrompida' : (r.reason || r.error?.message || 'erro em uma das IAs'); break; }
        setAuto(chatId, { count: st.count + 1 }); await new Promise(r => setTimeout(r, 500));
      }
      setAuto(chatId, { active: false, reason });
      C.system(chatId, `Conversa automática encerrada (${reason}). Você pode iniciar novas rodadas quando quiser.`);
    })().catch(e => { console.error('[auto]', e); setAuto(chatId, { active: false, reason: 'erro' }); });
    return { ok: true };
  };
  A.stopAuto = chatId => { setAuto(chatId, { active: false, reason: 'interrompida' }); A.stopChat(chatId); };

  // Expira compartilhamentos e avisa os envolvidos.
  setInterval(() => {
    const now = Date.now();
    for (const s of db.all('SELECT * FROM shares WHERE revoked=0 AND expires<=? AND expires>?', now, now - 6000)) {
      const ev = { t: 'share.expired', id: s.id, aiId: s.ai_id };
      hub.emit(s.owner_id, ev); if (s.user_id) hub.emit(s.user_id, ev); if (s.chat_id) C.emitChat(s.chat_id, ev);
    }
  }, 3000).unref();
  return A;
};
