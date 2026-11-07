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
    const r = await buscar(`${BASE}/api/img?q=${encodeURIComponent(frase)}`, 15000);
    const d = await r.json();
    if (!d.url) throw new Error(d.erro || "nenhuma imagem achada");
    // baixa como bytes (fetch) em vez de <img>: evita o bloqueio de imagens de outros sites (CSP img-src)
    const resp = await buscar(`${BASE}/api/pic?u=${encodeURIComponent(d.url)}`, 15000);
    if (!resp.ok) throw new Error("download da imagem falhou (HTTP " + resp.status + ")");
    const blob = await resp.blob();
    try {
      return await createImageBitmap(blob);
    } catch (e) {
      throw new Error("imagem invalida (" + (blob.type || "?") + ", " + blob.size + " bytes)");
    }
  }

  // imagem -> lista de tracos [x0, y0, x1, y1] em coordenadas da tela (bordas por Sobel)
  function tracos(im, box) {
    const W = Math.max(50, Math.min(110, Math.round(box.width / 5)));
    const H = Math.max(8, Math.round((W * (im.naturalHeight || im.height)) / (im.naturalWidth || im.width)));
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

  // quantos eventos de cada tipo foram "tratados" pela pagina (ela chamou preventDefault)
  let tratados = { pointer: 0, mouse: 0, touch: 0 };

  function disparar(cv, fase, x, y) {
    const botoes = fase === "up" ? 0 : 1;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    try {
      if (!cv.dispatchEvent(new PointerEvent("pointer" + fase, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: botoes }))) tratados.pointer++;
    } catch (e) { /* sem PointerEvent */ }
    if (!cv.dispatchEvent(new MouseEvent("mouse" + fase, { ...base, button: 0, buttons: botoes }))) tratados.mouse++;
    if (typeof Touch === "function" && typeof TouchEvent === "function") {
      try {
        const t = new Touch({ identifier: 1, target: cv, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x + scrollX, pageY: y + scrollY });
        const tipo = fase === "down" ? "touchstart" : fase === "move" ? "touchmove" : "touchend";
        if (!cv.dispatchEvent(new TouchEvent(tipo, {
          bubbles: true, cancelable: true, composed: true,
          touches: fase === "up" ? [] : [t], targetTouches: fase === "up" ? [] : [t], changedTouches: [t],
        }))) tratados.touch++;
      } catch (e) { /* sem Touch */ }
    }
  }

  // o mouse "entra" no canvas antes de apertar (alguns sites so desenham depois de mouseenter/pointerenter)
  function entrar(alvo, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    try { alvo.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch (e) { /* ok */ }
    try { alvo.dispatchEvent(new PointerEvent("pointerenter", { ...base, bubbles: false, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch (e) { /* ok */ }
    alvo.dispatchEvent(new MouseEvent("mouseover", base));
    alvo.dispatchEvent(new MouseEvent("mouseenter", { ...base, bubbles: false }));
    alvo.dispatchEvent(new MouseEvent("mousemove", base));
  }

  // setPointerCapture com ponteiro simulado lanca erro e derruba o tratador do site: vira no-op enquanto desenha
  function liberarCaptura() {
    const nomes = ["setPointerCapture", "releasePointerCapture"];
    const orig = {};
    for (const nome of nomes) {
      orig[nome] = Element.prototype[nome];
      Element.prototype[nome] = function (...a) { try { return orig[nome].apply(this, a); } catch (e) { return undefined; } };
    }
    return () => { for (const nome of nomes) Element.prototype[nome] = orig[nome]; };
  }

  // alvo real do clique: o elemento no topo naquele ponto (como um toque de verdade)
  const topoEm = (x, y, padrao) => {
    const n = document.elementFromPoint(x, y);
    return n && !dentro(n) ? n : padrao;
  };

  // linhas: lista de polilinhas [[x,y], [x,y], ...] em coordenadas da tela
  // retorna { alvo, erros } para o painel mostrar o que aconteceu
  async function tracar(cv, linhas) {
    painel.style.pointerEvents = "none"; // o painel nao pode tampar o canvas
    tratados = { pointer: 0, mouse: 0, touch: 0 };
    const erros = [];
    const noErro = (e) => erros.push(String((e && e.message) || (e && e.error) || "erro"));
    window.addEventListener("error", noErro);
    const restaurar = liberarCaptura();
    let alvoUsado = null, n = 0;
    try {
      for (const pts of linhas) {
        if (!pts.length) continue;
        let [px, py] = pts[0];
        const alvo = topoEm(px, py, cv);
        if (!alvoUsado) { alvoUsado = alvo; entrar(alvo, px, py); await sleep(30); }
        disparar(alvo, "down", px, py);
        let m = 0;
        for (let i = 1; i < pts.length; i++) {
          const [qx, qy] = pts[i];
          const passos = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / 6));
          for (let s = 1; s <= passos; s++) {
            disparar(alvo, "move", px + ((qx - px) * s) / passos, py + ((qy - py) * s) / passos);
            if (++m % 2 === 0) await sleep(0); // da tempo do site processar
          }
          px = qx; py = qy;
        }
        if (pts.length === 1) disparar(alvo, "move", px, py);
        disparar(alvo, "up", px, py);
        if (++n % 3 === 0) await sleep(4);
      }
    } finally {
      restaurar();
      window.removeEventListener("error", noErro);
      painel.style.pointerEvents = "";
    }
    const nome = alvoUsado ? alvoUsado.tagName + (alvoUsado.id ? "#" + alvoUsado.id : "") + (typeof alvoUsado.className === "string" && alvoUsado.className ? "." + alvoUsado.className.split(" ")[0] : "") : "?";
    return { alvo: nome, erros };
  }

  const paraLinhas = (segs) => segs.map(([a, b, c, d]) => [[a, b], [c, d]]);

  // assinatura dos canvases da pagina: serve para saber se o desenho realmente apareceu
  function assinatura() {
    let h = 0;
    for (const n of document.querySelectorAll("canvas")) {
      if (dentro(n) || !visivel(n)) continue;
      try {
        const t = document.createElement("canvas");
        t.width = 48; t.height = 32;
        const x = t.getContext("2d");
        x.drawImage(n, 0, 0, 48, 32);
        const d = x.getImageData(0, 0, 48, 32).data;
        for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
      } catch (e) { return null; }
    }
    return h;
  }

  // coordenadas 0..100 (quadrado) -> tela, centralizado no canvas
  function noBox(linhas, box) {
    const lado = Math.min(box.width, box.height) * 0.9;
    const ox = box.left + (box.width - lado) / 2;
    const oy = box.top + (box.height - lado) / 2;
    return linhas.map((pts) => pts.map(([x, y]) => [ox + (x / 100) * lado, oy + (y / 100) * lado]));
  }

  async function buscar(url, ms, opcoes) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...(opcoes || {}), signal: ctl.signal }); } finally { clearTimeout(t); }
  }

  // plano B: a IA escreve os tracos do desenho (JSON) a partir da frase
  async function rabiscoIA(frase, box) {
    const r = await buscar(`${BASE}/api/rabisco?q=${encodeURIComponent(frase)}`, 25000);
    const d = await r.json();
    if (!d.strokes || !d.strokes.length) throw new Error(d.erro || "IA sem tracos");
    return noBox(d.strokes, box);
  }

  // plano C: rabiscos prontos no proprio script (nao dependem de rede)
  const circ = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  const ret = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const estrela = (cx, cy, R) => Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const DESENHOS = [
    [/casa|lar\b|predio|house/, () => [ret(25, 50, 50, 40), [[18, 50], [50, 18], [82, 50], [18, 50]], ret(44, 65, 12, 25), ret(30, 58, 10, 10)]],
    [/\bsol\b|sun|dia/, () => [circ(50, 50, 16), ...Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return [[50 + 22 * Math.cos(a), 50 + 22 * Math.sin(a)], [50 + 36 * Math.cos(a), 50 + 36 * Math.sin(a)]]; })]],
    [/arvore|planta|floresta|tree|mato/, () => [ret(44, 55, 12, 38), circ(50, 38, 24, 30)]],
    [/gato|cat|felino|tigre|leao|gatinho/, () => [circ(50, 56, 26, 30), [[28, 42], [30, 18], [44, 32]], [[56, 32], [70, 18], [72, 42]], circ(41, 52, 3, 8), circ(59, 52, 3, 8), [[47, 60], [53, 60], [50, 64], [47, 60]], [[50, 64], [46, 70], [42, 68]], [[50, 64], [54, 70], [58, 68]], [[20, 60], [38, 62]], [[20, 68], [38, 65]], [[80, 60], [62, 62]], [[80, 68], [62, 65]]]],
    [/cachorro|cao\b|dog|lobo|cachorrinho/, () => [circ(50, 56, 24, 30), [[30, 44], [18, 38], [16, 62], [28, 64]], [[70, 44], [82, 38], [84, 62], [72, 64]], circ(42, 52, 3, 8), circ(58, 52, 3, 8), circ(50, 62, 5, 10), [[50, 67], [50, 72], [44, 76]], [[50, 72], [56, 76]]]],
    [/peixe|tubarao|baleia|fish|shark|mar\b|golfinho/, () => [circ(46, 50, 26, 30), [[70, 50], [90, 32], [90, 68], [70, 50]], circ(34, 44, 3, 8), [[24, 56], [30, 60], [38, 58]]]],
    [/carro|car\b|onibus|caminhao|veiculo|moto/, () => [ret(15, 48, 70, 20), [[28, 48], [36, 32], [64, 32], [74, 48]], circ(32, 70, 8, 14), circ(68, 70, 8, 14)]],
    [/flor|flower|rosa|jardim/, () => [circ(50, 36, 7, 12), ...Array.from({ length: 6 }, (_, i) => circ(50 + 16 * Math.cos((i * Math.PI) / 3), 36 + 16 * Math.sin((i * Math.PI) / 3), 9, 12)), [[50, 52], [50, 90]], [[50, 72], [66, 62], [60, 76], [50, 72]]]],
    [/estrela|star|ceu|noite/, () => [estrela(50, 52, 36)]],
    [/coracao|amor|heart|paixao/, () => [[[50, 85], [18, 52], [18, 34], [32, 22], [46, 28], [50, 36], [54, 28], [68, 22], [82, 34], [82, 52], [50, 85]]]],
    [/foguete|astronauta|espaco|rocket|nave|lua\b/, () => [[[50, 8], [64, 34], [64, 72], [36, 72], [36, 34], [50, 8]], circ(50, 44, 7, 14), [[36, 60], [22, 82], [36, 72]], [[64, 60], [78, 82], [64, 72]], [[44, 72], [50, 92], [56, 72]]]],
    [/pizza|comida|lanche|bolo|torta/, () => [circ(50, 50, 36, 36), [[50, 14], [50, 86]], [[14, 50], [86, 50]], [[24, 24], [76, 76]], [[76, 24], [24, 76]], circ(36, 38, 5, 10), circ(64, 38, 5, 10), circ(36, 62, 5, 10), circ(64, 62, 5, 10)]],
    [/bola|futebol|bola/, () => [circ(50, 50, 36, 36), circ(50, 50, 10, 5), [[50, 40], [50, 14]], [[59, 47], [84, 38]], [[56, 59], [72, 80]], [[44, 59], [28, 80]], [[41, 47], [16, 38]]]],
  ];
  function rabiscoLocal(frase, box) {
    const f = frase.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const achados = DESENHOS.filter(([rx]) => rx.test(f)).slice(0, 2).map(([, fn]) => fn());
    let linhas;
    if (achados.length >= 2) {
      linhas = achados.flatMap((ls, i) => ls.map((pts) => pts.map(([x, y]) => [x * 0.5 + i * 50, y * 0.5 + 25])));
    } else if (achados.length === 1) {
      linhas = achados[0];
    } else {
      linhas = [circ(50, 50, 38, 36), circ(38, 40, 4, 8), circ(62, 40, 4, 8), [[30, 60], [40, 72], [60, 72], [70, 60]]]; // carinha
    }
    return noBox(linhas, box);
  }

  async function desenhar(enviar) {
    const cv = maior("canvas", 200, 120);
    if (!cv) throw new Error("nao achei o canvas de desenho");
    const frase = lerFrase();
    if (!frase) throw new Error("nao achei o tema: digite no campo Tema");
    let r0 = cv.getBoundingClientRect();
    if (r0.top < 0 || r0.left < 0 || r0.bottom > innerHeight || r0.right > innerWidth) {
      cv.scrollIntoView({ block: "center" });
      await sleep(300);
    }
    const box = cv.getBoundingClientRect();

    let linhas = null, fonte = "";
    status(`Buscando imagem: ${frase}`);
    try {
      const im = await buscarImagem(frase);
      const segs = tracos(im, box);
      if (segs.length < 25) throw new Error("imagem sem tracos");
      linhas = paraLinhas(segs);
      fonte = "imagem";
    } catch (e1) {
      status(`Sem imagem (${e1.message}). Pedindo o rabisco a IA...`);
      try {
        linhas = await rabiscoIA(frase, box);
        fonte = "IA";
      } catch (e2) {
        linhas = rabiscoLocal(frase, box);
        fonte = "rabisco pronto";
      }
    }

    status(`Desenhando (${fonte})...`);
    const antes = assinatura();
    const info = await tracar(cv, linhas);
    await sleep(500);
    const depois = assinatura();
    const diag =
      ` [alvo ${info.alvo}; tratados p${tratados.pointer}/m${tratados.mouse}/t${tratados.touch}` +
      (info.erros.length ? `; ERRO DA PAGINA: ${info.erros[0].slice(0, 90)}` : "") + "]";
    if (antes !== null && antes === depois) {
      status(`Tracei (${fonte}) mas o canvas NAO mudou.` + diag);
      return;
    }
    if (antes === null) {
      status(`Tracei (${fonte}). Nao consigo verificar se apareceu: confira na tela.` + diag);
    } else {
      status(`Desenhou (${fonte}): ${frase}` + diag);
    }
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
