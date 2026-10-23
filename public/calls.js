'use strict';
// Chamadas de voz/vídeo e compartilhamento de tela (WebRTC, malha de até 8 pessoas). Sinalização pelo WebSocket.
const CALLS = window.CALLS = (() => {
  let call = null, ring = null, iceServers = [{ urls: 'stun:stun.l.google.com:19302' }], timer = null;
  const send = o => AIS.send(o);
  const incomingBanners = new Map();

  function ringtone(on) {
    if (!on) { clearInterval(ring); ring = null; return; }
    if (ring) return; const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    try { const ac = new Ctx(); const beep = () => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 440; g.gain.value = .08; o.connect(g); g.connect(ac.destination); o.start(); setTimeout(() => o.stop(), 350); }; beep(); ring = setInterval(beep, 1500); } catch {}
  }
  async function media(video) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false }); }
    catch (e) {
      if (video) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); toast('Câmera indisponível. Entrando só com áudio.', 'err'); return s; } catch {} }
      throw new Error(location.protocol === 'http:' && !/^(localhost|127\.)/.test(location.hostname) ? 'Chamadas exigem HTTPS (ou localhost).' : 'Não foi possível acessar o microfone/câmera. Verifique as permissões do navegador.');
    }
  }

  function newCall(id, chatId, video, stream) {
    call = { id, chatId, video, local: stream, screen: null, peers: new Map(), startedAt: null, audioOn: true, videoOn: stream.getVideoTracks().length > 0, tiles: new Map() };
    buildUI(); addTile('me', 'Você', stream, true);
  }
  function peerName(uid) { return call.peers.get(uid)?.user?.username || 'Participante'; }

  function makePeer(user, polite) {
    const pc = new RTCPeerConnection({ iceServers }), p = { pc, user, polite, making: false, ignore: false, senders: [] };
    call.peers.set(user.id, p);
    for (const t of call.local.getTracks()) p.senders.push(pc.addTrack(t, call.local));
    if (call.screen) for (const t of call.screen.getTracks()) p.senders.push(pc.addTrack(t, call.screen));
    pc.onicecandidate = e => { if (e.candidate) send({ t: 'call.signal', callId: call.id, to: user.id, data: { candidate: e.candidate } }); };
    pc.onnegotiationneeded = async () => { try { p.making = true; await pc.setLocalDescription(); send({ t: 'call.signal', callId: call.id, to: user.id, data: { desc: pc.localDescription } }); } catch (e) { console.warn(e); } finally { p.making = false; } };
    pc.ontrack = e => {
      const st = e.streams[0] || new MediaStream([e.track]); const key = st.id;
      if (!p.mainId) p.mainId = key;
      const isScreen = key !== p.mainId && e.track.kind === 'video';
      const tid = (isScreen ? 'scr:' : 'cam:') + user.id;
      addTile(tid, isScreen ? `Tela de ${user.username}` : user.username, st, false, isScreen, user);
      if (isScreen) { e.track.onmute = e.track.onended = () => removeTile(tid); st.onremovetrack = () => removeTile(tid); }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected' && !call.startedAt) { call.startedAt = Date.now(); } if (pc.connectionState === 'failed') toast(`Conexão com ${user.username} falhou. Pode ser necessário um servidor TURN.`, 'err'); };
    return p;
  }
  async function onSignal(from, data) {
    const p = call.peers.get(from); if (!p) return; const pc = p.pc;
    try {
      if (data.desc) {
        const collision = data.desc.type === 'offer' && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision; if (p.ignore) return;
        await pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') { await pc.setLocalDescription(); send({ t: 'call.signal', callId: call.id, to: from, data: { desc: pc.localDescription } }); }
      } else if (data.candidate) { try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!p.ignore) throw e; } }
    } catch (e) { console.warn('signal', e); }
  }

  // ---------- UI ----------
  function buildUI() {
    const el = h('div', { class: 'call', id: 'callui' }, [
      h('div', { class: 'top' }, [h('b', { id: 'call-title' }, 'Chamada'), h('span', { class: 'small', id: 'call-time', style: 'opacity:.8' }, 'Conectando…')]),
      h('div', { class: 'grid', id: 'call-grid' }),
      h('div', { class: 'bar' }, [
        h('button', { class: 'cb', id: 'cb-mic', 'aria-label': 'Silenciar microfone', html: ic('mic'), onclick: toggleMic }),
        h('button', { class: 'cb', id: 'cb-cam', 'aria-label': 'Ligar/desligar câmera', html: ic(call.videoOn ? 'video' : 'videooff'), onclick: toggleCam }),
        navigator.mediaDevices?.getDisplayMedia ? h('button', { class: 'cb', id: 'cb-scr', 'aria-label': 'Compartilhar tela', html: ic('screen'), onclick: toggleScreen }) : null,
        h('button', { class: 'cb end', 'aria-label': 'Encerrar chamada', html: ic('phone', 'hang'), onclick: () => hangup(true) })])]);
    el.querySelector('.hang').style.transform = 'rotate(135deg)';
    document.body.append(el);
    const chat = AIS.state.chats.get(call.chatId); $('#call-title').textContent = chat ? AIS.chatTitle(chat) : 'Chamada';
    timer = setInterval(() => { const t = $('#call-time'); if (t) t.textContent = call.startedAt ? fmtCount(Date.now() - call.startedAt) : 'Chamando…'; }, 500);
  }
  function addTile(id, label, stream, local, screen, user) {
    if (!call || !$('#call-grid')) return; let t = call.tiles.get(id);
    if (!t) {
      const v = h('video', { autoplay: true, playsinline: true }); v.muted = !!local;
      const noav = h('div', { class: 'noav', html: user || local ? av(local ? AIS.state.me : user, { cls: 'lg' }) : '' });
      t = h('div', { class: 'tile' + (screen ? ' screen' : '') }, [noav, v, h('span', { class: 'lbl' }, label)]); t.v = v; t.noav = noav; t.lbl = t.lastChild; call.tiles.set(id, t); $('#call-grid').append(t);
    }
    t.v.srcObject = stream; const upd = () => { const live = stream.getVideoTracks().some(x => x.enabled && x.readyState === 'live' && !x.muted); t.noav.style.display = live ? 'none' : 'grid'; };
    upd(); stream.getVideoTracks().forEach(x => { x.onmute = x.onunmute = upd; }); stream.onaddtrack = upd; t.upd = upd; t.v.play?.().catch(() => {});
  }
  function removeTile(id) { const t = call?.tiles.get(id); if (t) { t.remove(); call.tiles.delete(id); } }
  const mediaState = () => send({ t: 'call.media', callId: call.id, state: { audio: call.audioOn, video: call.videoOn } });
  function toggleMic() { call.audioOn = !call.audioOn; call.local.getAudioTracks().forEach(t => t.enabled = call.audioOn); $('#cb-mic').innerHTML = ic(call.audioOn ? 'mic' : 'micoff'); $('#cb-mic').classList.toggle('off', !call.audioOn); mediaState(); }
  async function toggleCam() {
    try {
      if (!call.local.getVideoTracks().length) { // chamada de voz virando vídeo
        const s = await navigator.mediaDevices.getUserMedia({ video: true }); const tr = s.getVideoTracks()[0]; call.local.addTrack(tr);
        for (const p of call.peers.values()) p.senders.push(p.pc.addTrack(tr, call.local)); call.videoOn = true;
      } else { call.videoOn = !call.videoOn; call.local.getVideoTracks().forEach(t => t.enabled = call.videoOn); }
      $('#cb-cam').innerHTML = ic(call.videoOn ? 'video' : 'videooff'); $('#cb-cam').classList.toggle('off', !call.videoOn); call.tiles.get('me')?.upd?.(); mediaState();
    } catch { toast('Não foi possível usar a câmera.', 'err'); }
  }
  async function toggleScreen() {
    if (call.screen) return stopScreen();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); call.screen = s;
      for (const p of call.peers.values()) for (const t of s.getTracks()) p.senders.push(p.pc.addTrack(t, s));
      s.getVideoTracks()[0].onended = stopScreen; addTile('scr:me', 'Sua tela', s, true, true); $('#cb-scr').classList.add('off');
    } catch (e) { if (e.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela.', 'err'); }
  }
  function stopScreen() {
    if (!call?.screen) return; const tracks = call.screen.getTracks(); tracks.forEach(t => t.stop());
    for (const p of call.peers.values()) { for (const s of p.senders.filter(s => s.track && tracks.includes(s.track))) try { p.pc.removeTrack(s); } catch {} }
    call.screen = null; removeTile('scr:me'); $('#cb-scr')?.classList.remove('off');
  }
  function cleanup() {
    clearInterval(timer); ringtone(false); if (!call) return;
    call.local.getTracks().forEach(t => t.stop()); call.screen?.getTracks().forEach(t => t.stop()); for (const p of call.peers.values()) p.pc.close();
    $('#callui')?.remove(); call = null;
  }
  function hangup(notify) { if (call && notify) send({ t: 'call.leave', callId: call.id }); cleanup(); }
  function dismissIncoming(id) { incomingBanners.get(id)?.remove(); incomingBanners.delete(id); if (!incomingBanners.size) ringtone(false); }

  async function accept(callId, chatId, video) {
    dismissIncoming(callId); if (call) return toast('Você já está em uma chamada.', 'err');
    try { const s = await media(video); newCall(callId, chatId, video, s); send({ t: 'call.accept', callId }); } catch (e) { fail(e); send({ t: 'call.decline', callId }); }
  }
  function incoming(ev) {
    if (incomingBanners.has(ev.callId)) return; const chat = AIS.state.chats.get(ev.chatId);
    const b = h('div', { class: 'incoming', role: 'alertdialog' }, [
      h('div', { html: av(ev.from) }), h('div', { class: 'grow' }, [h('b', {}, ev.from.username), h('div', { class: 'small muted' }, `${ev.video ? 'Chamada de vídeo' : 'Chamada de voz'}${chat?.type === 'group' ? ' em ' + AIS.chatTitle(chat) : ''}`)]),
      h('button', { class: 'cb end', style: 'width:46px;height:46px', 'aria-label': 'Recusar', html: ic('phone'), onclick: () => { send({ t: 'call.decline', callId: ev.callId }); dismissIncoming(ev.callId); } }),
      h('button', { class: 'cb', style: 'width:46px;height:46px;background:#1f9d63', 'aria-label': 'Atender', html: ic(ev.video ? 'video' : 'phone'), onclick: () => accept(ev.callId, ev.chatId, ev.video) })]);
    b.querySelector('.end svg').style.transform = 'rotate(135deg)'; document.body.append(b); incomingBanners.set(ev.callId, b); ringtone(true);
    if (document.hidden && Notification?.permission === 'granted') new Notification(`${ev.from.username} está ligando`, { body: ev.video ? 'Chamada de vídeo' : 'Chamada de voz', tag: 'call' });
  }

  return {
    async start(chatId, video) {
      if (call) return toast('Você já está em uma chamada.', 'err');
      try { const cfg = await api('GET', '/api/config'); iceServers = cfg.iceServers; } catch {}
      let s; try { s = await media(video); } catch (e) { return fail(e); }
      AIS.pendingCall = { chatId, video, stream: s }; send({ t: 'call.invite', chatId, video });
    },
    async handle(ev) {
      switch (ev.t) {
        case 'hello': for (const c of ev.calls) { AIS.state.ongoing.set(c.chatId, c); } AIS.renderList?.(); break;
        case 'call.created': { const p = AIS.pendingCall; AIS.pendingCall = null; if (p) newCall(ev.callId, ev.chatId, ev.video, p.stream); break; }
        case 'call.exists': { const p = AIS.pendingCall; AIS.pendingCall = null; p?.stream.getTracks().forEach(t => t.stop()); if (await confirmBox('Chamada em andamento', 'Já existe uma chamada nesta conversa. Deseja entrar?', 'Entrar')) accept(ev.callId, ev.chatId, ev.video); break; }
        case 'call.error': AIS.pendingCall?.stream.getTracks().forEach(t => t.stop()); AIS.pendingCall = null; toast(ev.text, 'err'); break;
        case 'call.incoming': incoming(ev); break;
        case 'call.dismiss': dismissIncoming(ev.callId); break;
        case 'call.ongoing': AIS.state.ongoing.set(ev.chatId, ev); AIS.renderHeader?.(); break;
        case 'call.peers': { try { const cfg = await api('GET', '/api/config'); iceServers = cfg.iceServers; } catch {} if (call?.id === ev.callId) for (const u of ev.peers) makePeer(u, false); break; }
        case 'call.joined': if (call?.id === ev.callId) { makePeer(ev.user, true); call.startedAt ||= Date.now(); toast(`${ev.user.username} entrou na chamada`); } break;
        case 'call.signal': if (call?.id === ev.callId) onSignal(ev.from, ev.data); break;
        case 'call.left': if (call?.id === ev.callId) { const p = call.peers.get(ev.userId); if (p) { p.pc.close(); call.peers.delete(ev.userId); removeTile('cam:' + ev.userId); removeTile('scr:' + ev.userId); } } break;
        case 'call.media': { const t = call?.tiles.get('cam:' + ev.userId); if (t) t.lbl.textContent = peerName(ev.userId) + (ev.state.audio ? '' : ' 🔇'); break; }
        case 'call.ended': dismissIncoming(ev.callId); AIS.state.ongoing.delete(ev.chatId); AIS.renderHeader?.(); if (call?.id === ev.callId) { cleanup(); toast('Chamada encerrada'); } break;
      }
    },
    hangup, get active() { return !!call; },
    join(chatId) { const o = AIS.state.ongoing.get(chatId); if (o) accept(o.callId, chatId, o.video); },
  };
})();
