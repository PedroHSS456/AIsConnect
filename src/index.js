import puppeteer from "@cloudflare/puppeteer";

const MODELO_IMAGEM = "@cf/black-forest-labs/flux-1-schnell";
const MODELO_VISAO = "@cf/llava-hf/llava-1.5-7b-hf";
const MAX_TRACOS = 450; // limite de traços para caber no tempo da rodada

const FRASES = [
  "um gato astronauta comendo pizza",
  "um dinossauro dirigindo um carro",
  "uma batata fazendo yoga",
  "um robo tocando violao na praia",
  "um pato com oculos escuros",
  "uma girafa tomando banho",
  "um tubarao jogando futebol",
];
const PALPITES = [
  "um bicho estranho",
  "alguem fazendo algo engracado",
  "um monstro feliz",
  "uma coisa muito louca",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function clicarBotao(page, src) {
  return page.evaluate((src) => {
    const rx = new RegExp(src, "i");
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent && rx.test(b.innerText.trim())) { b.click(); return true; }
    }
    return false;
  }, src);
}

async function campoTexto(page) {
  for (const h of await page.$$("textarea, input[type=text], input:not([type])")) {
    if (await h.isIntersectingViewport()) return h;
  }
  return null;
}

async function boxCanvas(page) {
  return page.evaluate(() => {
    let best = null, area = 0;
    for (const c of document.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      if (r.width < 300 || r.height < 200) continue;
      if (r.width * r.height > area) {
        area = r.width * r.height;
        best = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    return best;
  });
}

// Lê na tela a frase que o bot precisa desenhar (maior texto visível fora de botões)
async function lerFrase(page) {
  const texto = await page.evaluate(() => {
    const ruins = /^(pronto|enviar|ok|done|ready|send|desenhe|draw|limpar|desfazer)\W*$/i;
    let melhor = null, tamanho = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length > 0) continue;
      if (el.closest("button, script, style, a, canvas")) continue;
      if (!el.offsetParent) continue;
      const t = (el.innerText || "").trim();
      if (t.length < 3 || t.length > 100 || ruins.test(t)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (fs >= tamanho) { tamanho = fs; melhor = t; }
    }
    return melhor;
  });
  if (!texto) return null;
  return texto.replace(/^(desenhe|draw)\s*[:\-]?\s*/i, "").trim() || null;
}

// Gera a imagem com IA a partir da frase (retorna data URL)
async function gerarImagem(env, frase) {
  const prompt =
    `simple black and white line drawing of ${frase}, thick clean outlines, ` +
    `minimal sketch, cartoon, no shading, no text, plain white background`;
  const r = await env.AI.run(MODELO_IMAGEM, { prompt, steps: 4 });
  return `data:image/jpeg;base64,${r.image}`;
}

// Converte a imagem em segmentos horizontais escuros, dentro do navegador
async function calcularTracos(page, dataUrl, box) {
  return page.evaluate(async (url, box, MAX) => {
    const COLS = 70, LIM = 140, M = 0.04;
    const img = new Image();
    img.src = url;
    await img.decode();
    const aw = box.width * (1 - 2 * M), ah = box.height * (1 - 2 * M);
    const rows = Math.max(1, Math.round(COLS * img.height / img.width));
    let cel = aw / COLS;
    if (rows * cel > ah) cel = ah / rows;
    const cv = document.createElement("canvas");
    cv.width = COLS; cv.height = rows;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, COLS, rows);
    ctx.drawImage(img, 0, 0, COLS, rows);
    const d = ctx.getImageData(0, 0, COLS, rows).data;
    const ox = box.x + (box.width - COLS * cel) / 2;
    const oy = box.y + (box.height - rows * cel) / 2;

    for (let passo = 1; passo <= 4; passo++) {
      const segs = [];
      for (let y = 0; y < rows; y += passo) {
        let ini = -1;
        for (let x = 0; x <= COLS; x++) {
          const i = (y * COLS + x) * 4;
          const escuro = x < COLS && (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) < LIM;
          if (escuro && ini < 0) ini = x;
          if (!escuro && ini >= 0) {
            segs.push([ox + (ini + 0.5) * cel, oy + (y + 0.5) * cel, ox + (x - 0.5) * cel]);
            ini = -1;
          }
        }
      }
      if (segs.length <= MAX || passo === 4) return segs;
    }
    return [];
  }, dataUrl, box, MAX_TRACOS);
}

async function desenhar(page, dataUrl, box, log) {
  const segs = await calcularTracos(page, dataUrl, box);
  log(`Desenhando ${segs.length} tracos...`);
  for (const [xa, y, xb] of segs) {
    await page.mouse.move(xa, y);
    await page.mouse.down();
    await page.mouse.move(Math.max(xb, xa + 1), y, { steps: 2 });
    await page.mouse.up();
  }
}

// Olha a tela, descreve o desenho com IA e usa como palpite
async function palpiteDoDesenho(env, page) {
  const png = await page.screenshot({ type: "jpeg", quality: 60 });
  const r = await env.AI.run(MODELO_VISAO, {
    image: Array.from(new Uint8Array(png)),
    prompt: "Em portugues, em no maximo 5 palavras, o que esta desenhado? Responda so com a resposta.",
    max_tokens: 24,
  });
  const t = (r.description || r.response || "").replace(/["\n]/g, " ").trim();
  return t.length >= 3 ? t.slice(0, 60) : null;
}

export default {
  async fetch(request, env) {
    try {
      return await rodar(request, env);
    } catch (e) {
      const msg = "ERRO: " + ((e && (e.stack || e.message)) || String(e));
      return new Response(msg, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  },
};

async function rodar(request, env) {
    if (!env.BROWSER) throw new Error("Binding BROWSER nao encontrado (Browser Rendering nao ativo no worker).");
    if (!env.AI) throw new Error("Binding AI nao encontrado (Workers AI nao ativo no worker).");
    const u = new URL(request.url);
    const link = u.searchParams.get("link");
    const nick = u.searchParams.get("nick") || "Bot";
    const minutos = Math.min(Number(u.searchParams.get("min") || 5), 9);
    if (!link) {
      return new Response("Use: /?link=LINK_DA_SALA&nick=Bot&min=5");
    }

    const logs = [];
    const log = (m) => logs.push(m);

    const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 600000 });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await sleep(2000);

      const nome = await campoTexto(page);
      if (nome) { await nome.click({ clickCount: 3 }); await nome.type(nick); }
      await clicarBotao(page, "^(jogar|entrar|play|join|ok|continuar)");
      log("Entrou na sala.");

      let escreveu = false, desenhou = false, primeira = true;
      const fim = Date.now() + minutos * 60000;

      while (Date.now() < fim) {
        await sleep(800);
        try {
          const campo = await campoTexto(page);
          if (campo) {
            desenhou = false;
            if (!escreveu) {
              let texto;
              if (primeira) {
                texto = pick(FRASES);
              } else {
                await sleep(1500); // deixa o desenho aparecer
                texto = (await palpiteDoDesenho(env, page).catch((e) => {
                  log("Visao falhou: " + e.message);
                  return null;
                })) || pick(PALPITES);
              }
              await campo.click();
              await campo.type(texto);
              if (!(await clicarBotao(page, "^(pronto|enviar|ok|done|ready|send)"))) {
                await page.keyboard.press("Enter");
              }
              log(`Escreveu: ${texto}`);
              primeira = false;
              escreveu = true;
            }
            continue;
          }
          escreveu = false;
          const box = await boxCanvas(page);
          if (box && !desenhou) {
            desenhou = true; // marca antes para nao repetir se algo falhar
            const frase = (await lerFrase(page)) || pick(FRASES);
            log(`Frase para desenhar: ${frase}`);
            const dataUrl = await gerarImagem(env, frase);
            await desenhar(page, dataUrl, box, log);
            await clicarBotao(page, "^(pronto|enviar|ok|done|ready|send)");
          } else if (!box) {
            desenhou = false;
          }
        } catch (e) {
          log("Aviso: " + e.message);
        }
      }
      log("Tempo acabou, encerrando.");
    } finally {
      await browser.close();
    }
    return new Response(logs.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
