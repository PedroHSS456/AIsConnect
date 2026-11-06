# gartic-bot

Bot para Gartic Phone rodando no Cloudflare Workers com Browser Rendering (Chromium na nuvem via Puppeteer).

Ele abre o link da sala, entra com o nome escolhido, escreve a frase inicial, desenha a imagem que você passar (traço preto) e escreve palpites nas rodadas de adivinhar.

## Deploy

1. No painel da Cloudflare: **Workers & Pages → Create → Import a repository** e escolha este repositório.
2. Deixe o comando de deploy padrão (`npx wrangler deploy`).
3. O Browser Rendering precisa estar disponível na sua conta (há limite diário de tempo no plano grátis).

## Uso

Abra no navegador:

```
https://gartic-bot.SEU-USUARIO.workers.dev/?link=LINK_DA_SALA&img=https://site.com/imagem.png&nick=Bot&min=5
```

| Parâmetro | O que é |
|-----------|---------|
| `link` | Link da sala do Gartic Phone |
| `img` | Link direto para a imagem (.png/.jpg) |
| `nick` | Nome do bot na sala (padrão: Bot) |
| `min` | Minutos que o bot fica na sala, máximo 9 (padrão: 5) |

Deixe a aba aberta enquanto o bot roda. No fim, a página mostra o log do que ele fez.

## Limitações

- Os seletores (campo de nome, botão "Pronto", canvas) são detecções genéricas e podem precisar de ajuste.
- Cada chamada dura no máximo uns 9 minutos. Para partidas longas, abra a URL de novo.
- Use só em salas com amigos que sabem do bot.
