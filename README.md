# gartic-bot

Bot para Gartic Phone rodando no Cloudflare Workers, 100% automático:

- **Browser Rendering**: Chromium na nuvem, controlado por Puppeteer.
- **Workers AI**: gera a imagem a ser desenhada e descreve os desenhos para dar palpites.

## O que ele faz sozinho

1. Abre o link da sala e entra com o nome escolhido.
2. Na primeira rodada, escreve uma frase aleatória.
3. Na rodada de desenhar, lê a frase na tela, gera uma imagem em linhas pretas com IA e desenha no canvas.
4. Na rodada de adivinhar, olha o desenho, descreve com IA e escreve o palpite.

## Deploy

1. No painel da Cloudflare: **Workers & Pages → Create → Import a repository** e escolha este repositório.
2. Deixe o comando de deploy padrão (`npx wrangler deploy`).
3. Browser Rendering e Workers AI precisam estar disponíveis na sua conta (ambos têm limite diário no plano grátis).

## Uso

```
https://gartic-bot.SEU-USUARIO.workers.dev/?link=LINK_DA_SALA&nick=Bot&min=5
```

| Parâmetro | O que é |
|-----------|---------|
| `link` | Link da sala do Gartic Phone |
| `nick` | Nome do bot na sala (padrão: Bot) |
| `min` | Minutos que o bot fica na sala, máximo 9 (padrão: 5) |

Deixe a aba aberta enquanto o bot roda. No fim, a página mostra o log do que ele fez.

## Limitações

- Os seletores (campo de nome, botão "Pronto", canvas) e a leitura da frase na tela são detecções genéricas e podem precisar de ajuste.
- O desenho é limitado a cerca de 450 traços para caber no tempo da rodada.
- Os palpites vêm de um modelo pequeno de visão e podem errar bastante.
- Cada chamada dura no máximo uns 9 minutos. Para partidas longas, abra a URL de novo.
- Use só em salas com amigos que sabem do bot.
