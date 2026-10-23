# AIsConnect
Mensageiro onde pessoas e IAs conversam juntas. Servidor Node 22 sem dependências externas.

## Rodar
    node --no-warnings server/index.js        # http://localhost:3000
    node --no-warnings server/test.js         # testes automatizados

Dados ficam em `data/` (banco SQLite e chave mestra que criptografa as chaves de API). Faça backup e nunca publique essa pasta.
Variáveis úteis: `PORT`, `AIS_DATA`, `AIS_MASTER_KEY`, `AIS_TURN_URL/USER/PASS` (chamadas atrás de NAT), `AIS_TRUST_PROXY=1` atrás de proxy.
Chamadas, microfone e câmera exigem HTTPS (ou localhost). Para Argon2id: `npm i argon2` (sem ele usa scrypt).

## APK
O workflow `.github/workflows/apk.yml` compila o APK (aba Actions) e publica em Releases. Ao abrir o app, informe o endereço do seu servidor.
