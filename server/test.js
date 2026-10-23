'use strict';
// Testes de ponta a ponta. Usa um servidor de IA falso (compatível com OpenAI) apenas para testar.
process.env.AIS_ALLOW_PRIVATE_URLS = '1';
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
process.env.AIS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-'));
const { server } = require('./index.js'); const S = require('./security');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘ FALHOU:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- IA falsa ---
const aiCalls = [];
const mock = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'mock-1' }, { id: 'mock-2' }] })); }
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const body = JSON.parse(b), tag = (req.headers.authorization || '').replace('Bearer key-', ''), last = body.messages[body.messages.length - 1].content;
    aiCalls.push({ tag, body });
    if (typeof last === 'string' && /FORCE429[^\n]*$/.test(last)) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"rate limit"}}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const words = `Resposta de ${tag} com ${body.messages.length} mensagens.`.split(' ');
    (async () => { for (const w of words) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' } }] })}\n\n`); await sleep(15); }
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`); res.end(); })();
  });
});

function client(base) {
  const c = { cookie: '' };
  c.api = async (method, url, body, extra = {}) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(extra.noCsrf ? {} : { 'x-ais': '1' }), cookie: c.cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) c.cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j };
  };
  c.ws = () => new Promise((res, rej) => {
    const w = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie } }); const ev = [];
    w.onmessage = m => ev.push(JSON.parse(m.data)); w.onopen = () => res({ ev, send: o => w.send(JSON.stringify(o)), close: () => w.close(), raw: w, waitFor: async (p, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const f = ev.find(p); if (f) return f; await sleep(20); } return null; } });
    w.onerror = () => rej(new Error('ws falhou'));
  });
  return c;
}

(async () => {
  await new Promise(r => mock.listen(0, r)); await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port, mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  const P = client(base), J = client(base), X = client(base);

  console.log('Contas e segurança');
  let r = await P.api('POST', '/api/register', { username: 'pedro', password: '123' }); ok(r.status === 400, 'senha fraca recusada');
  r = await P.api('POST', '/api/register', { username: 'pedro', password: 'senha-forte-123' }); ok(r.status === 200 && /^\+AI \d{3} \d{3} \d{3}$/.test(r.user.number) && r.recoveryCodes.length === 10, 'cadastro gera número público e códigos de recuperação');
  const pedro = r.user, pedroCodes = r.recoveryCodes;
  ok(!JSON.stringify(r).includes('pw_hash'), 'hash da senha não vaza');
  r = await P.api('POST', '/api/register', { username: 'PEDRO', password: 'senha-forte-123' }); ok(r.status === 409, 'nome de usuário duplicado recusado');
  r = await J.api('POST', '/api/register', { username: 'joao', password: 'outra-senha-456' }); const joao = r.user;
  r = await X.api('POST', '/api/register', { username: 'intruso', password: 'intruso-senha-789' });
  ok(pedro.number !== joao.number, 'números públicos diferentes');
  r = await P.api('POST', '/api/me/password', {}, { noCsrf: true }); ok(r.status === 403, 'CSRF: requisição sem cabeçalho é bloqueada');
  const anon = client(base); r = await anon.api('GET', '/api/chats'); ok(r.status === 401, 'rotas privadas exigem sessão');
  const row = require('./index.js').ctx.db.get('SELECT pw_hash FROM users WHERE username=?', 'pedro'); ok(/^(scrypt|\$argon2id)/.test(row.pw_hash) && !row.pw_hash.includes('senha-forte'), 'senha armazenada só como hash');
  const bad = client(base); let last; for (let i = 0; i < 9; i++) last = await bad.api('POST', '/api/login', { username: 'joao', password: 'errada-errada' }); ok(last.status === 429, 'bloqueio após muitas tentativas de login');
  r = await client(base).api('POST', '/api/login', { username: 'naoexiste', password: 'x' }); const r2 = await client(base).api('POST', '/api/login', { username: 'pedro', password: 'x' }); ok(r.error === r2.error, 'mensagem de erro igual para usuário inexistente (sem enumeração)');

  console.log('Contatos');
  r = await P.api('GET', '/api/users/lookup?number=' + encodeURIComponent(joao.number)); ok(r.profile?.username === 'joao' && !r.profile.id, 'busca por número não expõe o identificador interno');
  r = await P.api('POST', '/api/contacts', { number: joao.number }); ok(r.status === 'pending_out', 'solicitação de contato fica pendente');
  const jc = await J.api('GET', '/api/contacts'); ok(jc.contacts[0].status === 'pending_in', 'João vê solicitação recebida');
  r = await J.api('POST', `/api/contacts/${pedro.id}/accept`); ok(r.ok, 'João aceita');
  r = await P.api('POST', '/api/chats/dm', { userId: joao.id }); const dm = r.chat; ok(dm?.type === 'dm', 'conversa individual criada');
  r = await X.api('GET', `/api/chats/${dm.id}/messages`); ok(r.status === 404, 'estranho não lê a conversa');
  r = await X.api('POST', `/api/chats/${dm.id}/messages`, { text: 'oi' }); ok(r.status === 404, 'estranho não envia na conversa');

  console.log('Tempo real e mensagens');
  const wsP = await P.ws(), wsJ = await J.ws(), wsX = await X.ws();
  r = await P.api('POST', `/api/chats/${dm.id}/messages`, { text: 'Olá João' }); ok(r.message?.text === 'Olá João', 'mensagem enviada');
  ok(await wsJ.waitFor(e => e.t === 'msg.new' && e.msg.text === 'Olá João'), 'João recebe em tempo real');
  ok(!wsX.ev.some(e => e.t === 'msg.new'), 'estranho não recebe eventos da conversa');
  wsJ.send({ t: 'read', chatId: dm.id, seq: r.message.seq }); ok(await wsP.waitFor(e => e.t === 'receipt' && e.readSeq >= 1), 'confirmação de leitura chega ao remetente');
  r = await J.api('POST', `/api/messages/${(await P.api('GET', `/api/chats/${dm.id}/messages`)).messages[0].id}/react`, { emoji: '👍' }); ok(r.message.reactions['👍'].length === 1, 'reação');
  r = await J.api('PATCH', `/api/messages/${r.message.id}`, { text: 'x' }); ok(r.status === 403, 'não edita mensagem de outra pessoa');

  console.log('IAs reais (provedor falso)');
  r = await P.api('POST', '/api/ais', { name: 'Luna', provider: 'custom', baseUrl: mockUrl, apiKey: 'key-LUNA', model: 'mock-1', instructions: 'seja gentil' }); const luna = r.ai; ok(luna?.keyHint === '••••LUNA' && !JSON.stringify(r).includes('key-LUNA'), 'chave nunca retorna ao cliente');
  r = await P.api('POST', `/api/ais/${luna.id}/test`); ok(r.ok, 'testar conexão');
  r = await P.api('GET', `/api/ais/${luna.id}/models`); ok(r.models.includes('mock-2'), 'lista só modelos reais do provedor');
  const raw = require('./index.js').ctx.db.get('SELECT enc_key FROM ais WHERE id=?', luna.id).enc_key; ok(!raw.includes('LUNA') && S.decrypt(raw) === 'key-LUNA', 'chave criptografada no banco (AES-256-GCM)');
  r = await P.api('POST', '/api/chats/ai', { aiId: luna.id }); const lc = r.chat; ok(lc.type === 'ai', 'conversa individual com IA criada vazia');
  r = await J.api('POST', '/api/chats/ai', { aiId: luna.id }); ok(r.status === 403, 'João não pode usar a IA do Pedro');
  await P.api('POST', `/api/chats/${lc.id}/messages`, { text: 'Oi Luna' });
  const done = await wsP.waitFor(e => e.t === 'msg.done' && e.msg.chatId === lc.id); ok(done && /Resposta de LUNA/.test(done.msg.text) && done.msg.status === 'done', 'IA responde pelo provedor com streaming');
  ok(wsP.ev.some(e => e.t === 'msg.delta' && e.chatId === lc.id), 'trechos chegam progressivamente');
  ok(aiCalls.at(-1).body.messages[0].role === 'system' && /seja gentil/.test(aiCalls.at(-1).body.messages[0].content), 'instruções personalizadas enviadas');
  await P.api('POST', `/api/chats/${lc.id}/messages`, { text: 'FORCE429 agora' });
  const er = await wsP.waitFor(e => e.t === 'msg.done' && e.msg.chatId === lc.id && e.msg.status === 'error'); ok(er?.msg.error.code === 'rate', 'limite do provedor vira erro claro (rate)');

  console.log('Trocar IA mantendo o histórico');
  r = await P.api('POST', '/api/ais', { name: 'Gemi', provider: 'custom', baseUrl: mockUrl, apiKey: 'key-GEMI', model: 'mock-2' }); const gemi = r.ai;
  const before = aiCalls.length;
  r = await P.api('POST', `/api/chats/${lc.id}/switch-ai`, { aiId: gemi.id, context: 'full' }); ok(r.chat?.title === 'Gemi', 'IA trocada no mesmo chat');
  await P.api('POST', `/api/chats/${lc.id}/messages`, { text: 'Você lembra do que falei?' });
  const d2 = await wsP.waitFor(e => e.t === 'msg.done' && e.msg.senderId === gemi.id); ok(d2 && /GEMI/.test(d2.msg.text), 'nova IA responde');
  const sent = aiCalls.at(-1).body.messages; ok(sent.some(m => /Oi Luna/.test(JSON.stringify(m.content))) && sent.some(m => /LUNA/.test(JSON.stringify(m.content))), 'nova IA recebeu todo o histórico anterior');
  r = await P.api('GET', `/api/chats/${lc.id}/messages`); ok(r.messages.some(m => m.kind === 'system' && /IA alterada de Luna para Gemi/.test(m.text)), 'aviso discreto "IA alterada"');
  ok(r.messages.some(m => m.senderId === luna.id) && r.messages.some(m => m.senderId === gemi.id), 'mensagens antigas continuam com a autora original');
  r = await P.api('GET', `/api/ais/${luna.id}/chats`); ok(r.chats.some(c => c.id === lc.id), 'menu ⋮ "conversas desta IA" lista o chat da IA anterior');
  r = await P.api('PATCH', `/api/ais/${gemi.id}`, { model: 'mock-1' }); r = await P.api('GET', `/api/chats/${lc.id}/messages`); ok(r.messages.some(m => /Modelo de Gemi alterado/.test(m.text)), 'trocar modelo registra aviso e mantém histórico');

  console.log('Grupos, @menções e compartilhamento');
  r = await P.api('POST', '/api/chats/group', { title: 'Marte', userIds: [joao.id], aiIds: [luna.id] }); const g = r.chat; ok(g.members.length === 2 && g.ais.length === 1, 'grupo com humanos e IA');
  const menc = [{ kind: 'ai', id: luna.id }];
  await J.api('POST', `/api/chats/${g.id}/messages`, { text: '@Luna oi', mentions: menc });
  ok(await wsJ.waitFor(e => e.t === 'notice' && /não respondeu/.test(e.text)), 'IA não autorizada não responde ao João');
  r = await P.api('POST', `/api/chats/${g.id}/messages`, { text: 'só conversa, sem menção' }); await sleep(300);
  ok(!(await P.api('GET', `/api/chats/${g.id}/messages`)).messages.some(m => m.kind === 'ai'), 'IA não responde sem ser mencionada');
  r = await P.api('POST', `/api/ais/${luna.id}/shares`, { chatId: g.id, minutes: 5, maxMessages: 1 }); const sh = r.share; ok(sh?.id, 'Pedro compartilha Luna com o grupo por 5 min (máx. 1 mensagem)');
  const nAI = () => ws => ws.ev.filter(e => e.t === 'msg.done' && e.msg.chatId === g.id && e.msg.kind === 'ai').length;
  await J.api('POST', `/api/chats/${g.id}/messages`, { text: '@Luna explica buracos negros', mentions: menc });
  await sleep(700); ok(nAI()(wsJ) === 1, 'João usa a IA compartilhada e todos veem a resposta');
  await J.api('POST', `/api/chats/${g.id}/messages`, { text: '@Luna outra pergunta', mentions: menc }); await sleep(500);
  ok(nAI()(wsJ) === 1 && wsJ.ev.some(e => e.t === 'notice' && /limite/.test(e.text)), 'limite de mensagens do compartilhamento é aplicado no servidor');
  r = await P.api('POST', `/api/ais/${luna.id}/shares`, { chatId: g.id, minutes: 5 }); const sh2 = r.share;
  await P.api('DELETE', `/api/shares/${sh2.id}`); await P.api('DELETE', `/api/shares/${sh.id}`);
  await J.api('POST', `/api/chats/${g.id}/messages`, { text: '@Luna e agora?', mentions: menc }); await sleep(400);
  ok(nAI()(wsJ) === 1, 'revogação bloqueia imediatamente');
  r = await J.api('GET', '/api/ais'); ok(!JSON.stringify(r).includes('key-') && !JSON.stringify(r).includes('enc_key'), 'compartilhamento nunca revela a chave');
  r = await P.api('GET', `/api/ais/${luna.id}/usage`); ok(r.usage.some(u => u.username === 'joao' && u.messages >= 1), 'dono acompanha o consumo por usuário');

  console.log('IAs conversam');
  r = await P.api('POST', `/api/chats/${g.id}/ais`, { aiId: gemi.id });
  const cnt0 = (await P.api('GET', `/api/chats/${g.id}/messages`)).messages.filter(m => m.kind === 'ai').length;
  r = await P.api('POST', `/api/chats/${g.id}/auto`, { aiIds: [luna.id, gemi.id], rounds: 2, topic: 'Discutam sobre cidades em Marte' }); ok(r.ok, 'conversa automática iniciada');
  for (let i = 0; i < 80 && (await P.api('GET', `/api/chats/${g.id}`)).chat.auto?.active; i++) await sleep(100);
  const fin = await P.api('GET', `/api/chats/${g.id}/messages`); const cnt1 = fin.messages.filter(m => m.kind === 'ai').length;
  ok(cnt1 - cnt0 === 4, 'parou sozinha após 2 rodadas (4 mensagens, sem loop infinito)');
  ok(fin.messages.some(m => /Conversa automática encerrada/.test(m.text)), 'aviso de encerramento');

  console.log('Chamadas (sinalização WebRTC)');
  wsP.send({ t: 'call.invite', chatId: dm.id, video: true });
  const inc = await wsJ.waitFor(e => e.t === 'call.incoming'); ok(inc?.video && inc.from.username === 'pedro', 'João recebe chamada de vídeo');
  wsJ.send({ t: 'call.accept', callId: inc.callId }); ok(await wsJ.waitFor(e => e.t === 'call.peers'), 'João atende');
  ok(await wsP.waitFor(e => e.t === 'call.joined'), 'Pedro é avisado');
  wsJ.send({ t: 'call.signal', callId: inc.callId, to: pedro.id, data: { sdp: 'oferta' } }); ok((await wsP.waitFor(e => e.t === 'call.signal'))?.data.sdp === 'oferta', 'sinalização é repassada entre os participantes');
  wsX.send({ t: 'call.signal', callId: inc.callId, to: pedro.id, data: { sdp: 'hack' } }); await sleep(150); ok(!wsP.ev.some(e => e.t === 'call.signal' && e.data.sdp === 'hack'), 'estranho não injeta sinalização');
  wsP.send({ t: 'call.leave', callId: inc.callId }); ok(await wsJ.waitFor(e => e.t === 'call.ended'), 'chamada encerrada');
  ok((await P.api('GET', `/api/chats/${dm.id}/messages`)).messages.some(m => /Chamada de vídeo encerrada/.test(m.text)), 'duração registrada no chat');

  console.log('Sessões, 2FA e recuperação');
  const P2 = client(base); r = await P2.api('POST', '/api/login', { username: 'pedro', password: 'senha-forte-123' }); ok(r.user, 'login em segundo dispositivo');
  r = await P.api('GET', '/api/sessions'); ok(r.sessions.length === 2, 'lista de dispositivos');
  const ws2 = await P2.ws(); r = await P.api('POST', '/api/sessions/revoke-others'); ok(await ws2.waitFor(e => e.t === 'session.revoked'), 'encerramento remoto desconecta o outro dispositivo');
  r = await P2.api('GET', '/api/me'); ok(r.status === 401, 'sessão revogada deixa de funcionar');
  r = await P.api('POST', '/api/me/2fa/setup', { password: 'errada-errada' }); ok(r.status === 403, '2FA exige senha');
  r = await P.api('POST', '/api/me/2fa/setup', { password: 'senha-forte-123' }); const secret = r.secret;
  r = await P.api('POST', '/api/me/2fa/enable', { code: S.totpNow(secret) }); ok(r.recoveryCodes?.length === 10, '2FA ativado com TOTP');
  const P3 = client(base); r = await P3.api('POST', '/api/login', { username: 'pedro', password: 'senha-forte-123' }); ok(r.need2fa, 'login pede o segundo fator');
  r = await P3.api('POST', '/api/login', { username: 'pedro', password: 'senha-forte-123', code: '000000' }); ok(r.status === 401, 'código errado recusado');
  const codes2 = r2 && null; r = await P.api('POST', '/api/me/recovery-codes', { password: 'senha-forte-123', code: S.totpNow(secret) });
  ok(r.status === 403 || r.recoveryCodes, 'código TOTP não pode ser reutilizado na mesma janela');
  const R4 = client(base); r = await R4.api('POST', '/api/recover', { username: 'joao', code: pedroCodes[0], newPassword: 'nova-senha-123456' }); ok(r.status === 400, 'recuperação com código de outra conta falha');
  const J2 = client(base); r = await J2.api('POST', '/api/recover', { username: 'joao', code: 'abcde-12345', newPassword: 'nova-senha-123456' }); ok(r.status === 400, 'recuperação só com usuário não funciona');

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
