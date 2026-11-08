# gartic-bot

Ajudante para Gartic Phone. Você joga no seu próprio navegador e o bot faz o trabalho pesado.

## Como funciona

O bot roda **dentro da página do Gartic** (por um favorito/bookmarklet), então não precisa de PC nem de navegador na nuvem.

- **Decalque:** você digita o tema e toca em Decalque: o contorno e as cores da imagem (ou um rabisco) aparecem transparentes por cima do canvas, sem bloquear o toque, e você passa o dedo por cima.
- **Desenhar (antigo):** lê o tema na tela e desenha no canvas. Tenta, em ordem: (1) imagem da internet convertida em traços, (2) traços escritos pela IA, (3) rabiscos prontos no próprio script. O painel diz qual usou e avisa se o Gartic ignorar os traços.
- **Palpitar:** descreve o desenho na tela com IA (Workers AI) e preenche o campo de texto.
- **Auto:** faz os dois sozinho a cada rodada.
- **Gravar toque:** grava um toque seu de verdade no canvas (8s) e passa a imitar o mesmo tipo de ponteiro e de eventos. **Copiar log** copia o diagnóstico para mandar a quem for ajustar o bot.

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
| `/api/rabisco?q=frase` | A IA escreve os traços de um desenho simples (plano B quando a imagem falha) |
| `/api/desc` | Descreve um desenho (POST com `{image: dataURL}`) |
| `/run?link=SALA&nick=Bot&min=5` | Modo antigo: Chromium na nuvem entra na sala sozinho (usa Browser Rendering, limite diário baixo no plano grátis) |

## Limitações

- Não foi testado contra o site real do Gartic. Os testes foram feitos numa página simulada.
- Se o Gartic bloquear scripts de outros domínios (CSP) ou não aceitar eventos sintéticos no canvas, o favorito não funciona. Alternativa: Firefox para Android com a extensão Violentmonkey.
- A busca de imagem é por texto e pode trazer algo que não combina com o tema.
- Palpites vêm de um modelo pequeno de visão e erram bastante.
- Use só em salas com amigos que sabem do bot.

## Bot no Render (automático, entra na sala como jogador)

O Gartic não aceita toque simulado dentro da página, então este modo roda um Chromium de verdade num servidor (Render) e usa o **mouse real** do Playwright. Ele entra na sala pelo link, escreve a primeira frase, desenha o tema e dá palpites, sozinho. Reaproveita o mesmo `public/bot.js` (baixado do Worker).

1. No Render: **New → Blueprint** (ou Web Service), conecte este repositório. O `render.yaml` já configura tudo (Docker em `render/`, variável `WORKER_URL`).
2. Abra `https://SEU-SERVICO.onrender.com/entrar?link=LINK_DA_SALA&nick=Bot&min=30`.
3. A página mostra o log e atualiza sozinha. `/tela` mostra uma foto do que o bot está vendo e `/parar` encerra.

Limites: o plano grátis do Render dorme sem acesso (deixe a página do log aberta) e tem pouca memória. A imagem e os palpites por IA usam o Worker da Cloudflare; se o limite diário dela acabar, ele usa rabiscos prontos e palpites genéricos.


> **Nota:** o Gartic bloqueia acessos vindos de servidores ("you have been blocked"), então o modo Render não consegue entrar na sala. O uso real é o favorito no seu celular (decalque + palpite).
