# WChic Backend

Backend único em Node.js + TypeScript + Express para o sistema WChic, integrando WhatsApp Cloud API, OpenAI, Podio e Postgres (Supabase).

## Requisitos
- Node.js 20+
- Postgres (Supabase)

## Configuração de ambiente
Crie um `.env` com as variáveis abaixo:

```
PORT=3000
DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB

WHATSAPP_CLIENTS_PHONE_NUMBER_ID=...
WHATSAPP_OPS_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN_CLIENTS=...
WHATSAPP_VERIFY_TOKEN_OPS=...
WHATSAPP_APP_SECRET=... # opcional (para validar assinatura)

OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini

PODIO_CLIENT_ID=...
PODIO_CLIENT_SECRET=...
PODIO_APP_ID_FRANQUEADORA=...

ADMIN_USER=admin
ADMIN_PASS=admin
JWT_SECRET=troque_isto
```

## Rodar local
```
npm install
npm run migrate:dev
npm run dev
```

## Build e produção
```
npm run build
npm run migrate
npm start
```

## Migrations
- As migrations SQL ficam em `migrations/`.
- O runner simples grava o histórico em `schema_migrations`.

## Webhooks WhatsApp
Endpoints:
- `GET /webhook/clients` (verify)
- `POST /webhook/clients`
- `GET /webhook/ops` (verify)
- `POST /webhook/ops`

Exemplo de verificação (GET):
```
curl -G "http://localhost:3000/webhook/clients" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=SEU_TOKEN" \
  --data-urlencode "hub.challenge=CHALLENGE"
```

Exemplo de envio (POST simulando mensagem):
```
curl -X POST http://localhost:3000/webhook/clients \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "5511999999999",
            "id": "wamid.TEST",
            "timestamp": "1234567890",
            "type": "text",
            "text": { "body": "Oi" }
          }]
        }
      }]
    }]
  }'
```

## Simular lead completo
1. Envie mensagens via `/webhook/clients` até o agente gerar o bloco:
   `LEAD_WCHIC_JSON:{...}`.
2. O backend normaliza, salva no Postgres, cria itens no Podio e agenda jobs.
3. Confira o lead no endpoint:
```
curl -H "Authorization: Bearer SEU_JWT" http://localhost:3000/leads
```

## Painel (API)
- `POST /auth/login` (admin)
- `GET /conversations?channel=clients|ops&status=...`
- `GET /conversations/:id/messages`
- `GET /leads?cidade=&estado=&franchise_id=`
- `GET /stats/basic`
- `GET/POST/PUT/DELETE /franchises`

Exemplo de login:
```
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

## Configuração Podio
- Mapeie os IDs de campos em:
  - `src/config/podioFieldMap.json`
  - `src/config/podioLeadFieldMap.json`
- Esses arquivos possuem placeholders. Substitua pelos IDs reais.

## Deploy (Render/Railway)
- Configure as mesmas env vars.
- Use `npm run build` e `npm start`.
- Execute migrations uma vez por deploy: `npm run migrate`.
