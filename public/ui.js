'use strict';
// Janelas: conectar IA, trocar IA/modelo, conversas da IA, contatos, grupos, compartilhamento, configurações.
(() => {
const S = AIS.state, U = AIS.ui = {};
const PL = k => AIS.PROVIDERS[k]?.label || k;
const inp = (o = {}) => h('input', { class: 'inp', ...o });
const open = c => { S.chats.set(c.id, c); AIS.renderList(); AIS.openChat(c.id, true); };
const allAIs = () => [...S.ais.mine, ...S.ais.shared];
U.refreshAIs = () => {}; U.refreshContacts = () => {};

// ---------- Conectar IA (assistente passo a passo) ----------
const GUIDE = {
  gemini: { label: 'Google Gemini', sub: 'Chave gratuita no Google AI Studio', url: 'https://aistudio.google.com/apikey', site: 'Google AI Studio', how: 'Entre com sua conta Google, toque em "Create API key" e copie a chave.' },
  openai: { label: 'ChatGPT (OpenAI)', sub: 'Chave paga por uso, na plataforma da OpenAI', url: 'https://platform.openai.com/api-keys', site: 'OpenAI', how: 'Entre, toque em "Create new secret key" e copie a chave. É preciso ter saldo na conta da API.' },
  anthropic: { label: 'Claude (Anthropic)', sub: 'Chave paga por uso, no console da Anthropic', url: 'https://console.anthropic.com/settings/keys', site: 'Anthropic Console', how: 'Entre, toque em "Create Key" e copie a chave. É preciso ter saldo na conta da API.' },
  openrouter: { label: 'OpenRouter', sub: '', url: 'https://openrouter.ai/keys', site: 'OpenRouter', how: '' },
  custom: { label: 'Outro / servidor próprio', sub: 'Qualquer serviço compatível com a API da OpenAI (ex.: Ollama)' },
};
const detectKey = k => /^sk-or-/.test(k) ? 'openrouter' : /^sk-ant-/.test(k) ? 'anthropic' : /^AIza/.test(k) ? 'gemini' : /^sk-/.test(k) ? 'openai' : null;
U.connectAI = () => {
  const m = modal({ title: 'Conectar uma IA', body: h('div'), footer: [] });
  const done = async ai => {
    await AIS.reloadAIs(); let t = { ok: true }; try { t = await api('POST', `/api/ais/${ai.id}/test`); } catch {}
    m.el.querySelector('h2').textContent = 'Tudo certo!';
    m.setBody(h('div', { style: 'text-align:center;padding:10px' }, [h('div', { style: 'display:flex;justify-content:center', html: av(ai, { cls: 'lg', ai: true }) }), h('h3', {}, `${ai.name} está conectada`), h('p', { class: 'muted' }, `Modelo: ${ai.model}. Você pode trocar o modelo ou a IA quando quiser, sem perder a conversa.`), t.ok ? null : h('p', { class: 'err' }, `Atenção: o teste falhou (${t.error}). Confira a chave em Configurações → Minhas IAs.`)]));
    m.foot.replaceChildren(h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar'), h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('POST', '/api/chats/ai', { aiId: ai.id }); m.close(); open(r.chat); } catch (e) { fail(e); } } }, 'Conversar agora'));
  };
  const home = () => {
    m.el.querySelector('h2').textContent = 'Conectar uma IA'; m.foot.replaceChildren();
    const card = (k, g) => h('button', { class: 'card row', style: 'width:100%;text-align:left;cursor:pointer', onclick: () => key(k), html: `<div class="grow"><b>${esc(g.label)}</b><div class="small muted">${esc(g.sub)}</div></div>${ic('back').replace('<svg', '<svg style="transform:rotate(180deg)"')}` });
    const or = h('button', { class: 'btn primary', style: 'width:100%;padding:14px;flex-direction:column;gap:2px', onclick: async e => { e.currentTarget.disabled = true; try { const r = await api('POST', '/api/oauth/openrouter/start'); location.href = r.url; } catch (x) { fail(x); e.currentTarget.disabled = false; } } }, [h('span', {}, 'Conectar com OpenRouter'), h('small', { style: 'font-weight:500;opacity:.85' }, 'Mais fácil: toque, entre e autorize. Tem modelos grátis.')]);
    m.setBody(h('div', {}, [h('p', { class: 'muted', style: 'margin-top:0' }, 'Escolha de onde vem a sua IA. Você só faz isso uma vez.'), or, h('div', { class: 'small muted', style: 'margin:16px 0 8px;text-align:center' }, 'ou use uma chave que você já tem'), ...['gemini', 'openai', 'anthropic', 'custom'].map(k => card(k, GUIDE[k])),
      h('p', { class: 'small muted' }, 'Importante: assinaturas como ChatGPT Plus e Claude Pro não incluem chave de API. A chave vem de uma conta de desenvolvedor, separada, no site do provedor.')]));
  };
  const key = prov => {
    const g = () => GUIDE[prov]; m.el.querySelector('h2').textContent = g().label;
    const k = inp({ type: 'password', autocomplete: 'off', placeholder: 'Cole a chave aqui', style: 'flex:1' }), base = inp({ placeholder: 'https://servidor/v1' }), model = inp({ placeholder: 'nome do modelo' }), name = inp({ placeholder: 'Nome da IA (opcional)', maxlength: 30 }), ins = h('textarea', { class: 'inp', placeholder: 'Personalidade e instruções (opcional)' }), note = h('div', { class: 'small', style: 'color:var(--ok)' }), er = h('div', { class: 'err' });
    k.oninput = () => { const d = detectKey(k.value.trim()); if (d && d !== prov && prov !== 'custom') { prov = d; m.el.querySelector('h2').textContent = g().label; note.textContent = `Reconheci uma chave do ${g().label}.`; } };
    const paste = h('button', { type: 'button', class: 'btn', onclick: async () => { try { k.value = (await navigator.clipboard.readText()).trim(); k.oninput(); } catch { toast('Não consegui colar sozinho. Toque no campo e cole.'); k.focus(); } } }, 'Colar');
    const steps = prov === 'custom' ? [field('URL do servidor', base), field('Chave (se o servidor exigir)', h('div', { class: 'row' }, [k])), field('Modelo', model)] : [
      h('ol', { style: 'padding-left:20px;line-height:1.6' }, [h('li', {}, ['Toque para abrir o site do ', h('a', { href: g().url, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent);font-weight:700' }, g().site), '.']), h('li', {}, g().how), h('li', {}, 'Volte para o app e cole a chave abaixo.')]),
      h('div', { class: 'row' }, [k, paste]), note];
    const go = h('button', { class: 'btn primary' }, 'Conectar');
    m.setBody(h('div', {}, [...steps, h('details', { style: 'margin-top:14px' }, [h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Opções avançadas'), h('div', { style: 'margin-top:10px' }, [field('Nome', name), ...(prov === 'custom' ? [] : [field('Modelo (deixe vazio para escolher automaticamente)', model)]), field('Instruções', ins)])]), er]));
    m.foot.replaceChildren(h('button', { class: 'btn', onclick: home }, 'Voltar'), go);
    go.onclick = async () => { er.textContent = ''; go.disabled = true; go.textContent = 'Conectando…'; try { const r = await api('POST', '/api/ais', { provider: prov, apiKey: k.value, baseUrl: base.value, model: model.value, name: name.value, instructions: ins.value }); await done(r.ai); } catch (e) { er.textContent = e.message; go.disabled = false; go.textContent = 'Conectar'; } };
  };
  home();
};
U.editAI = ai => {
  const name = inp({ value: ai.name }), key = inp({ type: 'password', placeholder: `Chave atual: ${ai.keyHint || 'nenhuma'} (deixe vazio para manter)` }), model = inp({ value: ai.model, list: 'mdl' }), dl = h('datalist', { id: 'mdl' }), ins = h('textarea', { class: 'inp' }); ins.value = ai.instructions || '';
  const fetchBtn = h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { const r = await api('GET', `/api/ais/${ai.id}/models`); dl.replaceChildren(...r.models.map(x => h('option', { value: x }))); toast(`${r.models.length} modelos disponíveis`, 'ok'); } catch (e) { fail(e); } } }, 'Buscar modelos da minha conta');
  const m = modal({ title: `Editar ${ai.name}`, body: h('div', {}, [field('Nome', name), field('Modelo', h('div', {}, [model, dl, h('div', { style: 'margin-top:6px' }, fetchBtn)])), field('Nova chave de API', key), field('Instruções', ins)]),
    footer: [h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Desconectar IA', `${ai.name} sairá de todos os chats e os compartilhamentos serão encerrados. O histórico continua salvo.`, 'Desconectar', true)) try { await api('DELETE', `/api/ais/${ai.id}`); m.close(); await AIS.reloadAIs(); toast('IA desconectada', 'ok'); } catch (e) { fail(e); } } }, 'Desconectar'),
      h('button', { class: 'btn primary', onclick: async () => { try { await api('PATCH', `/api/ais/${ai.id}`, { name: name.value, model: model.value, apiKey: key.value, instructions: ins.value }); await AIS.reloadAIs(); m.close(); toast('Salvo', 'ok'); } catch (e) { fail(e); } } }, 'Salvar')] });
};
U.switchModel = ai => U.editAI(ai);

// ---------- Trocar IA da conversa ----------
U.switchAI = chat => {
  const cur = AIS.currentAI(chat), opts = allAIs().filter(a => a.id !== cur?.id); let pick = null, ctx = 'full';
  if (!opts.length) { const m = modal({ title: 'Trocar IA da conversa', body: h('div', { class: 'empty' }, [h('p', {}, 'Você ainda não tem outra IA disponível. Conecte outra IA para continuar esta conversa com ela.')]), footer: h('button', { class: 'btn primary', onclick: () => { m.close(); U.connectAI(); } }, 'Conectar IA') }); return; }
  const list = h('div'), go = h('button', { class: 'btn primary', disabled: true }, 'Trocar IA');
  const paint = () => list.replaceChildren(...opts.map(a => h('div', { class: 'card row', style: `cursor:pointer;${pick === a.id ? 'border-color:var(--accent);background:var(--accent-soft)' : ''}`, onclick: () => { pick = a.id; go.disabled = false; paint(); }, html: `${av(a, { ai: true })}<div class="grow"><b>${esc(a.name)}</b><div class="small muted">${esc(PL(a.provider))} · ${esc(a.model)}${a.ownerName ? ` · de ${esc(a.ownerName)} (compartilhada)` : ''}</div></div>` })));
  paint();
  const ctxBox = h('div', { class: 'chips' }, [['full', 'Manter todo o histórico'], ['summary', 'Enviar um resumo'], ['none', 'Começar sem contexto']].map(([k, l]) => h('button', { type: 'button', class: 'chip' + (ctx === k ? ' on' : ''), onclick: e => { ctx = k; $$('.chip', ctxBox).forEach(c => c.classList.toggle('on', c === e.currentTarget)); note.textContent = notes[k]; } }, l)));
  const notes = { full: 'A nova IA lê toda a conversa anterior (se for grande demais para o modelo, o provedor pode recusar; aí use o resumo).', summary: 'A nova IA gera um resumo da conversa com a sua conexão, o que consome uso dela, e continua a partir dele.', none: 'As mensagens antigas continuam visíveis para você, mas a nova IA não as recebe.' };
  const note = h('p', { class: 'small muted' }, notes.full);
  const m = modal({ title: 'Trocar IA da conversa', body: h('div', {}, [h('p', { class: 'muted' }, `O histórico fica neste chat. Só muda a IA que responde${cur ? ` (hoje: ${cur.name})` : ''}.`), list, h('div', { class: 'sec', style: 'margin-top:16px' }, [h('h3', {}, 'Contexto para a nova IA'), ctxBox, note])]), footer: go });
  go.onclick = async () => { go.disabled = true; go.textContent = ctx === 'summary' ? 'Gerando resumo…' : 'Trocando…'; try { const r = await api('POST', `/api/chats/${chat.id}/switch-ai`, { aiId: pick, context: ctx }); m.close(); S.chats.set(chat.id, r.chat); S.msgs.delete(chat.id); AIS.openChat(chat.id, true); toast('IA trocada. O histórico foi mantido.', 'ok'); } catch (e) { fail(e); go.disabled = false; go.textContent = 'Trocar IA'; } };
};
// Conversas desta IA (menu ⋮)
U.aiChats = async ai => {
  const box = h('div', {}, h('div', { class: 'empty' }, 'Carregando…')), m = modal({ title: `Conversas de ${ai.name}`, body: box });
  try { const r = await api('GET', `/api/ais/${ai.id}/chats`); box.replaceChildren(...(r.chats.length ? r.chats.map(c => h('div', { class: 'ci', style: 'border-radius:10px', onclick: () => { m.close(); S.chats.set(c.id, c); AIS.openChat(c.id); }, html: `${av(AIS.chatEntity(c), { ai: c.type === 'ai', cls: 'sm' })}<div class="grow"><b>${esc(AIS.chatTitle(c))}</b><div class="small muted ellipsis">${esc(c.last?.text?.slice(0, 80) || 'Sem mensagens')}</div></div>` })) : [h('div', { class: 'empty' }, 'Nenhuma conversa com essa IA ainda.')])); } catch (e) { box.textContent = e.message; }
};

// ---------- Nova conversa / contatos / grupos ----------
U.newChat = () => {
  const box = h('div'), m = modal({ title: 'Nova conversa', body: box });
  const sec = (t, items, empty) => h('div', { class: 'sec' }, [h('h3', {}, t), ...(items.length ? items : [h('div', { class: 'small muted' }, empty)])]);
  const ais = allAIs().map(a => h('div', { class: 'ci', style: 'border-radius:10px', onclick: async () => { try { const r = await api('POST', '/api/chats/ai', { aiId: a.id }); m.close(); open(r.chat); } catch (e) { fail(e); } }, html: `${av(a, { ai: true, cls: 'sm' })}<div><b>${esc(a.name)}</b> <span class="badge ai">IA</span><div class="small muted">${esc(PL(a.provider))} · ${esc(a.model)}</div></div>` }));
  const cs = S.contacts.filter(c => c.status === 'accepted').map(c => h('div', { class: 'ci', style: 'border-radius:10px', onclick: async () => { try { const r = await api('POST', '/api/chats/dm', { userId: c.id }); m.close(); open(r.chat); } catch (e) { fail(e); } }, html: `${av(c, { cls: 'sm' })}<b>${esc(c.username)}</b>` }));
  box.append(h('div', { class: 'row', style: 'margin-bottom:14px;flex-wrap:wrap' }, [h('button', { class: 'btn', onclick: () => { m.close(); U.connectAI(); } }, 'Conectar IA'), h('button', { class: 'btn', onclick: () => { m.close(); U.addContact(); } }, 'Adicionar contato'), h('button', { class: 'btn', onclick: () => { m.close(); U.newGroup(); } }, 'Criar grupo')]), sec('Minhas IAs e compartilhadas', ais, 'Nenhuma IA conectada ainda.'), sec('Contatos', cs, 'Nenhum contato ainda.'));
};
U.addContact = pre => {
  const num = inp({ placeholder: '+AI 000 000 000', inputmode: 'tel', value: pre || '' }), res = h('div'), pend = S.contacts.filter(c => c.status === 'pending_in');
  const look = async () => { res.replaceChildren(); try { const r = await api('GET', '/api/users/lookup?number=' + encodeURIComponent(num.value)); const add = h('button', { class: 'btn primary sm', disabled: r.status === 'accepted' || r.status === 'pending_out' }, r.status === 'accepted' ? 'Já é contato' : r.status === 'pending_out' ? 'Solicitação enviada' : 'Adicionar');
    add.onclick = async () => { try { const x = await api('POST', '/api/contacts', { number: num.value }); toast(x.status === 'accepted' ? 'Contato adicionado' : 'Solicitação enviada', 'ok'); await AIS.reloadContacts(); add.disabled = true; } catch (e) { fail(e); } };
    res.append(h('div', { class: 'card row', html: `${av(r.profile)}<div class="grow"><b>${esc(r.profile.username)}</b><div class="small muted">${esc(r.profile.number)}${r.profile.bio ? ' · ' + esc(r.profile.bio) : ''}</div></div>` }, add)); } catch (e) { res.append(h('div', { class: 'err' }, e.message)); } };
  num.onkeydown = e => e.key === 'Enter' && look();
  modal({ title: 'Adicionar contato', body: h('div', {}, [field('Número AIsConnect da pessoa', num), h('button', { class: 'btn', onclick: look }, 'Buscar'), res, h('div', { class: 'card', style: 'margin-top:14px' }, [h('div', { class: 'small muted' }, 'Seu número (pode compartilhar livremente)'), h('div', { class: 'row' }, [h('b', { class: 'grow', style: 'font-size:18px' }, S.me.number), h('button', { class: 'btn sm', onclick: () => copyText(S.me.number).then(() => toast('Número copiado', 'ok')) }, 'Copiar')])]),
    ...(pend.length ? [h('div', { class: 'sec', style: 'margin-top:14px' }, [h('h3', {}, 'Solicitações recebidas'), ...pend.map(p => h('div', { class: 'card row', html: `${av(p, { cls: 'sm' })}<b class="grow">${esc(p.username)}</b>` }, h('button', { class: 'btn primary sm', onclick: async e => { try { await api('POST', `/api/contacts/${p.id}/accept`); await AIS.reloadContacts(); e.target.disabled = true; e.target.textContent = 'Aceito'; } catch (x) { fail(x); } } }, 'Aceitar')))])] : [])]) });
  if (pre) look();
};
U.newGroup = () => {
  const name = inp({ placeholder: 'Nome do grupo', maxlength: 60 }), desc = inp({ placeholder: 'Descrição (opcional)' }), sel = new Set(), selAI = new Set();
  const chk = (set, id, label, sub, entity, ai) => h('label', { class: 'card row', style: 'cursor:pointer' }, [h('input', { type: 'checkbox', onchange: e => e.target.checked ? set.add(id) : set.delete(id) }), h('span', { html: av(entity, { cls: 'sm', ai }) }), h('span', { class: 'grow' }, [h('b', {}, label), h('div', { class: 'small muted' }, sub)])]);
  const m = modal({ title: 'Criar grupo', body: h('div', {}, [field('Nome', name), field('Descrição', desc), h('div', { class: 'sec' }, [h('h3', {}, 'Pessoas'), ...(S.contacts.filter(c => c.status === 'accepted').map(c => chk(sel, c.id, c.username, c.number, c)) || []), ...(S.contacts.some(c => c.status === 'accepted') ? [] : [h('div', { class: 'small muted' }, 'Adicione contatos para convidá-los.')])]), h('div', { class: 'sec' }, [h('h3', {}, 'Minhas IAs no grupo (respondem só quando mencionadas com @)'), ...(S.ais.mine.length ? S.ais.mine.map(a => chk(selAI, a.id, a.name, `${PL(a.provider)} · ${a.model}`, a, true)) : [h('div', { class: 'small muted' }, 'Nenhuma IA conectada.')])])]),
    footer: h('button', { class: 'btn primary', onclick: async () => { try { const r = await api('POST', '/api/chats/group', { title: name.value, description: desc.value, userIds: [...sel], aiIds: [...selAI] }); m.close(); open(r.chat); } catch (e) { fail(e); } } }, 'Criar grupo') });
};
U.addAIToGroup = c => { const opts = S.ais.mine.filter(a => !c.ais.some(x => x.id === a.id && x.member)); const m = modal({ title: 'Adicionar minha IA ao grupo', body: h('div', {}, opts.length ? opts.map(a => h('div', { class: 'ci', style: 'border-radius:10px', onclick: async () => { try { await api('POST', `/api/chats/${c.id}/ais`, { aiId: a.id }); m.close(); toast(`${a.name} entrou no grupo`, 'ok'); } catch (e) { fail(e); } }, html: `${av(a, { ai: true, cls: 'sm' })}<b>${esc(a.name)}</b>` })) : h('div', { class: 'empty' }, 'Todas as suas IAs já estão neste grupo (ou você não tem IAs).')) }); };
U.autoDialog = c => {
  const ais = c.ais.filter(a => a.member && a.usable), sel = new Set(ais.map(a => a.id)), topic = h('textarea', { class: 'inp', placeholder: 'Tema da discussão' }), rounds = inp({ type: 'number', value: 3, min: 1, max: 20 });
  const m = modal({ title: 'IAs conversam', body: h('div', {}, [h('p', { class: 'muted' }, 'As IAs escolhidas conversam entre si, com limite de rodadas, e você pode parar a qualquer momento. Consome o uso das conexões.'), ...ais.map(a => h('label', { class: 'card row' }, [h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? sel.add(a.id) : sel.delete(a.id) }), h('b', {}, a.name)])), field('Tema', topic), field('Rodadas', rounds)]),
    footer: h('button', { class: 'btn primary', onclick: async () => { try { await api('POST', `/api/chats/${c.id}/auto`, { aiIds: [...sel], rounds: +rounds.value, topic: topic.value }); m.close(); } catch (e) { fail(e); } } }, 'Iniciar') });
};
U.share = (c, ai) => {
  const mine = ai ? [ai] : S.ais.mine.filter(a => c.ais.some(x => x.id === a.id && x.member)); let aiId = mine[0]?.id, min = 30, toUser = null;
  if (!mine.length) return toast('Adicione uma das suas IAs ao grupo para compartilhá-la.', 'err');
  const lim = inp({ type: 'number', min: 1, placeholder: 'sem limite' }), custom = inp({ type: 'number', min: 1, placeholder: 'min' }), sel = h('select', { class: 'inp' }, mine.map(a => h('option', { value: a.id }, a.name))); sel.onchange = () => aiId = sel.value;
  const durs = [[5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hora'], [1440, '24 horas']], chips = h('div', { class: 'chips' }, durs.map(([v, l]) => h('button', { type: 'button', class: 'chip' + (v === 30 ? ' on' : ''), 'data-v': v, onclick: e => { min = v; $$('.chip', chips).forEach(x => x.classList.toggle('on', x === e.currentTarget)); } }, l)));
  const others = c.type === 'ai' ? S.contacts.filter(x => x.status === 'accepted') : [], who = h('select', { class: 'inp' }, others.map(o => h('option', { value: o.id }, o.username))); who.onchange = () => toUser = who.value; toUser = others[0]?.id;
  const m = modal({ title: 'Compartilhar IA temporariamente', body: h('div', {}, [h('p', { class: 'muted' }, 'Quem recebe usa a IA pelo servidor, dentro dos limites. A sua chave nunca é revelada, e você revoga quando quiser.'), ...(ai ? [] : [field('IA', sel)]), c.type === 'ai' ? field('Compartilhar com', others.length ? who : h('span', { class: 'small muted' }, 'Adicione um contato primeiro.')) : h('p', {}, `Com todo o grupo "${c.title}".`), field('Duração', chips), field('Duração personalizada (minutos)', custom), field('Limite de mensagens', lim)]),
    footer: h('button', { class: 'btn primary', onclick: async () => { try { await api('POST', `/api/ais/${aiId}/shares`, { ...(c.type === 'ai' ? { userId: toUser } : { chatId: c.id }), minutes: +custom.value || min, maxMessages: lim.value }); m.close(); toast('Compartilhamento criado', 'ok'); AIS.refreshChat(c.id); AIS.reloadAIs(); } catch (e) { fail(e); } } }, 'Compartilhar') });
};
U.chatInfo = c => {
  const body = h('div', {}, [h('div', { style: 'display:flex;justify-content:center;margin-bottom:10px', html: av(AIS.chatEntity(c), { cls: 'lg', ai: c.type === 'ai' }) }), h('h2', { style: 'text-align:center;margin:0' }, AIS.chatTitle(c)), c.description ? h('p', { class: 'muted', style: 'text-align:center' }, c.description) : null]);
  if (c.type === 'ai') { const a = AIS.currentAI(c); if (a) body.append(h('p', { style: 'text-align:center' }, `${PL(a.provider)} · ${a.model}`), h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap' }, [h('button', { class: 'btn', onclick: () => U.switchAI(c) }, 'Trocar IA'), a.ownerId === S.me.id ? h('button', { class: 'btn', onclick: () => U.editAI(S.ais.mine.find(x => x.id === a.id)) }, 'Editar') : null])); }
  else { body.append(h('div', { class: 'sec', style: 'margin-top:14px' }, [h('h3', {}, `Participantes (${c.members.length})`), ...c.members.map(u => h('div', { class: 'row', style: 'padding:6px 0', html: `${av(u, { cls: 'sm', online: u.online })}<div class="grow"><b>${esc(u.username)}${u.id === S.me.id ? ' (você)' : ''}</b><div class="small muted">${esc(u.number)}${u.role !== 'member' ? ' · ' + (u.role === 'owner' ? 'criador' : 'admin') : ''}</div></div>` })), ...c.ais.filter(a => a.member).map(a => h('div', { class: 'row', style: 'padding:6px 0', html: `${av(a, { cls: 'sm', ai: true })}<div class="grow"><b>${esc(a.name)}</b> <span class="badge ai">IA</span><div class="small muted">${esc(PL(a.provider))} · ${esc(a.model)}</div></div>` }))])); }
  modal({ title: c.type === 'group' ? 'Informações do grupo' : 'Informações', body });
};

// ---------- Configurações ----------
U.settings = () => {
  const box = h('div'); const m = modal({ title: 'Configurações', body: box, wide: true });
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'sec' }, [h('h3', {}, 'Perfil'), h('div', { class: 'row', html: `${av(S.me)}<div class="grow"><b>${esc(S.me.username)}</b><div class="small muted">${esc(S.me.number)} · seu número público</div></div>` }, h('button', { class: 'btn sm', onclick: () => copyText(S.me.number).then(() => toast('Número copiado', 'ok')) }, 'Copiar número'))]),
      h('div', { class: 'sec' }, [h('h3', {}, 'Aparência'), h('div', { class: 'chips' }, [['system', 'Seguir o sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => h('button', { class: 'chip' + (AIS.getTheme() === k ? ' on' : ''), onclick: () => { AIS.setTheme(k); draw(); } }, l)))]),
      h('div', { class: 'sec' }, [h('h3', {}, 'Minhas IAs'), ...(S.ais.mine.length ? S.ais.mine.map(a => h('div', { class: 'card row', html: `${av(a, { ai: true })}<div class="grow"><b>${esc(a.name)}</b><div class="small muted">${esc(PL(a.provider))} · ${esc(a.model)} · chave ${esc(a.keyHint || '—')}</div></div>` }, [h('button', { class: 'btn sm', onclick: () => { m.close(); U.editAI(a); } }, 'Editar')])) : [h('div', { class: 'small muted', style: 'margin-bottom:8px' }, 'Nenhuma IA conectada.')]), h('button', { class: 'btn primary', onclick: () => { m.close(); U.connectAI(); } }, 'Conectar IA')]),
      h('div', { class: 'sec' }, [h('h3', {}, 'Notificações'), h('button', { class: 'btn', onclick: async () => { const r = await Notification?.requestPermission?.(); toast(r === 'granted' ? 'Notificações ativadas' : 'Permissão não concedida'); } }, 'Ativar notificações do navegador')]),
      h('div', { class: 'sec' }, [h('h3', {}, 'Conta'), h('button', { class: 'btn danger', onclick: async () => { try { await api('POST', '/api/logout'); } catch {} m.close(); AIS.authView(); } }, 'Sair desta conta')]));
  }; draw();
};
})();
