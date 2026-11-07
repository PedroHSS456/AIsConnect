/* Bot Gartic Phone: roda dentro da pagina do jogo (via favorito/bookmarklet).
   Desenhar: le o tema, busca uma imagem na internet, converte em tracos e desenha no canvas.
   Palpitar: descreve o desenho na tela com IA e preenche o campo de texto. */
(() => {
  "use strict";
  if (window.__garticBot) { window.__garticBot.mostrar(); return; }

  const BASE = new URL(document.currentScript.src).origin;
  const MAX_TRACOS = 900;
  const PRONTO = /^(pronto|enviar|ok|done|ready|send|continuar)\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let auto = false;
  let ocupado = false;
  let ultima = "";

  // ---------------------------------------------------------------- painel
  const el = (tag, props, ...filhos) => {
    const n = Object.assign(document.createElement(tag), props || {});
    for (const f of filhos) n.append(f);
    return n;
  };
  const estiloBotao =
    "flex:1;padding:8px 4px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font:600 13px sans-serif";

  const titulo = el("b", { textContent: "Bot Gartic" });
  const fechar = el("button", { textContent: "-" });
  fechar.style.cssText = "border:0;background:none;color:#fff;font:700 16px sans-serif;padding:0 6px";
  const tema = el("input", { type: "text", placeholder: "Tema (se nao achar sozinho)" });
  tema.style.cssText = "width:100%;box-sizing:border-box;margin:6px 0;padding:6px;border-radius:6px;border:0;font:13px sans-serif";
  const btDesenhar = el("button", { textContent: "Desenhar" });
  const btPalpitar = el("button", { textContent: "Palpitar" });
  btDesenhar.style.cssText = estiloBotao;
  btPalpitar.style.cssText = estiloBotao;
  const linhaBotoes = el("div", {}, btDesenhar, btPalpitar);
  linhaBotoes.style.cssText = "display:flex;gap:6px";
  const chkAuto = el("input", { type: "checkbox" });
  const rotuloAuto = el("label", {}, chkAuto, " Auto (desenha e palpita sozinho)");
  rotuloAuto.style.cssText = "display:block;margin-top:6px;font-size:12px";
  const msg = el("div", { textContent: "Pronto." });
  msg.style.cssText = "margin-top:6px;font-size:12px;opacity:.9;word-break:break-word";
  const topo = el("div", {}, titulo, fechar);
  topo.style.cssText = "display:flex;justify-content:space-between;align-items:center";
  const corpo = el("div", {}, tema, linhaBotoes, rotuloAuto, msg);

  const painel = el("div", { id: "gbot-painel" }, topo, corpo);
  painel.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:2147483647;width:220px;background:rgba(17,24,39,.92);" +
    "color:#fff;font:13px/1.3 sans-serif;padding:8px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.4)";
  document.body.append(painel);

  const status = (t) => { msg.textContent = t; };
  fechar.onclick = () => {
    const aberto = corpo.style.display !== "none";
    corpo.style.display = aberto ? "none" : "block";
    fechar.textContent = aberto ? "+" : "-";
  };
  chkAuto.onchange = () => {
    auto = chkAuto.checked;
    ultima = "";
    status(auto ? "Auto ligado." : "Auto desligado.");
  };

  // ---------------------------------------------------------------- achar coisas na pagina
  const dentro = (n) => painel.contains(n);
  function visivel(n) {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  }
  function maior(seletor, minW, minH) {
    let melhor = null, area = 0;
    for (const n of document.querySelectorAll(seletor)) {
      if (dentro(n) || !visivel(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width < minW || r.height < minH) continue;
      if (r.width * r.height > area) { area = r.width * r.height; melhor = n; }
    }
    return melhor;
  }
  function campo() {
    for (const n of document.querySelectorAll("textarea, input[type=text], input:not([type])")) {
      if (!dentro(n) && visivel(n) && !n.disabled && !n.readOnly) return n;
    }
    return null;
  }
  function botao(rx) {
    for (const b of document.querySelectorAll("button, [role=button]")) {
      if (dentro(b) || !visivel(b)) continue;
      if (rx.test((b.innerText || "").trim())) { b.click(); return true; }
    }
    return false;
  }
  function preencher(c, texto) {
    const proto = c.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(c, texto);
    c.dispatchEvent(new Event("input", { bubbles: true }));
    c.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function lerFrase() {
    const manual = tema.value.trim();
    if (manual) return manual;
    const ruins = /^(pronto|enviar|ok|done|ready|send|desenhe|draw|limpar|desfazer|tempo|time)\W*$/i;
    let melhor = null, tam = 0;
    for (const n of document.querySelectorAll("body *")) {
      if (n.children.length || dentro(n) || n.closest("button,script,style,a,canvas,textarea,input")) continue;
      if (!visivel(n)) continue;
      const t = (n.textContent || "").trim();
      if (t.length < 3 || t.length > 100 || ruins.test(t) || /^\d+(:\d+)?$/.test(t)) continue;
      const fs = parseFloat(getComputedStyle(n).fontSize) || 0;
      if (fs >= tam) { tam = fs; melhor = t; }
    }
    return melhor ? melhor.replace(/^(desenhe|draw)\s*[:\-]?\s*/i, "").trim() : null;
  }

  // ---------------------------------------------------------------- desenhar
  async function buscarImagem(frase) {
    const r = await fetch(`${BASE}/api/img?q=${encodeURIComponent(frase)}`);
    const d = await r.json();
    if (!d.url) throw new Error(d.erro || "nenhuma imagem achada");
    return new Promise((ok, erro) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => ok(im);
      im.onerror = () => erro(new Error("falha ao carregar a imagem"));
      im.src = `${BASE}/api/pic?u=${encodeURIComponent(d.url)}`;
    });
  }

  // imagem -> lista de tracos [x0, y0, x1, y1] em coordenadas da tela (bordas por Sobel)
  function tracos(im, box) {
    const W = Math.max(50, Math.min(110, Math.round(box.width / 5)));
    const H = Math.max(8, Math.round((W * im.naturalHeight) / im.naturalWidth));
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, W, H);
    cx.drawImage(im, 0, 0, W, H);
    const px = cx.getImageData(0, 0, W, H).data;

    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    const mag = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
        const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
        mag[i] = Math.hypot(gx, gy);
      }
    }
    const ordenado = Array.from(mag).sort((a, b) => a - b);

    const area = 0.92;
    const cel = Math.min((box.width * area) / W, (box.height * area) / H);
    const ox = box.left + (box.width - W * cel) / 2;
    const oy = box.top + (box.height - H * cel) / 2;
    const X = (x) => ox + (x + 0.5) * cel;
    const Y = (y) => oy + (y + 0.5) * cel;

    let pct = 0.9;
    for (;;) {
      const lim = Math.max(60, ordenado[Math.floor(ordenado.length * pct)]);
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = mag[i] >= lim ? 1 : 0;
      const segs = [];
      const emRun = new Uint8Array(W * H);

      for (let y = 0; y < H; y++) {            // corridas horizontais
        let ini = -1;
        for (let x = 0; x <= W; x++) {
          const on = x < W && m[y * W + x];
          if (on && ini < 0) ini = x;
          if (!on && ini >= 0) {
            if (x - ini >= 2) {
              segs.push([X(ini), Y(y), X(x - 1), Y(y)]);
              for (let k = ini; k < x; k++) emRun[y * W + k] = 1;
            }
            ini = -1;
          }
        }
      }
      for (let x = 0; x < W; x++) {            // corridas verticais
        let ini = -1;
        for (let y = 0; y <= H; y++) {
          const on = y < H && m[y * W + x];
          if (on && ini < 0) ini = y;
          if (!on && ini >= 0) {
            if (y - ini >= 2) {
              segs.push([X(x), Y(ini), X(x), Y(y - 1)]);
              for (let k = ini; k < y; k++) emRun[k * W + x] = 1;
            }
            ini = -1;
          }
        }
      }
      for (let i = 0; i < W * H; i++) {        // pontos soltos
        if (m[i] && !emRun[i]) { const x = i % W, y = (i / W) | 0; segs.push([X(x), Y(y), X(x), Y(y)]); }
      }
      if (segs.length <= MAX_TRACOS || pct >= 0.985) return segs;
      pct += 0.02; // muitos tracos: aumenta o rigor e tenta de novo
    }
  }

  function disparar(cv, fase, x, y) {
    const botoes = fase === "up" ? 0 : 1;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    try {
      cv.dispatchEvent(new PointerEvent("pointer" + fase, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: botoes }));
    } catch (e) { /* sem PointerEvent */ }
    cv.dispatchEvent(new MouseEvent("mouse" + fase, { ...base, button: 0, buttons: botoes }));
    if (typeof Touch === "function" && typeof TouchEvent === "function") {
      try {
        const t = new Touch({ identifier: 1, target: cv, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x + scrollX, pageY: y + scrollY });
        const tipo = fase === "down" ? "touchstart" : fase === "move" ? "touchmove" : "touchend";
        cv.dispatchEvent(new TouchEvent(tipo, {
          bubbles: true, cancelable: true, composed: true,
          touches: fase === "up" ? [] : [t], targetTouches: fase === "up" ? [] : [t], changedTouches: [t],
        }));
      } catch (e) { /* sem Touch */ }
    }
  }

  async function tracar(cv, segs) {
    let n = 0;
    for (const [x0, y0, x1, y1] of segs) {
      disparar(cv, "down", x0, y0);
      const passos = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
      for (let s = 1; s <= passos; s++) disparar(cv, "move", x0 + ((x1 - x0) * s) / passos, y0 + ((y1 - y0) * s) / passos);
      disparar(cv, "up", x1, y1);
      if (++n % 6 === 0) await sleep(0);
    }
  }

  async function desenhar(enviar) {
    const cv = maior("canvas", 200, 120);
    if (!cv) throw new Error("nao achei o canvas de desenho");
    const frase = lerFrase();
    if (!frase) throw new Error("nao achei o tema: digite no campo Tema");
    status(`Buscando imagem: ${frase}`);
    const im = await buscarImagem(frase);
    status("Desenhando...");
    const segs = tracos(im, cv.getBoundingClientRect());
    await tracar(cv, segs);
    status(`Desenhou (${segs.length} tracos): ${frase}`);
    if (enviar) { await sleep(400); botao(PRONTO); }
  }

  // ---------------------------------------------------------------- palpitar
  function fotoDesenho() {
    const alvo = maior("canvas", 200, 120) || maior("img", 200, 120);
    if (!alvo) return null;
    const r = alvo.getBoundingClientRect();
    const w = 480, h = Math.max(1, Math.round((w * r.height) / r.width));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#fff";
    cx.fillRect(0, 0, w, h);
    cx.drawImage(alvo, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.7);
  }

  async function palpitar(enviar) {
    const foto = fotoDesenho();
    if (!foto) throw new Error("nao achei o desenho na tela");
    status("Descrevendo o desenho...");
    const r = await fetch(`${BASE}/api/desc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: foto }),
    });
    const d = await r.json();
    if (!d.texto) throw new Error(d.erro || "sem descricao");
    const c = campo();
    if (!c) throw new Error("nao achei o campo de texto");
    preencher(c, d.texto);
    status(`Palpite: ${d.texto}`);
    if (enviar) {
      await sleep(300);
      if (!botao(PRONTO)) c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    }
  }

  // ---------------------------------------------------------------- botoes e modo auto
  async function executar(fn) {
    if (ocupado) return;
    ocupado = true;
    try { await fn(); } catch (e) { status("Erro: " + (e && e.message ? e.message : e)); } finally { ocupado = false; }
  }
  btDesenhar.onclick = () => executar(() => desenhar(false));
  btPalpitar.onclick = () => executar(() => palpitar(false));

  const hash = (s) => { let h = s.length; for (let i = 0; i < s.length; i += 97) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

  async function ciclo() {
    if (!auto || ocupado) return;
    const c = campo();
    if (!c && maior("canvas", 200, 120)) {
      const frase = lerFrase();
      const ass = "d|" + frase;
      if (frase && ass !== ultima) { ultima = ass; await executar(() => desenhar(true)); }
    } else if (c && (maior("canvas", 200, 120) || maior("img", 200, 120))) {
      let foto = null;
      try { foto = fotoDesenho(); } catch (e) { /* canvas bloqueado */ }
      const ass = "g|" + (foto ? hash(foto) : "");
      if (foto && ass !== ultima) { ultima = ass; await executar(() => palpitar(true)); }
    }
  }
  setInterval(() => { ciclo().catch(() => {}); }, 1500);

  window.__garticBot = { mostrar: () => { painel.style.display = "block"; corpo.style.display = "block"; fechar.textContent = "-"; } };
})();
