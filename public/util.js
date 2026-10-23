'use strict';
// Utilitários: DOM, ícones, avatares, Markdown seguro, API, modais e menus.
const AIS = window.AIS = { state: {}, ev: {} };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function h(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const c of [].concat(kids)) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const P = {
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  video: 'M23 7l-7 5 7 5z M1 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z',
  videooff: 'M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.7 0H14a2 2 0 0 1 2 2v3.3l1 1L23 7v10 M1 1l22 22',
  screen: 'M2 4h20v13H2z M8 21h8 M12 17v4',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3',
  micoff: 'M9 9v3a3 3 0 0 0 5.1 2.1 M15 9.3V5a3 3 0 0 0-5.9-.6 M19 10v2a7 7 0 0 1-.9 3.4 M5 10v2a7 7 0 0 0 11 5.7 M12 19v3 M1 1l22 22',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z',
  clip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01',
  more: 'M12 5h.01 M12 12h.01 M12 19h.01', back: 'M15 18l-6-6 6-6', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  plus: 'M12 5v14 M5 12h14', check: 'M20 6L9 17l-5-5', check2: 'M1 13l4 4L15 7 M9 16l2 2L22 7', x: 'M18 6L6 18 M6 6l12 12',
  reply: 'M9 17l-5-5 5-5 M4 12h11a5 5 0 0 1 5 5v2', pin: 'M12 17v5 M9 3h6l-1 7 3 3v2H7v-2l3-3z',
  gear: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  userplus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M20 8v6 M23 11h-6',
  bot: 'M12 8V4H8 M4 8h16v12H4z M2 14h2 M20 14h2 M15 13v2 M9 13v2', share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1', trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6', edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  fwd: 'M15 17l5-5-5-5 M20 12H9a5 5 0 0 0-5 5v2', swap: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  stop: 'M6 6h12v12H6z', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4', mute: 'M11 5L6 9H2v6h4l5 4z M23 9l-6 6 M17 9l6 6', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4', link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" ${n === 'more' ? 'style="stroke-width:3.2"' : ''}><path d="${P[n]}"/></svg>`;

// ---------- Avatares ----------
const hue = s => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
function av(e, { cls = '', ai = false, online = false } = {}) {
  const name = e?.name || e?.username || e?.title || '?';
  const isAi = ai || e?.provider;
  const bg = e?.avatar ? `background-image:url('${e.avatar}')` : `background:${e?.color || `hsl(${hue(name)} 45% 42%)`}`;
  return `<div class="av ${cls} ${isAi ? 'aiav' : ''}" style="${bg}">${e?.avatar ? '' : esc([...name.replace(/^[^\p{L}\p{N}]+/u, '')][0]?.toUpperCase() || '?')}${online ? '<i class="dot"></i>' : ''}</div>`;
}

// ---------- Tempo ----------
const pad = n => String(n).padStart(2, '0');
const fmtT = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function fmtDay(ts) { const t = Date.now(); if (sameDay(ts, t)) return 'Hoje'; if (sameDay(ts, t - 864e5)) return 'Ontem'; return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }
function fmtList(ts) { const t = Date.now(); if (sameDay(ts, t)) return fmtT(ts); if (sameDay(ts, t - 864e5)) return 'Ontem'; return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const fmtCount = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor(s % 3600 / 60))}min` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// ---------- Markdown seguro (escapa tudo antes de formatar) ----------
function inline(t) {
  const codes = []; t = t.replace(/`([^`\n]+)`/g, (m, c) => (codes.push(c), `\u0001${codes.length - 1}\u0001`));
  t = esc(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return t.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code>${esc(codes[i])}</code>`);
}
function md(src) {
  const blocks = [];
  let s = String(src).replace(/```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(```|$)/g, (m, lang, code) => (blocks.push({ lang, code: code.replace(/\n$/, '') }), `\u0002${blocks.length - 1}\u0002`));
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of s.split('\n')) {
    let m;
    if ((m = /^\u0002(\d+)\u0002$/.exec(line.trim()))) { close(); const b = blocks[m[1]]; out.push(`<div class="code"><div class="ch2"><span>${esc(b.lang || 'código')}</span><button type="button" data-copy>${ic('copy')} Copiar</button></div><pre><code>${esc(b.code)}</code></pre></div>`); }
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^>\s?(.*)$/.exec(line))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close(); return out.join('').replace(/\u0002(\d+)\u0002/g, '');
}
function plain(text, mentions = []) {
  let t = esc(text).replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">$2</a>');
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) t = t.split('@' + esc(m.name)).join(`<span class="mention ${m.kind === 'ai' ? 'ai' : ''}">@${esc(m.name)}</span>`);
  return t;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  const code = b.closest('.code').querySelector('code').textContent; copyText(code).then(() => { b.innerHTML = ic('check') + ' Copiado'; setTimeout(() => b.innerHTML = ic('copy') + ' Copiar', 1500); });
});
async function copyText(t) { try { await navigator.clipboard.writeText(t); } catch { const a = h('textarea', { style: 'position:fixed;opacity:0' }); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); } catch {} a.remove(); } }

// ---------- API ----------
async function api(method, url, body) {
  let r; try { r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-ais': '1' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch { const e = new Error('Sem conexão com o servidor. Verifique a internet.'); e.status = 0; throw e; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || 'Algo deu errado.'); e.status = r.status; e.data = j; if (r.status === 401 && !/\/(login|register|recover)$/.test(url)) AIS.ev.unauthorized?.(); throw e; }
  return j;
}
async function upload(blob, name, mime, chatId) {
  const r = await fetch(`/api/files?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime || 'application/octet-stream')}${chatId ? '&chat=' + chatId : ''}`, { method: 'POST', headers: { 'x-ais': '1' }, body: blob });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Falha no envio do arquivo.'); return j.file;
}
function toast(text, kind = '') { const t = h('div', { class: 'toast ' + kind, role: 'status' }, text); $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 5500 : 3200); }
const fail = e => toast(e?.message || String(e), 'err');
function resizeImage(file, max = 256) {
  return new Promise((ok, bad) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = h('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', .85)); }; img.onerror = () => bad(new Error('Imagem inválida.')); img.src = URL.createObjectURL(file); });
}
function pickImage(cb) { const i = h('input', { type: 'file', accept: 'image/*' }); i.onchange = async () => { if (i.files[0]) try { cb(await resizeImage(i.files[0])); } catch (e) { fail(e); } }; i.click(); }

// ---------- Modais e menus ----------
const modals = [];
function modal({ title, body, footer, wide, onClose }) {
  const bodyEl = h('div', { class: 'body' }); if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  const foot = h('footer'); if (footer) [].concat(footer).forEach(f => foot.append(f));
  const m = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('header', {}, [h('h2', {}, title), h('button', { class: 'ib', 'aria-label': 'Fechar', html: ic('x'), onclick: () => api2.close() })]), bodyEl, footer ? foot : null]);
  const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) api2.close(); } }, m);
  const api2 = { el: m, body: bodyEl, foot, close() { ov.remove(); modals.splice(modals.indexOf(api2), 1); onClose?.(); }, setBody(x) { bodyEl.replaceChildren(); if (typeof x === 'string') bodyEl.innerHTML = x; else bodyEl.append(x); } };
  document.body.append(ov); modals.push(api2); setTimeout(() => $('input,textarea,select', bodyEl)?.focus(), 30); return api2;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const mn = $('.menu'); if (mn) mn.remove(); else modals.at(-1)?.close(); } });
function menu(x, y, items) {
  $('.menu')?.remove();
  const m = h('div', { class: 'menu', role: 'menu' }); for (const it of items) { if (!it) continue; if (it === '-') { m.append(h('div', { class: 'sep' })); continue; } m.append(h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', html: (it.icon ? ic(it.icon) : '') + `<span>${esc(it.label)}</span>`, onclick: () => { m.remove(); it.fn(); } })); }
  document.body.append(m); const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0); return m;
}
const menuAt = (el, items) => { const r = el.getBoundingClientRect(); menu(r.right - 230, r.bottom + 4, items); };
const field = (label, input, hint) => h('div', { class: 'field' }, [h('label', {}, label), input, hint ? h('span', { class: 'small muted' }, hint) : null]);
const confirmBox = (title, text, okLabel = 'Confirmar', danger = false) => new Promise(res => {
  const m = modal({ title, body: h('p', {}, text), footer: [h('button', { class: 'btn', onclick: () => { m.close(); res(false); } }, 'Cancelar'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { m.close(); res(true); } }, okLabel)], onClose: () => res(false) });
});
