'use strict';
// Tela da conversa: cabeçalho, mensagens, composer, menções, anexos, voz e ações.
(() => {
const S = AIS.state; let R = {}; const drafts = new Map(), previews = new Map();
let reply = null, editing = null, pending = [], mentions = [], rec = null, lastTyping = 0, popIdx = 0, popItems = [];
const chat = () => S.chats.get(S.active);
const isMine = m => m.kind === 'user' && m.senderId === S.me.id;
const coarse = matchMedia('(pointer:coarse)').matches;
const atBottom = () => R.msgs && R.msgs.scrollHeight - R.msgs.scrollTop - R.msgs.clientHeight < 140;
const toBottom = (smooth) => { if (R.msgs) { R.msgs.style.scrollBehavior = smooth ? 'smooth' : 'auto'; R.msgs.scrollTop = R.msgs.scrollHeight; } };

AIS.openChat = async (id, force) => {
  const c = S.chats.get(id); if (!c) return;
  if (S.active && R.input) drafts.set(S.active, R.input.value);
  S.active = id; reply = null; editing = null; pending = []; mentions = [];
  $('#app').classList.add('chat-open'); if (!force && history.state?.chat !== id) history.pushState({ chat: id }, '');
  build(c); AIS.renderList();
  if (!S.msgs.has(id) || force) {
    R.msgs.innerHTML = '<div class="empty">Carregando mensagens…</div>';
    try { const r = await api('GET', `/api/chats/${id}/messages?limit=60`); S.msgs.set(id, r.messages); S.more.set(id, r.more); } catch (e) { return fail(e); }
  }
  if (S.active !== id) return; renderMsgs(true); markRead(); R.input.focus({ preventScroll: true });
};
addEventListener('popstate', e => { if (S.active && !e.state?.chat) { S.active = null; AIS.showPlaceholder(); AIS.renderList(); } });
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && markRead());

function build(c) {
  const main = $('#main'); main.replaceChildren();
  R = {};
  R.hdr = h('div', { class: 'ch' }); R.ban = h('div'); R.pin = h('div'); R.msgs = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  R.msgs.addEventListener('scroll', async () => { if (R.msgs.scrollTop < 40 && S.more.get(S.active) && !R.loadingMore) { R.loadingMore = true; const arr = S.msgs.get(S.active), first = arr[0]; try { const r = await api('GET', `/api/chats/${S.active}/messages?before=${first.seq}&limit=50`); const prevH = R.msgs.scrollHeight; S.msgs.set(S.active, [...r.messages, ...arr]); S.more.set(S.active, r.more); renderMsgs(false); R.msgs.scrollTop = R.msgs.scrollHeight - prevH; } catch {} R.loadingMore = false; } });
  R.comp = h('div', { class: 'comp' });
  R.reply = h('div'); R.tray = h('div');
  R.input = h('textarea', { rows: 1, placeholder: c.type === 'ai' ? `Mensagem para ${AIS.chatTitle(c)}` : c.type === 'group' ? 'Mensagem (use @ para mencionar)' : 'Mensagem', 'aria-label': 'Mensagem', maxlength: 20000 });
  R.attach = h('input', { type: 'file', multiple: true, class: 'hidden' }); R.attach.onchange = () => { [...R.attach.files].forEach(addFile); R.attach.value = ''; };
  R.send = h('button', { class: 'ib send', 'aria-label': 'Enviar', html: ic('send'), onclick: send }); R.mic = h('button', { class: 'ib', 'aria-label': 'Gravar mensagem de voz', html: ic('mic'), onclick: recToggle });
  R.pop = h('div', { class: 'pop hidden' }); R.emo = h('div', { class: 'pop emojis hidden' });
  const emojis = '😀😁😂🤣😊😍😘😎🤔😅😭😡👍👎👏🙏💪🔥✨🎉❤️💙💜🤖🧠👀✅❌⭐🚀💡📌📎🎵☕🍕🎮😴🙄😮😢🤝👋🙌💯'.match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu);
  emojis.forEach(e => R.emo.append(h('button', { type: 'button', onclick: () => insertAtCaret(e) }, e)));
  R.comp.append(R.pop, R.emo, R.reply, R.tray, h('div', { class: 'bar' }, [h('button', { class: 'ib', 'aria-label': 'Emojis', html: ic('smile'), onclick: () => R.emo.classList.toggle('hidden') }), h('button', { class: 'ib', 'aria-label': 'Anexar arquivo', html: ic('clip'), onclick: () => R.attach.click() }), R.input, R.send, R.mic, R.attach]));
  R.input.value = drafts.get(c.id) || ''; fit(); updateSend();
  R.input.addEventListener('input', () => { fit(); updateSend(); mentionCheck(); if (Date.now() - lastTyping > 2500 && R.input.value) { lastTyping = Date.now(); AIS.send({ t: 'typing', chatId: S.active }); } });
  R.input.addEventListener('keydown', onKey);
  R.input.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); fs.forEach(addFile); } });
  main.addEventListener('dragover', e => e.preventDefault()); main.addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].forEach(addFile); });
  main.append(R.hdr, R.ban, R.pin, R.msgs, R.comp);
  renderHeader(); renderBanners(); renderPin(); renderReply(); renderTray();
}
const fit = () => { R.input.style.height = 'auto'; R.input.style.height = Math.min(R.input.scrollHeight, 150) + 'px'; };
const updateSend = () => { const has = R.input.value.trim() || pending.length; R.send.classList.toggle('hidden', !has && !editing); R.mic.classList.toggle('hidden', !!has || !!editing || !navigator.mediaDevices?.getUserMedia); };
function insertAtCaret(t) { const i = R.input, s = i.selectionStart; i.value = i.value.slice(0, s) + t + i.value.slice(i.selectionEnd); i.selectionStart = i.selectionEnd = s + t.length; i.focus(); fit(); updateSend(); }

// ---------- Cabeçalho, banners, fixadas ----------
function subtitle(c) {
  const ty = Object.keys(S.typing[c.id] || {}); const streaming = (S.msgs.get(c.id) || []).filter(m => m.status === 'streaming');
  if (streaming.length) return { t: [...new Set(streaming.map(m => AIS.aiById(c, m.senderId)?.name))].join(', ') + ' está escrevendo…', typing: true };
  if (ty.length) return { t: ty.map(id => AIS.userById(c, id)?.username).join(', ') + ' está digitando…', typing: true };
  if (c.auto?.active) return { t: 'IAs conversando…', typing: true };
  if (c.type === 'ai') { const a = AIS.currentAI(c); return { t: a ? `${AIS.PROVIDERS[a.provider]?.label || a.provider} · ${a.model}` : 'Sem IA conectada' }; }
  if (c.type === 'dm') return { t: AIS.other(c)?.online ? 'online' : '' };
  return { t: [...c.members.map(m => m.id === S.me.id ? 'Você' : m.username), ...c.ais.filter(a => a.member).map(a => a.name + ' (IA)')].join(', ') };
}
function renderHeader() {
  const c = chat(); if (!c || !R.hdr) return; const ent = AIS.chatEntity(c), s = subtitle(c);
  R.hdr.replaceChildren(h('button', { class: 'ib back', 'aria-label': 'Voltar', html: ic('back'), onclick: () => history.state?.chat ? history.back() : (S.active = null, AIS.showPlaceholder(), AIS.renderList()) }),
    h('div', { class: 'row grow', style: 'cursor:pointer', onclick: () => AIS.ui.chatInfo(c), html: `${av(ent, { ai: c.type === 'ai' })}<div class="grow"><div class="t ellipsis">${esc(AIS.chatTitle(c))} ${c.type === 'ai' ? '<span class="badge ai">IA</span>' : ''}</div><div class="s ellipsis ${s.typing ? 'typing' : ''}">${esc(s.t)}</div></div>` }),
    c.type !== 'ai' ? h('button', { class: 'ib', 'aria-label': 'Chamada de vídeo', title: 'Chamada de vídeo', html: ic('video'), onclick: () => CALLS.start(c.id, true) }) : null,
    c.type !== 'ai' ? h('button', { class: 'ib', 'aria-label': 'Chamada de voz', title: 'Chamada de voz', html: ic('phone'), onclick: () => CALLS.start(c.id, false) }) : null,
    h('button', { class: 'ib', 'aria-label': 'Mais opções', title: 'Mais opções', html: ic('more'), onclick: e => menuAt(e.currentTarget, AIS.chatMenuItems(c)) }));
}
let bt; function renderBanners() {
  const c = chat(); if (!c || !R.ban) return; clearInterval(bt); R.ban.replaceChildren();
  const call = S.ongoing.get(c.id); if (call && !document.getElementById('callui')) R.ban.append(h('div', { class: 'banner' }, [h('span', { class: 'grow', html: `<b>Chamada ${call.video ? 'de vídeo ' : ''}em andamento</b>` }), h('button', { class: 'btn sm primary', onclick: () => CALLS.join(c.id) }, 'Entrar')]));
  if (c.auto?.active) R.ban.append(h('div', { class: 'banner' }, [h('span', { class: 'grow', html: `${ic('bot')} <b>IAs conversam</b> · ${c.auto.count || 0}/${c.auto.maxMessages} mensagens · ${c.auto.rounds} rodada(s)` }), h('button', { class: 'btn sm danger', onclick: () => api('DELETE', `/api/chats/${c.id}/auto`).catch(fail) }, 'Parar conversa')]));
  const sh = c.shares.filter(s => s.expires > Date.now() && (s.chatId === c.id || s.userId === S.me.id || s.ownerId === S.me.id));
  const ticks = [];
  for (const s of sh) {
    const ai = AIS.aiById(c, s.aiId); if (!ai) continue; const mineOwner = s.ownerId === S.me.id; const span = h('span', { class: 'grow' });
    const upd = () => { const left = s.expires - Date.now(); span.innerHTML = `${ic('share')} <b>${esc(ai.name)}</b> compartilhada${mineOwner ? ' por você' : ' com você'}${s.chatId ? ' (grupo)' : ''} · expira em ${fmtCount(left)}${s.maxMessages ? ` · ${s.usedMessages}/${s.maxMessages} msgs` : ''}`; if (left <= 0) AIS.refreshChat(c.id); };
    upd(); ticks.push(upd);
    R.ban.append(h('div', { class: 'banner' }, [span, mineOwner ? h('button', { class: 'btn sm danger', onclick: () => api('DELETE', `/api/shares/${s.id}`).catch(fail) }, 'Revogar') : null]));
  }
  if (ticks.length) bt = setInterval(() => ticks.forEach(f => f()), 1000);
}
function renderPin() {
  const c = chat(); if (!c || !R.pin) return; R.pin.replaceChildren(); const arr = S.msgs.get(c.id) || [];
  const m = c.pins.map(id => arr.find(x => x.id === id)).filter(Boolean).pop(); if (!m) return;
  R.pin.append(h('div', { class: 'pinbar', onclick: () => R.msgs.querySelector(`[data-id="${m.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), html: `${ic('pin')}<span class="ellipsis grow"><b>Fixada:</b> ${esc((m.text || '📎 anexo').slice(0, 120))}</span>` }));
}

// ---------- Mensagens ----------
function tickState(c, m) { const o = c.members.filter(x => x.id !== S.me.id); if (!o.length) return 'sent'; if (o.every(x => x.readSeq >= m.seq)) return 'read'; if (o.every(x => x.deliveredSeq >= m.seq)) return 'delivered'; return 'sent'; }
const tickHTML = t => `<span class="tick ${t === 'read' ? 'read' : ''}" title="${t === 'sent' ? 'Enviada' : t === 'delivered' ? 'Entregue' : 'Vista'}">${ic(t === 'sent' ? 'check' : 'check2')}</span>`;
function senderInfo(c, m) {
  if (m.kind === 'ai') { const a = AIS.aiById(c, m.senderId); return { name: a?.name || 'IA', ent: a || { name: 'IA' }, ai: true, a }; }
  const u = AIS.userById(c, m.senderId); return { name: u?.username || 'Usuário removido', ent: u || { name: '?' }, ai: false };
}
function msgEl(m, prev, c) {
  if (m.kind === 'system') return h('div', { class: 'sys', 'data-id': m.id }, m.text);
  const mine = isMine(m), si = senderInfo(c, m), group = c.type === 'group';
  const cont = prev && prev.kind !== 'system' && prev.senderId === m.senderId && prev.kind === m.kind && m.createdAt - prev.createdAt < 120000 && sameDay(prev.createdAt, m.createdAt);
  const row = h('div', { class: `mrow ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}`, 'data-id': m.id, 'data-seq': m.seq });
  if (!mine) row.append(h('div', { class: 'avs', html: !cont && (group || si.ai) ? av(si.ent, { cls: 'sm', ai: si.ai }) : '' }));
  const bub = h('div', { class: `bub ${si.ai ? 'isai' : ''} ${m.deleted ? 'del' : ''}` }); row.append(bub);
  fillBubble(bub, m, c, si, mine, group);
  const onMenu = e => { e.preventDefault(); msgMenu(e.clientX, e.clientY, c, m); };
  bub.addEventListener('contextmenu', onMenu);
  let lp; bub.addEventListener('touchstart', e => { lp = setTimeout(() => { const t = e.touches[0]; msgMenu(t.clientX, t.clientY, c, m); }, 520); }, { passive: true }); ['touchend', 'touchmove', 'touchcancel'].forEach(ev => bub.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
  bub.append(h('button', { class: 'act', 'aria-label': 'Ações da mensagem', html: ic('more'), onclick: e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); msgMenu(r.left, r.bottom, c, m); } }));
  return row;
}
function fillBubble(bub, m, c, si, mine, group) {
  const parts = [];
  if ((group && !mine) || si.ai) parts.push(h('div', { class: 'who', style: si.ai ? 'color:var(--ai)' : `color:hsl(${hue(si.name)} 55% 45%)`, html: `${esc(si.name)}${si.ai ? ' <span class="badge ai">IA</span>' : ''}${si.ai && m.model ? `<span class="model muted">${esc(m.model)}</span>` : ''}` }));
  if (m.forwarded) parts.push(h('div', { class: 'fwd', html: ic('fwd').replace('class="i "', 'class="i" style="width:12px;height:12px"') + ' Encaminhada' }));
  if (m.replyTo) parts.push(h('div', { class: 'rq', onclick: () => R.msgs.querySelector(`[data-id="${m.replyTo.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), html: `<b>${esc(m.replyTo.kind === 'ai' ? AIS.aiById(c, m.replyTo.senderId)?.name || 'IA' : (AIS.userById(c, m.replyTo.senderId)?.username || 'Usuário'))}</b><span>${esc(m.replyTo.deleted ? 'Mensagem apagada' : m.replyTo.text || '📎 Anexo')}</span>` }));
  if (m.deleted) parts.push(h('div', { class: 'txt', html: `${ic('x').replace('class="i "', 'class="i" style="width:14px;height:14px"')} Esta mensagem foi apagada` }));
  else {
    for (const a of m.attachments) parts.push(h('div', { class: 'att' }, attEl(a)));
    if (m.kind === 'ai') parts.push(h('div', { class: 'txt md', html: m.status === 'streaming' && !m.text ? '<span class="dots"><i></i><i></i><i></i></span>' : md(m.text) + (m.status === 'streaming' ? '<span class="dots"><i></i><i></i><i></i></span>' : '') }));
    else if (m.text) parts.push(h('div', { class: 'txt pre', html: plain(m.text, m.mentions) }));
    if (m.error) { const er = h('div', { class: 'err-box' }, [h('b', {}, '⚠ ' + m.error.message)]); const row = h('div', { class: 'row' }); const ai = AIS.aiById(c, m.senderId);
      if (c.type === 'ai') row.append(h('button', { class: 'btn sm', onclick: () => AIS.ui.switchAI(c) }, 'Trocar IA')); if (ai?.ownerId === S.me.id) row.append(h('button', { class: 'btn sm', onclick: () => AIS.ui.switchModel(ai) }, 'Trocar modelo')); if (row.childNodes.length) er.append(row); parts.push(er); }
    if (m.status === 'stopped') parts.push(h('div', { class: 'small muted' }, '(geração interrompida)'));
    if (!si.ai && m.text) { const u = /https?:\/\/[^\s<)]+/.exec(m.text); if (u) linkPreview(u[0], bub); }
    const rk = Object.entries(m.reactions); if (rk.length) parts.push(h('div', { class: 'reacts' }, rk.map(([e, us]) => h('button', { class: us.includes(S.me.id) ? 'me' : '', title: us.map(id => AIS.userById(c, id)?.username || '').join(', '), onclick: () => react(m, e) }, `${e} ${us.length}`))));
  }
  const meta = h('div', { class: 'meta' }); meta.innerHTML = `${m.pinned ? ic('pin').replace('class="i "', 'class="i" style="width:12px;height:12px"') : ''}${m.editedAt ? '<span>editada</span>' : ''}<span>${fmtT(m.createdAt)}</span>${mine && !m.deleted ? `<span data-tick>${tickHTML(tickState(c, m))}</span>` : ''}`;
  parts.push(meta); bub.replaceChildren(...parts);
}
function attEl(a) {
  const url = `/api/files/${a.id}`;
  if (/^image\/(png|jpeg|gif|webp)$/.test(a.mime)) return h('img', { src: url, alt: a.name, loading: 'lazy', onclick: () => { const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src: url, alt: a.name })); document.body.append(lb); } });
  if (/^audio\//.test(a.mime)) return h('audio', { controls: true, src: url, preload: 'metadata' });
  if (/^video\//.test(a.mime)) return h('video', { controls: true, src: url, preload: 'metadata' });
  return h('a', { class: 'file', href: url, target: '_blank', rel: 'noopener', html: `${ic('file')}<span class="grow"><b class="ellipsis" style="display:block">${esc(a.name)}</b><span class="small muted">${fmtSize(a.size)}</span></span>` });
}
async function linkPreview(url, bub) {
  try { let p = previews.get(url); if (!p) { p = api('GET', '/api/preview?url=' + encodeURIComponent(url)).catch(() => null); previews.set(url, p); } const d = await p; if (!d?.title || !bub.isConnected || bub.querySelector('.lp')) return;
    bub.querySelector('.meta').before(h('a', { class: 'lp', href: d.url, target: '_blank', rel: 'noopener noreferrer', html: `<span class="small muted">${esc(d.site || '')}</span><b>${esc(d.title)}</b>${d.description ? `<span class="small">${esc(d.description)}</span>` : ''}` })); } catch {}
}
function renderMsgs(scroll) {
  const c = chat(), arr = S.msgs.get(S.active); if (!c || !arr || !R.msgs) return; const keep = atBottom(); R.msgs.replaceChildren();
  if (!arr.length) R.msgs.append(h('div', { class: 'ph', html: c.type === 'ai' ? `${av(AIS.chatEntity(c), { ai: true, cls: 'lg' })}<p><b style="color:var(--ink)">${esc(AIS.chatTitle(c))}</b><br>Conversa vazia. Envie uma mensagem para começar.<br><span class="small">As respostas vêm do provedor conectado, com o histórico completo desta conversa.</span></p>` : `<p>Nenhuma mensagem ainda. Diga olá!</p>` }));
  let prev = null; for (const m of arr) { if (!prev || !sameDay(prev.createdAt, m.createdAt)) R.msgs.append(h('div', { class: 'day' }, fmtDay(m.createdAt))); R.msgs.append(msgEl(m, prev, c)); prev = m; }
  if (scroll || keep) toBottom(false);
}
AIS.renderMsgs = () => renderMsgs(false); AIS.renderHeader = renderHeader; AIS.renderBanners = renderBanners; AIS.renderPin = renderPin;
AIS.updateTicks = () => { const c = chat(); if (!c) return; for (const row of $$('.mrow.mine[data-seq]', R.msgs)) { const m = S.msgs.get(c.id)?.find(x => x.id === row.dataset.id); const t = row.querySelector('[data-tick]'); if (m && t) t.innerHTML = tickHTML(tickState(c, m)); } };

let readT; function markRead() {
  clearTimeout(readT); readT = setTimeout(() => { const c = chat(); if (!c || document.visibilityState !== 'visible') return; const arr = S.msgs.get(c.id) || []; const mx = arr.length ? arr[arr.length - 1].seq : 0;
    if (c.unread || mx > c.me.readSeq) { AIS.send({ t: 'read', chatId: c.id, seq: mx }); c.unread = 0; c.me.readSeq = mx; AIS.renderList(); } }, 250);
}
function notify(c, m) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || c.me.muted) return; if (!document.hidden && S.active === c.id) return;
  const si = senderInfo(c, m); try { new Notification(c.type === 'group' ? `${si.name} em ${c.title}` : si.name, { body: m.text?.slice(0, 140) || '📎 Anexo', tag: c.id, icon: '/icon.svg' }); } catch {}
}
AIS.onNewMsg = m => {
  const c = S.chats.get(m.chatId); if (!c) { AIS.refreshChat(m.chatId); return; }
  const arr = S.msgs.get(m.chatId); const dup = arr?.some(x => x.id === m.id);
  if (arr && !dup) arr.push(m); c.last = m;
  if (!isMine(m) && m.kind !== 'system') { AIS.send({ t: 'ack', chatId: m.chatId, seq: m.seq }); if (S.active !== m.chatId || document.hidden) c.unread++; if (m.status !== 'streaming') notify(c, m); }
  if (S.active === m.chatId && arr && !dup) { const keep = atBottom() || isMine(m); const prev = arr[arr.length - 2]; const emp = R.msgs.querySelector('.ph'); if (emp) emp.remove(); if (!prev || !sameDay(prev.createdAt, m.createdAt)) R.msgs.append(h('div', { class: 'day' }, fmtDay(m.createdAt))); R.msgs.append(msgEl(m, prev, c)); if (keep) toBottom(true); markRead(); renderHeader(); }
  AIS.renderList();
};
let raf; AIS.onDelta = ev => {
  const arr = S.msgs.get(ev.chatId), m = arr?.find(x => x.id === ev.id); if (!m) return; m.text += ev.delta; const c = S.chats.get(ev.chatId); if (c?.last?.id === m.id) c.last = m;
  if (S.active === ev.chatId && !raf) raf = requestAnimationFrame(() => { raf = null; const row = R.msgs?.querySelector(`[data-id="${m.id}"] .txt`); if (row) { const keep = atBottom(); row.innerHTML = md(m.text) + '<span class="dots"><i></i><i></i><i></i></span>'; if (keep) toBottom(false); } });
};
AIS.onMsgUpdate = m => {
  const c = S.chats.get(m.chatId); const arr = S.msgs.get(m.chatId); if (arr) { const i = arr.findIndex(x => x.id === m.id); if (i >= 0) arr[i] = m; else arr.push(m); }
  if (c && (!c.last || c.last.id === m.id || m.seq >= c.last.seq)) c.last = m;
  if (S.active === m.chatId && arr) { const old = R.msgs.querySelector(`[data-id="${m.id}"]`); const i = arr.findIndex(x => x.id === m.id); const keep = atBottom(); if (old) old.replaceWith(msgEl(m, arr[i - 1], c)); else R.msgs.append(msgEl(m, arr[i - 1], c)); if (keep) toBottom(false); renderHeader(); if (c) renderPin(); if (!isMine(m) && m.status !== 'streaming' && m.kind === 'ai') { notify(c, m); markRead(); } }
  else if (c && m.kind === 'ai' && !isMine(m) && m.status !== 'streaming') notify(c, m);
  AIS.renderList();
};

// ---------- Ações ----------
function msgMenu(x, y, c, m) {
  if (m.deleted || m.kind === 'system') return; const mine = isMine(m); const ai = m.kind === 'ai' ? AIS.aiById(c, m.senderId) : null;
  const items = [{ label: 'Responder', icon: 'reply', fn: () => { reply = m; renderReply(); R.input.focus(); } }, m.text && { label: 'Copiar texto', icon: 'copy', fn: () => copyText(m.text).then(() => toast('Copiado', 'ok')) }, m.text && { label: 'Encaminhar', icon: 'fwd', fn: () => forward(m) },
    { label: m.pinned ? 'Desafixar' : 'Fixar', icon: 'pin', fn: () => api('POST', `/api/messages/${m.id}/pin`).catch(fail) },
    mine && m.text && { label: 'Editar', icon: 'edit', fn: () => { editing = m; R.input.value = m.text; fit(); updateSend(); renderReply(); R.input.focus(); } },
    m.status === 'streaming' && { label: 'Parar geração', icon: 'stop', fn: () => api('POST', `/api/messages/${m.id}/stop`).catch(fail) },
    (mine || (ai && (ai.ownerId === S.me.id || c.me.role !== 'member'))) && m.status !== 'streaming' && { label: 'Apagar', icon: 'trash', danger: true, fn: async () => { if (await confirmBox('Apagar mensagem', 'A mensagem será apagada para todos.', 'Apagar', true)) api('DELETE', `/api/messages/${m.id}`).catch(fail); } }].filter(Boolean);
  const mm = menu(x, y, items);
  mm.prepend(h('div', { class: 'qe' }, ['👍', '❤️', '😂', '😮', '😢', '🙏'].map(e => h('button', { onclick: () => { mm.remove(); react(m, e); } }, e))));
}
const react = (m, e) => api('POST', `/api/messages/${m.id}/react`, { emoji: e }).catch(fail);
function forward(m) {
  const list = h('div'); const md2 = modal({ title: 'Encaminhar para…', body: list });
  for (const c of [...S.chats.values()].filter(x => !x.me.archived)) list.append(h('div', { class: 'ci', style: 'border-radius:10px', onclick: async () => { try { await api('POST', `/api/chats/${c.id}/messages`, { text: m.text, forwarded: true }); md2.close(); toast('Mensagem encaminhada' + (m.attachments.length ? ' (anexos não são encaminhados)' : ''), 'ok'); } catch (e) { fail(e); } }, html: `${av(AIS.chatEntity(c), { ai: c.type === 'ai', cls: 'sm' })}<span class="nm">${esc(AIS.chatTitle(c))}</span>` }));
}
function renderReply() {
  R.reply.replaceChildren(); const m = editing || reply; if (!m) return;
  const c = chat(); R.reply.append(h('div', { class: 'replybar' }, [h('span', { html: ic(editing ? 'edit' : 'reply') }), h('div', { class: 'grow' }, [h('b', { class: 'small' }, editing ? 'Editando mensagem' : 'Respondendo a ' + senderInfo(c, m).name), h('div', { class: 'ellipsis small muted' }, m.text || '📎 Anexo')]), h('button', { class: 'ib', style: 'width:30px;height:30px', 'aria-label': 'Cancelar', html: ic('x'), onclick: () => { if (editing) { R.input.value = ''; fit(); } editing = reply = null; renderReply(); updateSend(); } })]));
}
function renderTray() { R.tray.replaceChildren(); if (!pending.length) return; R.tray.className = 'tray'; for (const f of pending) R.tray.append(h('span', { class: 'f' }, [h('span', { html: ic('file') }), h('span', { class: 'small' }, f.name + (f.up ? '' : ' · enviando…')), h('button', { class: 'ib', style: 'width:24px;height:24px', 'aria-label': 'Remover', html: ic('x'), onclick: () => { pending = pending.filter(x => x !== f); renderTray(); updateSend(); } })])); }
async function addFile(file) {
  if (file.size > 25 * 1024 * 1024) return toast('Arquivo maior que 25 MB.', 'err'); const f = { name: file.name || 'arquivo', up: false }; pending.push(f); renderTray(); updateSend();
  try { const r = await upload(file, file.name || 'arquivo', file.type, S.active); Object.assign(f, r, { up: true }); } catch (e) { pending = pending.filter(x => x !== f); fail(e); } renderTray(); updateSend();
}
async function send() {
  const c = chat(); if (!c) return; const text = R.input.value;
  if (editing) { const m = editing; if (!text.trim()) return; try { await api('PATCH', `/api/messages/${m.id}`, { text }); } catch (e) { return fail(e); } editing = null; R.input.value = ''; fit(); renderReply(); updateSend(); return; }
  if (pending.some(f => !f.up)) return toast('Aguarde o envio dos arquivos…'); if (!text.trim() && !pending.length) return;
  const body = { text, replyTo: reply?.id, attachments: pending.map(f => f.id), mentions: mentions.filter(mn => text.includes('@' + mn.name)) };
  R.send.disabled = true; try { const r = await api('POST', `/api/chats/${c.id}/messages`, body); AIS.onNewMsg(r.message); R.input.value = ''; drafts.delete(c.id); reply = null; pending = []; mentions = []; fit(); renderReply(); renderTray(); updateSend(); toBottom(true); } catch (e) { fail(e); } R.send.disabled = false; R.input.focus();
}
function onKey(e) {
  if (!R.pop.classList.contains('hidden')) { if (e.key === 'ArrowDown') { e.preventDefault(); popIdx = (popIdx + 1) % popItems.length; paintPop(); return; } if (e.key === 'ArrowUp') { e.preventDefault(); popIdx = (popIdx - 1 + popItems.length) % popItems.length; paintPop(); return; } if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(popItems[popIdx]); return; } if (e.key === 'Escape') { R.pop.classList.add('hidden'); return; } }
  if (e.key === 'Enter' && !e.shiftKey && !coarse) { e.preventDefault(); send(); }
  if (e.key === 'Escape' && (reply || editing)) { if (editing) R.input.value = ''; reply = editing = null; renderReply(); updateSend(); }
}

// ---------- Menções ----------
function mentionCheck() {
  const c = chat(); if (!c || c.type === 'ai') return R.pop.classList.add('hidden'); const i = R.input, pre = i.value.slice(0, i.selectionStart); const m = /(^|\s)@([^\s@]*)$/.exec(pre);
  if (!m) return R.pop.classList.add('hidden'); const q = m[2].toLowerCase();
  popItems = [...c.members.filter(u => u.id !== S.me.id).map(u => ({ kind: 'user', id: u.id, name: u.username, ent: u, ok: true })), ...c.ais.filter(a => a.member).map(a => ({ kind: 'ai', id: a.id, name: a.name, ent: a, ok: a.usable, sub: a.usable ? `IA · ${a.model}` : 'IA · sem autorização para você' }))].filter(x => x.name.toLowerCase().startsWith(q) || x.name.toLowerCase().includes(q));
  if (!popItems.length) return R.pop.classList.add('hidden'); popIdx = Math.max(0, popItems.findIndex(x => x.ok)); R.pop.classList.remove('hidden'); paintPop();
}
function paintPop() { R.pop.replaceChildren(...popItems.map((x, k) => h('div', { class: `it ${k === popIdx ? 'on' : ''} ${x.ok ? '' : 'dis'}`, onmousedown: e => { e.preventDefault(); pickMention(x); }, html: `${av(x.ent, { cls: 'sm', ai: x.kind === 'ai' })}<div><b>${esc(x.name)}</b><div class="small muted">${esc(x.sub || 'Pessoa')}</div></div>` }))); }
function pickMention(x) {
  if (!x) return; if (!x.ok) return toast(`${x.name} não está autorizada para você neste chat. Peça ao dono para compartilhar.`, 'err');
  const i = R.input, pos = i.selectionStart, pre = i.value.slice(0, pos).replace(/@[^\s@]*$/, '@' + x.name + ' '); i.value = pre + i.value.slice(pos); i.selectionStart = i.selectionEnd = pre.length;
  if (!mentions.some(mn => mn.id === x.id)) mentions.push({ kind: x.kind, id: x.id, name: x.name }); R.pop.classList.add('hidden'); i.focus(); fit(); updateSend();
}

// ---------- Voz ----------
async function recToggle() {
  if (rec) return recStop(true);
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true }); const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'; const mr = new MediaRecorder(st, { mimeType: mime }); const chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec = { mr, chunks, st, mime, t0: Date.now(), cancel: false, chatId: S.active }; mr.onstop = async () => { st.getTracks().forEach(t => t.stop()); const r = rec; rec = null; clearInterval(r.tm); R.mic.classList.remove('rec'); R.mic.innerHTML = ic('mic'); R.input.placeholder = 'Mensagem'; if (r.cancel || !chunks.length) return;
      try { const blob = new Blob(chunks, { type: r.mime }); const f = await upload(blob, `voz-${fmtT(Date.now()).replace(':', 'h')}.${r.mime === 'audio/webm' ? 'webm' : 'm4a'}`, r.mime, r.chatId); const res = await api('POST', `/api/chats/${r.chatId}/messages`, { text: '', attachments: [f.id] }); AIS.onNewMsg(res.message); } catch (e) { fail(e); } };
    mr.start(); R.mic.classList.add('rec'); R.mic.innerHTML = ic('stop'); R.mic.setAttribute('aria-label', 'Parar e enviar'); rec.tm = setInterval(() => { R.input.placeholder = `🔴 Gravando ${fmtCount(Date.now() - rec.t0)} — toque para enviar, Esc cancela`; }, 300);
    const esc2 = e => { if (e.key === 'Escape' && rec) { recStop(false); document.removeEventListener('keydown', esc2); } }; document.addEventListener('keydown', esc2);
  } catch { toast('Não foi possível acessar o microfone.', 'err'); }
}
const recStop = send => { if (!rec) return; rec.cancel = !send; rec.mr.stop(); };

// ---------- Menu da conversa (⋮) ----------
AIS.chatMenuItems = (c, fromList) => {
  const it = []; const flag = (k, v) => api('POST', `/api/chats/${c.id}/flags`, { [k]: v }).then(r => { S.chats.set(c.id, { ...c, ...r.chat }); AIS.renderList(); if (S.active === c.id) renderHeader(); }).catch(fail);
  if (!fromList) {
    if (c.type === 'ai') { const ai = AIS.currentAI(c); it.push({ label: 'Trocar IA da conversa', icon: 'swap', fn: () => AIS.ui.switchAI(c) }); if (ai) { if (ai.ownerId === S.me.id) it.push({ label: 'Trocar modelo', icon: 'spark', fn: () => AIS.ui.switchModel(ai) }, { label: `Compartilhar ${ai.name}…`, icon: 'share', fn: () => AIS.ui.share(c, ai) }); it.push({ label: `Conversas de ${ai.name}`, icon: 'chat', fn: () => AIS.ui.aiChats(ai) }); } }
    if (c.type === 'group') { it.push({ label: 'Informações do grupo', icon: 'info', fn: () => AIS.ui.chatInfo(c) }, { label: 'Adicionar minha IA ao grupo', icon: 'bot', fn: () => AIS.ui.addAIToGroup(c) }, { label: 'Compartilhar IA com o grupo…', icon: 'share', fn: () => AIS.ui.share(c) });
      if (c.ais.filter(a => a.member).length >= 2) it.push({ label: 'IAs conversam…', icon: 'users', fn: () => AIS.ui.autoDialog(c) }); for (const a of c.ais.filter(a => a.member).slice(0, 4)) it.push({ label: `Conversas de ${a.name}`, icon: 'chat', fn: () => AIS.ui.aiChats(a) }); }
    if (c.type === 'dm') it.push({ label: 'Dados do contato', icon: 'info', fn: () => AIS.ui.chatInfo(c) });
    it.push('-');
  }
  it.push({ label: c.me.pinned ? 'Desafixar conversa' : 'Fixar conversa', icon: 'pin', fn: () => flag('pinned', !c.me.pinned) }, { label: c.me.muted ? 'Reativar notificações' : 'Silenciar', icon: 'mute', fn: () => flag('muted', !c.me.muted) }, { label: c.me.archived ? 'Desarquivar' : 'Arquivar', icon: 'archive', fn: () => flag('archived', !c.me.archived) },
    { label: 'Apagar histórico (só para mim)', icon: 'trash', fn: async () => { if (await confirmBox('Apagar histórico', 'As mensagens somem apenas para você, neste dispositivo e nos outros.', 'Apagar', true)) { await api('DELETE', `/api/chats/${c.id}/history`).catch(fail); S.msgs.delete(c.id); c.last = null; c.unread = 0; if (S.active === c.id) AIS.openChat(c.id, true); AIS.renderList(); } } });
  if (c.type === 'group') it.push({ label: 'Sair do grupo', icon: 'logout', danger: true, fn: async () => { if (await confirmBox('Sair do grupo', `Você deixará "${c.title}". Suas IAs também saem do grupo.`, 'Sair', true)) api('DELETE', `/api/chats/${c.id}/members/${S.me.id}`).then(() => AIS.dropChat(c.id)).catch(fail); } });
  if (c.type === 'dm' && !fromList) { const o = AIS.other(c); it.push({ label: 'Bloquear contato', icon: 'x', danger: true, fn: async () => { if (await confirmBox('Bloquear', `${o.username} não poderá mais enviar mensagens ou ligar para você.`, 'Bloquear', true)) api('POST', `/api/contacts/${o.id}/block`).then(() => toast('Contato bloqueado', 'ok')).then(AIS.reloadContacts).catch(fail); } }); }
  return it;
};
})();
