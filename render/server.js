// Bot Gartic Phone para o Render: um Chromium de verdade entra na sala como jogador e joga sozinho.
// Usa o mesmo public/bot.js do Worker (desenha, palpita, escreve), mas com MOUSE REAL do Playwright.
const http = require("http");
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT) || 10000;
const WORKER = (process.env.WORKER_URL || "").replace(/\/$/, "");

const logs = [];
let sessao = null; // { parar: () => Promise, fim: number, page }

function log(m) {
  const l = new Date().toISOString().slice(11, 19) + " " + m;
  logs.push(l);
  if (logs.length > 300) logs.shift();
  console.log(l);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clicarBotao(page, src) {
  return page.evaluate((src) => {
    const rx = new RegExp(src, "i");
    for (const b of document.querySelectorAll("button, [role=button]")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && rx.test((b.innerText || "").trim())) { b.click(); return true; }
    }
    return false;
  }, src);
}

async function campoVisivel(page) {
  for (const h of await page.$$("input[type=text], input:not([type]), textarea")) {
    if (await h.isVisible().catch(() => false)) return h;
  }
  return null;
}

// desenha com o mouse real: cada polilinha = botao apertado, caminho, botao solto
async function tracoReal(page, linhas) {
  for (const pts of linhas) {
    if (!pts.length) continue;
    const [x0, y0] = pts[0];
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    let [px, py] = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const [qx, qy] = pts[i];
      await page.mouse.move(qx, qy, { steps: Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py) / 6)) });
      px = qx; py = qy;
    }
    if (pts.length === 1) await page.mouse.move(px + 0.5, py);
    await page.mouse.up();
  }
}

async function injetar(page, codigo) {
  const ja = await page.evaluate(() => !!window.__garticBot).catch(() => true);
  if (ja) return;
  await page.evaluate(codigo);
  await page.evaluate(() => window.__garticBot && window.__garticBot.ligarAuto());
  log("Bot injetado na pagina (modo auto ligado).");
}

async function iniciar(link, nick, minutos) {
  if (!WORKER) throw new Error("Falta a variavel WORKER_URL (endereco do Worker da Cloudflare).");
  const codigo = await (await fetch(WORKER + "/bot.js")).text();
  if (!codigo.includes("__garticBot")) throw new Error("Nao consegui baixar o bot.js de " + WORKER);

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, bypassCSP: true, locale: "pt-BR" });
  const page = await ctx.newPage();
  await page.exposeFunction("__tracoReal", (linhas) => tracoReal(page, linhas));
  await page.exposeFunction("__logBot", (t) => log("[bot] " + t));
  await page.addInitScript(`window.__GBOT_BASE=${JSON.stringify(WORKER)};window.__GBOT_ESCREVER=true;`);

  const fim = Date.now() + minutos * 60000;
  let parado = false;
  sessao = {
    page,
    fim,
    parar: async () => { parado = true; await browser.close().catch(() => {}); },
  };

  (async () => {
    try {
      log(`Abrindo ${link}`);
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(2500);
      const nome = await campoVisivel(page);
      if (nome) { await nome.click({ clickCount: 3 }).catch(() => {}); await nome.fill(nick).catch(() => {}); }
      await clicarBotao(page, "^(jogar|entrar|play|join|ok|continuar)");
      log(`Entrou na sala como "${nick}". Esperando o host iniciar...`);

      while (!parado && Date.now() < fim) {
        await sleep(3000);
        await injetar(page, codigo).catch((e) => log("Aviso: " + e.message));
      }
      log("Tempo acabou.");
    } catch (e) {
      log("ERRO: " + (e && e.message ? e.message : e));
    } finally {
      await browser.close().catch(() => {});
      sessao = null;
    }
  })();
}

const html = (corpo, refresh) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  (refresh ? `<meta http-equiv="refresh" content="${refresh}">` : "") +
  `<title>Bot Gartic</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px}pre{background:#8882;padding:10px;border-radius:8px;white-space:pre-wrap;font-size:12px}</style></head><body>${corpo}</body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const enviar = (st, tipo, corpo) => { res.writeHead(st, { "content-type": tipo }); res.end(corpo); };
  try {
    if (u.pathname === "/entrar") {
      const link = u.searchParams.get("link");
      const nick = u.searchParams.get("nick") || "Bot";
      const min = Math.min(Math.max(Number(u.searchParams.get("min") || 30), 1), 120);
      if (!link || !(process.env.ALLOW_ANY_LINK || /^https:\/\/garticphone\.com\//.test(link))) {
        return enviar(400, "text/html; charset=utf-8", html("<p>Use: <code>/entrar?link=LINK_DA_SALA&amp;nick=Bot&amp;min=30</code> (o link precisa ser de garticphone.com)</p>"));
      }
      if (sessao) await sessao.parar();
      logs.length = 0;
      await iniciar(link, nick, min);
      res.writeHead(302, { location: "/log" });
      return res.end();
    }
    if (u.pathname === "/parar") {
      if (sessao) await sessao.parar();
      return enviar(200, "text/html; charset=utf-8", html("<p>Bot parado.</p><p><a href='/log'>Ver log</a></p>"));
    }
    if (u.pathname === "/tela") {
      if (!sessao) return enviar(404, "text/plain", "Nenhuma sessao ativa.");
      const png = await sessao.page.screenshot({ type: "png" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(png);
    }
    if (u.pathname === "/log") {
      const ativo = sessao ? `Ativo ate ${new Date(sessao.fim).toISOString().slice(11, 19)} UTC. <a href="/parar">Parar</a> | <a href="/tela" target="_blank">Ver tela</a>` : "Nenhuma sessao ativa.";
      return enviar(200, "text/html; charset=utf-8", html(`<h3>Bot Gartic</h3><p>${ativo}</p><pre>${logs.join("\n").replace(/</g, "&lt;") || "(sem log ainda)"}</pre>`, sessao ? 4 : 0));
    }
    return enviar(200, "text/html; charset=utf-8", html(
      `<h3>Bot Gartic (servidor)</h3><p>Abra:</p><pre>/entrar?link=LINK_DA_SALA&amp;nick=Bot&amp;min=30</pre><p><a href="/log">Ver log</a></p>`));
  } catch (e) {
    return enviar(500, "text/plain; charset=utf-8", "ERRO: " + (e && e.stack ? e.stack : e));
  }
});

server.listen(PORT, () => log(`Servidor na porta ${PORT}. WORKER_URL=${WORKER || "(nao definido)"}`));
