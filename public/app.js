'use strict';
// Estado global, autenticação, WebSocket e lista de conversas.
const S = AIS.state; Object.assign(S, { me: null, chats: new Map(), msgs: new Map(), more: new Map(), ongoing: new Map(), active: null, typing: {}, contacts: [], ais: { mine: [], shared: [] }, filter: 'all', query: '', cfg: null });
AIS.PROVIDERS = {};

// ---------- Tema ----------
const THEME_KEY = 'ais-theme';
AIS.setTheme = t => { try { localStorage.setItem(THEME_KEY, t); } catch {} if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#0b1a20'; };
AIS.getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } };
AIS.setTheme(AIS.getTheme());

// ---------- Nomes e títulos ----------
AIS.userById = (chat, id) => id === S.me?.id ? S.me : chat?.members.find(m => m.id === id) || S.contactMap?.get(id);
AIS.aiById = (chat, id) => chat?.ais.find(a => a.id === id) || [...S.ais.mine, ...S.ais.shared].find(a => a.id === id);
AIS.other = chat => chat.members.find(m => m.id !== S.me.id);
AIS.chatTitle = c => c.type === 'dm' ? (AIS.other(c)?.username || 'Conversa') : (c.title || 'Conversa');
AIS.chatEntity = c => c.type === 'dm' ? AIS.other(c) : c.type === 'ai' ? (c.ais.find(a => a.member) || { name: c.title }) : { name: c.title, avatar: c.avatar };
AIS.send = o => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(o)); };
AIS.currentAI = c => c.ais.find(a => a.member);

// ---------- Autenticação ----------
function authView() {
  S.me = null; S.ws?.close(); S.ws = null; document.title = 'AIsConnect';
  const root = $('#root'); root.replaceChildren();
  let tab = 'create', step2fa = false;
  const card = h('div', { class: 'auth-card' }); root.append(h('div', { class: 'auth' }, card));
  const strength = pw => { let s = 0; if (pw.length >= 10) s++; if (pw.length >= 14) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++; return s; };
  function draw() {
    card.innerHTML = `<div class="brand"><img src="/icon.svg" alt=""><b>AIsConnect</b></div><p class="muted" style="margin:0">Converse com pessoas e com as suas IAs no mesmo lugar.</p>
      <div class="tabs" role="tablist"><button data-t="create" class="${tab === 'create' ? 'on' : ''}">Criar conta</button><button data-t="login" class="${tab === 'login' ? 'on' : ''}">Entrar</button></div><form id="af" autocomplete="on"></form>`;
    $$('.tabs button', card).forEach(b => b.onclick = () => { tab = b.dataset.t; step2fa = false; draw(); });
    const f = $('#af', card);
    const F = (id, label, type = 'text', extra = '') => `<div class="field"><label for="${id}">${label}</label><input class="inp" id="${id}" type="${type}" ${extra}></div>`;
    if (tab === 'create') {
      f.innerHTML = F('u', 'Nome de usuário', 'text', 'autocomplete="username" maxlength="24" required placeholder="ex.: pedro.dev"') + F('p', 'Senha', 'password', 'autocomplete="new-password" required placeholder="mínimo 10 caracteres"') + '<div class="meter" style="margin:-6px 0 12px"><i id="mt"></i></div>' + F('p2', 'Confirmar senha', 'password', 'autocomplete="new-password" required') +
        `<div class="field"><label>Foto de perfil (opcional)</label><div class="row"><div id="avp">${av({ name: '?' })}</div><button type="button" class="btn sm" id="pickav">Escolher foto</button></div></div><div class="err" id="er"></div><button class="btn primary" style="width:100%" id="go">Criar conta</button>
        <p class="small muted" style="margin-bottom:0">Você receberá um número público (+AI …) para ser encontrado e códigos de recuperação. Guarde-os: sem e-mail, eles são a forma de recuperar a conta.</p>`;
      let avatar = null; $('#pickav', f).onclick = () => pickImage(d => { avatar = d; $('#avp', f).innerHTML = av({ name: 'x', avatar: d }); });
      $('#p', f).oninput = e => { const s = strength(e.target.value); const m = $('#mt', f); m.style.width = s * 20 + '%'; m.style.background = s < 3 ? 'var(--danger)' : s < 4 ? 'var(--warn)' : 'var(--ok)'; };
      f.onsubmit = async e => { e.preventDefault(); const er = $('#er', f); er.textContent = ''; $('#go', f).disabled = true;
        try { const r = await api('POST', '/api/register', { username: $('#u', f).value, password: $('#p', f).value, confirm: $('#p2', f).value, avatar }); S.me = r.user; showRecovery(r.recoveryCodes, () => startApp()); }
        catch (x) { er.textContent = x.message; $('#go', f).disabled = false; } };
    } else {
      f.innerHTML = F('u', 'Nome de usuário', 'text', 'autocomplete="username" required') + F('p', 'Senha', 'password', 'autocomplete="current-password" required') +
        (step2fa ? F('c', 'Código do autenticador ou de recuperação', 'text', 'autocomplete="one-time-code" inputmode="numeric" placeholder="123456"') : '') +
        `<div class="err" id="er"></div><button class="btn primary" style="width:100%" id="go">Entrar</button><p style="text-align:center;margin-bottom:0"><a href="#" id="rec" style="color:var(--accent)">Esqueci minha senha</a></p>`;
      $('#rec', f).onclick = e => { e.preventDefault(); recoverModal(); };
      f.onsubmit = async e => { e.preventDefault(); const er = $('#er', f); er.textContent = ''; $('#go', f).disabled = true;
        try { const r = await api('POST', '/api/login', { username: $('#u', f).value, password: $('#p', f).value, code: $('#c', f)?.value }); if (r.need2fa) { step2fa = true; const u = $('#u', f).value, p = $('#p', f).value; draw(); $('#u', card).value = u; $('#p', card).value = p; $('#c', card).focus(); return; } S.me = r.user; startApp(); }
        catch (x) { er.textContent = x.message; $('#go', f).disabled = false; } };
    }
  }
  draw();
}
function showRecovery(codes, done) {
  const text = codes.join('\n'); const ok = h('input', { type: 'checkbox', id: 'sv' }); const go = h('button', { class: 'btn primary', disabled: true, onclick: () => { m.close(); done?.(); } }, 'Continuar');
  ok.onchange = () => go.disabled = !ok.checked;
  const m = modal({ title: 'Códigos de recuperação', body: h('div', {}, [h('p', {}, 'Estes códigos são mostrados apenas agora. Cada um funciona uma vez e permite recuperar a conta ou entrar sem o autenticador. Guarde-os em um lugar seguro.'), h('div', { class: 'codes' }, codes.map(c => h('span', {}, c))),
    h('div', { class: 'row', style: 'margin-top:12px' }, [h('button', { class: 'btn sm', onclick: () => copyText(text).then(() => toast('Copiado', 'ok')) }, 'Copiar'), h('button', { class: 'btn sm', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([`AIsConnect – códigos de recuperação\n${S.me.username}\n\n${text}\n`], { type: 'text/plain' })), download: 'aisconnect-recuperacao.txt' }); a.click(); } }, 'Baixar .txt')]),
    h('label', { class: 'row', style: 'margin-top:14px' }, [ok, 'Guardei meus códigos em local seguro'])]), footer: go, onClose: () => { if (go.disabled) setTimeout(() => showRecovery(codes, done), 0); } });
}
function recoverModal() {
  const u = h('input', { class: 'inp', autocomplete: 'username' }), c = h('input', { class: 'inp', placeholder: 'xxxxx-xxxxx' }), p = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password' }), er = h('div', { class: 'err' });
  const m = modal({ title: 'Recuperar conta', body: h('div', {}, [h('p', { class: 'muted' }, 'Informe seu usuário e um código de recuperação. Só o nome de usuário ou o número público nunca bastam.'), field('Usuário', u), field('Código de recuperação', c), field('Nova senha', p, 'Mínimo 10 caracteres.'), er]),
    footer: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('POST', '/api/recover', { username: u.value, code: c.value, newPassword: p.value }); S.me = r.user; m.close(); toast(`Senha redefinida. Restam ${r.recoveryLeft} códigos.`, 'ok'); startApp(); } catch (e) { er.textContent = e.message; } } }, 'Redefinir senha')] });
}
AIS.ev.unauthorized = () => { if (S.me) { S.me = null; toast('Sua sessão terminou. Entre novamente.', 'err'); authView(); } };

// ---------- Boot ----------
async function startApp() {
  S.chats.clear(); S.msgs.clear(); S.active = null;
  const root = $('#root'); root.replaceChildren();
  root.append(h('div', { class: 'app', id: 'app' }, [
    h('aside', { class: 'side' }, [
      h('div', { class: 'side-h' }, [h('div', { html: av(S.me), id: 'me-av', style: 'cursor:pointer', title: 'Perfil', onclick: () => AIS.ui.settings('perfil') }), h('h1', {}, 'AIsConnect'),
        h('button', { class: 'ib', 'aria-label': 'Nova conversa ou grupo', title: 'Nova conversa', html: ic('plus'), onclick: e => menuAt(e.currentTarget, newMenu()) }),
        h('button', { class: 'ib', 'aria-label': 'Configurações', title: 'Configurações', html: ic('gear'), onclick: () => AIS.ui.settings() })]),
      h('div', { class: 'search', html: ic('search') + '<input class="inp" id="q" placeholder="Pesquisar conversas e mensagens" aria-label="Pesquisar">' }),
      h('div', { class: 'filters', id: 'filters' }), h('div', { class: 'list', id: 'list' })]),
    h('section', { class: 'main', id: 'main' })]));
  showPlaceholder();
  let qt; $('#q').oninput = e => { S.query = e.target.value.trim(); renderList(); clearTimeout(qt); if (S.query.length >= 2) qt = setTimeout(searchMsgs, 300); };
  renderFilters();
  try { const [cfg, c, k, a] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/chats'), api('GET', '/api/contacts'), api('GET', '/api/ais')]);
    S.cfg = cfg; AIS.PROVIDERS = cfg.providers; for (const x of c.chats) S.chats.set(x.id, x); setContacts(k.contacts); S.ais = a; } catch (e) { return fail(e); }
  renderList(); connectWS();
  if (location.hash.startsWith('#add=')) { AIS.ui.addContact(decodeURIComponent(location.hash.slice(5))); history.replaceState(null, '', location.pathname); }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
function setContacts(list) { S.contacts = list; S.contactMap = new Map(list.map(c => [c.id, c])); }
AIS.reloadContacts = async () => { setContacts((await api('GET', '/api/contacts')).contacts); renderList(); };
AIS.reloadAIs = async () => { S.ais = await api('GET', '/api/ais'); AIS.ui.refreshAIs?.(); };
function newMenu() { return [{ label: 'Nova conversa', icon: 'chat', fn: () => AIS.ui.newChat() }, { label: 'Adicionar contato', icon: 'userplus', fn: () => AIS.ui.addContact() }, { label: 'Conectar IA', icon: 'bot', fn: () => AIS.ui.connectAI() }, { label: 'Criar grupo', icon: 'users', fn: () => AIS.ui.newGroup() }]; }
function showPlaceholder() { $('#app').classList.remove('chat-open'); $('#main').innerHTML = `<div class="ph"><img src="/icon.svg" alt=""><h2 style="color:var(--ink)">AIsConnect</h2><p>Selecione uma conversa para começar.<br>Pessoas e IAs conversam juntas, no mesmo chat.</p></div>`; }

// ---------- WebSocket ----------
let backoff = 1000, hb;
function connectWS() {
  if (!S.me) return; const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); S.ws = ws;
  ws.onopen = () => { backoff = 1000; clearInterval(hb); hb = setInterval(() => AIS.send({ t: 'ping' }), 25000); if (S.reconnected) resync(); S.reconnected = true; setBanner(false); };
  ws.onmessage = e => { try { onEvent(JSON.parse(e.data)); } catch (x) { console.error(x); } };
  ws.onclose = () => { clearInterval(hb); if (!S.me || S.ws !== ws) return; setBanner(true); setTimeout(connectWS, backoff); backoff = Math.min(backoff * 2, 15000); };
}
function setBanner(off) { let b = $('#offline'); if (off && !b) $('#app')?.prepend(h('div', { id: 'offline', class: 'banner warn', style: 'position:absolute;z-index:30;left:0;right:0;top:0;justify-content:center' }, 'Sem conexão. Tentando reconectar…')); if (!off) b?.remove(); }
async function resync() { try { const c = await api('GET', '/api/chats'); S.chats.clear(); for (const x of c.chats) S.chats.set(x.id, x); renderList(); if (S.active && S.chats.has(S.active)) { S.msgs.delete(S.active); AIS.openChat(S.active, true); } } catch {} }
let unreadTotal = 0;
function updateTitle() { unreadTotal = [...S.chats.values()].reduce((n, c) => n + (c.me.muted ? 0 : c.unread), 0); document.title = (unreadTotal ? `(${unreadTotal}) ` : '') + 'AIsConnect'; }

async function refreshChat(id) { try { const { chat } = await api('GET', '/api/chats/' + id); const old = S.chats.get(id); S.chats.set(id, chat); renderList(); if (S.active === id) { AIS.renderHeader(); AIS.renderBanners(); AIS.renderPin?.(); if (old && JSON.stringify(old.members.map(m => m.readSeq)) !== JSON.stringify(chat.members.map(m => m.readSeq))) AIS.renderMsgs?.(); } } catch (e) { if (e.status === 404) dropChat(id); } }
function dropChat(id) { S.chats.delete(id); S.msgs.delete(id); if (S.active === id) { S.active = null; showPlaceholder(); } renderList(); }
function onEvent(ev) {
  if (ev.t.startsWith('call.') || ev.t === 'hello') CALLS.handle(ev);
  switch (ev.t) {
    case 'msg.new': AIS.onNewMsg(ev.msg); break;
    case 'msg.delta': AIS.onDelta(ev); break;
    case 'msg.done': case 'msg.update': AIS.onMsgUpdate(ev.msg); break;
    case 'chat.update': refreshChat(ev.chatId); break;
    case 'chat.removed': dropChat(ev.chatId); break;
    case 'typing': { const t = (S.typing[ev.chatId] ||= {}); clearTimeout(t[ev.userId]); t[ev.userId] = setTimeout(() => { delete t[ev.userId]; if (S.active === ev.chatId) AIS.renderHeader(); }, 4000); if (S.active === ev.chatId) AIS.renderHeader(); break; }
    case 'presence': for (const c of S.chats.values()) { const m = c.members.find(x => x.id === ev.userId); if (m) m.online = ev.online; } S.contactMap?.get(ev.userId) && (S.contactMap.get(ev.userId).online = ev.online); if (S.active) AIS.renderHeader(); break;
    case 'receipt': { const c = S.chats.get(ev.chatId), m = c?.members.find(x => x.id === ev.userId); if (m) { m.deliveredSeq = Math.max(m.deliveredSeq, ev.deliveredSeq || 0); if (ev.readSeq != null) m.readSeq = Math.max(m.readSeq, ev.readSeq); if (S.active === ev.chatId) AIS.updateTicks?.(); } break; }
    case 'auto': { const c = S.chats.get(ev.chatId); if (c) { c.auto = ev.auto; if (S.active === ev.chatId) { AIS.renderBanners(); AIS.renderHeader(); } } break; }
    case 'share.new': toast(ev.text, 'ok'); AIS.reloadAIs(); break;
    case 'share.expired': toast(ev.revoked ? 'Um compartilhamento de IA foi encerrado.' : 'Um compartilhamento de IA expirou.'); AIS.reloadAIs().then(() => S.active && refreshChat(S.active)); break;
    case 'notice': toast(ev.text, ev.level === 'warn' ? 'err' : ''); break;
    case 'security': toast(ev.text, 'err'); break;
    case 'contacts.update': AIS.reloadContacts().then(() => AIS.ui.refreshContacts?.()); break;
    case 'session.revoked': AIS.ev.unauthorized(); break;
  }
}

// ---------- Lista ----------
const FILTERS = [['all', 'Todas'], ['unread', 'Não lidas'], ['group', 'Grupos'], ['ai', 'IAs'], ['archived', 'Arquivadas']];
function renderFilters() { const f = $('#filters'); f.replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (S.filter === k ? ' on' : ''), onclick: () => { S.filter = k; renderFilters(); renderList(); } }, l))); }
function previewOf(c) {
  const m = c.last; if (!m) return c.type === 'ai' ? 'Conversa vazia. Diga olá!' : 'Nenhuma mensagem';
  if (m.kind === 'system') return m.text;
  let t = m.deleted ? 'Mensagem apagada' : m.text ? m.text.replace(/\s+/g, ' ') : m.attachments[0] ? (/^image/.test(m.attachments[0].mime) ? '📷 Foto' : /^audio/.test(m.attachments[0].mime) ? '🎤 Áudio' : '📎 ' + m.attachments[0].name) : '';
  if (m.status === 'streaming' && !t) t = 'escrevendo…';
  const pre = m.senderId === S.me.id ? 'Você: ' : (c.type === 'group' ? (m.kind === 'ai' ? AIS.aiById(c, m.senderId)?.name : AIS.userById(c, m.senderId)?.username) + ': ' : '');
  return (pre || '') + t;
}
function renderList() {
  const list = $('#list'); if (!list) return; const q = S.query.toLowerCase();
  let items = [...S.chats.values()].filter(c => {
    if (S.filter === 'archived') return c.me.archived; if (c.me.archived) return false;
    if (S.filter === 'unread' && !c.unread) return false; if (S.filter === 'group' && c.type !== 'group') return false; if (S.filter === 'ai' && c.type !== 'ai') return false;
    return !q || AIS.chatTitle(c).toLowerCase().includes(q);
  }).sort((a, b) => (b.me.pinned - a.me.pinned) || ((b.last?.createdAt || 0) - (a.last?.createdAt || 0)));
  list.replaceChildren();
  if (!S.chats.size && !q) {
    list.append(h('div', { class: 'empty', html: `${ic('chat').replace('class="i "', 'class="i" style="width:44px;height:44px"')}<h3>Suas conversas aparecerão aqui</h3><div>Adicione um contato ou conecte uma IA para começar.</div>` }, h('div', { class: 'acts' }, [
      h('button', { class: 'btn primary', onclick: () => AIS.ui.newChat() }, 'Nova conversa'), h('button', { class: 'btn', onclick: () => AIS.ui.addContact() }, 'Adicionar contato'), h('button', { class: 'btn', onclick: () => AIS.ui.connectAI() }, 'Conectar IA'), h('button', { class: 'btn', onclick: () => AIS.ui.newGroup() }, 'Criar grupo'), h('button', { class: 'btn', onclick: () => AIS.ui.settings() }, 'Configurações')])));
  } else if (!items.length && q.length < 2) list.append(h('div', { class: 'empty' }, 'Nada por aqui.'));
  for (const c of items) {
    const ent = AIS.chatEntity(c), cur = c.type === 'ai' ? AIS.currentAI(c) : null;
    const el = h('div', { class: 'ci' + (S.active === c.id ? ' on' : ''), role: 'button', tabindex: '0', onclick: () => AIS.openChat(c.id), onkeydown: e => e.key === 'Enter' && AIS.openChat(c.id), oncontextmenu: e => { e.preventDefault(); menu(e.clientX, e.clientY, AIS.chatMenuItems(c, true)); },
      html: `${av(ent, { ai: c.type === 'ai', online: c.type === 'dm' && ent?.online })}<div class="grow"><div class="top"><span class="nm ellipsis">${esc(AIS.chatTitle(c))}</span>${c.type === 'ai' ? '<span class="badge ai">IA</span>' : ''}<span class="tm">${c.last ? fmtList(c.last.createdAt) : ''}</span></div><div class="bot"><span class="ellipsis grow">${esc(previewOf(c))}</span>${c.me.pinned ? ic('pin').replace('class="i "', 'class="i" style="width:14px;height:14px"') : ''}${c.me.muted ? ic('mute').replace('class="i "', 'class="i" style="width:14px;height:14px"') : ''}${c.unread ? `<span class="pill ${c.me.muted ? 'mute' : ''}">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</div></div>` });
    list.append(el);
  }
  if (S.searchRes && q.length >= 2) {
    list.append(h('div', { class: 'small muted', style: 'padding:10px 14px;font-weight:700' }, S.searchRes.length ? 'Mensagens' : 'Nenhuma mensagem encontrada'));
    for (const m of S.searchRes) { const c = S.chats.get(m.chatId); if (!c) continue; list.append(h('div', { class: 'ci', onclick: () => AIS.openChat(c.id), html: `${av(AIS.chatEntity(c), { ai: c.type === 'ai' })}<div class="grow"><div class="top"><span class="nm ellipsis">${esc(AIS.chatTitle(c))}</span><span class="tm">${fmtList(m.createdAt)}</span></div><div class="bot ellipsis">${esc(m.text.slice(0, 120))}</div></div>` })); }
  }
  updateTitle();
}
async function searchMsgs() { try { S.searchRes = (await api('GET', '/api/search?q=' + encodeURIComponent(S.query))).results; renderList(); } catch {} }
AIS.renderList = renderList; AIS.refreshChat = refreshChat; AIS.showPlaceholder = showPlaceholder; AIS.updateTitle = updateTitle; AIS.dropChat = dropChat;
AIS.startApp = startApp; AIS.authView = authView; AIS.newMenu = newMenu;

(async () => { try { S.me = (await api('GET', '/api/me')).user; startApp(); } catch { authView(); } })();
