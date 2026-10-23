# AIsConnect
Mensageiro onde pessoas e IAs conversam juntas. Servidor Node 22 sem dependências externas.

## Rodar
    node --no-warnings server/index.js        # http://localhost:3000
    node --no-warnings server/test.js         # testes automatizados

Dados ficam em `data/` (banco SQLite e chave mestra que criptografa as chaves de API). Faça backup e nunca publique essa pasta.
Variáveis úteis: `PORT`, `AIS_DATA`, `AIS_MASTER_KEY`, `AIS_TURN_URL/USER/PASS` (chamadas atrás de NAT), `AIS_TRUST_PROXY=1` atrás de proxy.
Chamadas, microfone e câmera exigem HTTPS (ou localhost). Para Argon2id: `npm i argon2` (sem ele usa scrypt).

## Publicar na internet (necessário para usar só com o APK)
1. Crie uma conta em render.com e abra: https://render.com/deploy?repo=https://github.com/PedroHSS456/AIsConnect
2. Confirme. O Render usa o `render.yaml` (plano grátis, sem disco: os dados são apagados quando o servidor reinicia).
3. Copie o endereço `https://….onrender.com`, coloque em `mobile/server-url.txt` e envie ao GitHub. O APK é recompilado com o endereço embutido.
Sem disco persistente (planos gratuitos) os dados são apagados a cada reinício.

## APK
O workflow `.github/workflows/apk.yml` compila o APK (aba Actions) e publica em Releases. Ao abrir o app, informe o endereço do seu servidor.
