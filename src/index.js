import puppeteer from "@cloudflare/puppeteer";

const FRASES = [
  "um gato astronauta comendo pizza",
  "um dinossauro dirigindo um carro",
  "uma batata fazendo yoga",
  "um robo tocando violao na praia",
  "um pato com oculos escuros",
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

// Converte a imagem em segmentos horizontais escuros, dentro do navegador
async function calcularTracos(page, dataUrl, box) {
  return page.evaluate(async (url, box) => {
    const COLS = 90, LIM = 120, M = 0.04;
    const img = new Image();
    img.src = url;
    await img.decode();
    const aw = box.width * (1 - 2 * M), ah = box.height * (1 - 2 * M);
    let rows = Math.max(1, Math.round(COLS * img.height / img.width));
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
    const segs = [];
    for (let y = 0; y < rows; y++) {
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
    return segs;
  }, dataUrl, box);
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

async function imagemParaDataUrl(url) {
  const r = await fetch(url);
  const tipo = r.headers.get("content-type") || "image/png";
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${tipo};base64,${btoa(bin)}`;
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const link = u.searchParams.get("link");
    const img = u.searchParams.get("img");
    const nick = u.searchParams.get("nick") || "Bot";
    const minutos = Math.min(Number(u.searchParams.get("min") || 5), 9);
    if (!link || !img) {
      return new Response("Use: /?link=LINK_DA_SALA&img=URL_DA_IMAGEM&nick=Bot&min=5");
    }

    const logs = [];
    const log = (m) => logs.push(m);
    const dataUrl = await imagemParaDataUrl(img);

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
              const texto = pick(primeira ? FRASES : PALPITES);
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
            await desenhar(page, dataUrl, box, log);
            await clicarBotao(page, "^(pronto|enviar|ok|done|ready|send)");
            desenhou = true;
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
  },
};
