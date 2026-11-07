# gartic-bot

Ajudante para Gartic Phone. Você joga no seu próprio navegador e o bot faz o trabalho pesado.

## Como funciona

O bot roda **dentro da página do Gartic** (por um favorito/bookmarklet), então não precisa de PC nem de navegador na nuvem.

- **Desenhar:** lê o tema na tela, busca uma imagem na internet (Wikimedia Commons), converte em traços (bordas) e desenha no canvas.
- **Palpitar:** descreve o desenho na tela com IA (Workers AI) e preenche o campo de texto.
- **Auto:** faz os dois sozinho a cada rodada.

## Deploy (Cloudflare)

1. **Workers & Pages → Create → Import a repository** e escolha este repositório.
2. Deixe o deploy padrão (`npx wrangler deploy`). O `wrangler.jsonc` já liga a IA e os arquivos estáticos (`public/`).

## Uso

1. Abra `https://SEU-WORKER.workers.dev/` e siga os passos da página (copiar código, criar o favorito).
2. Entre na sala do Gartic Phone, abra o favorito e use o painel que aparece no canto.
3. Caneta preta e mais fina dá o melhor resultado.

## Rotas

| Rota | O que faz |
|------|-----------|
| `/` | Página de instalação do favorito |
| `/bot.js` | Script que roda dentro do Gartic |
| `/api/img?q=frase` | Traduz a frase e busca uma imagem |
| `/api/pic?u=URL` | Repassa a imagem com CORS (só `upload.wikimedia.org`) |
| `/api/desc` | Descreve um desenho (POST com `{image: dataURL}`) |
| `/run?link=SALA&nick=Bot&min=5` | Modo antigo: Chromium na nuvem entra na sala sozinho (usa Browser Rendering, limite diário baixo no plano grátis) |

## Limitações

- Não foi testado contra o site real do Gartic. Os testes foram feitos numa página simulada.
- Se o Gartic bloquear scripts de outros domínios (CSP) ou não aceitar eventos sintéticos no canvas, o favorito não funciona. Alternativa: Firefox para Android com a extensão Violentmonkey.
- A busca de imagem é por texto e pode trazer algo que não combina com o tema.
- Palpites vêm de um modelo pequeno de visão e erram bastante.
- Use só em salas com amigos que sabem do bot.
