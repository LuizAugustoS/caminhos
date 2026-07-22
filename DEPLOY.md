# Guia de lançamento — Caminhos do Caparaó

Passo a passo para colocar a plataforma no ar e mantê-la. Comece pelo mínimo
(1–4) e ligue os opcionais (5) conforme a necessidade.

## 0. Pré-requisitos

- **Node.js 20+** e **PostgreSQL 16**.
- Um domínio com **HTTPS** (a plataforma marca o cookie de sessão como `Secure`
  e envia HSTS quando `NODE_ENV=production`; sem HTTPS a sessão não funciona).

## 1. Variáveis de ambiente (mínimo obrigatório)

Copie `.env.example` para `.env` e preencha:

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Conexão do PostgreSQL gerenciado |
| `SESSION_SECRET` | Segredo do cookie de sessão — **valor longo e aleatório** (`openssl rand -hex 32`) |
| `NODE_ENV=production` | Liga cookie `Secure` + HSTS |
| `PORT` | Porta HTTP (a plataforma normalmente define) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin criado pelo seed — **troque a senha** |

Sem os opcionais, o app funciona: o gerador de roteiros usa o modo local, os
e-mails caem no log, as fotos ficam em disco e o push fica desligado.

## 2. Banco de dados

```bash
npm ci                 # instala dependências (inclui sharp para as imagens)
npm run db:setup       # aplica as migrations e popula o seed (admin + demos)
```

- `db:setup` = `db:migrate` + `db:seed`. Em produção real, rode `db:migrate`
  e crie o admin com credenciais próprias (o seed também insere contas demo —
  remova-as depois, se quiser um banco limpo).
- Migrations novas: rode `npm run db:migrate` a cada deploy que traga arquivos
  em `db/migrations/` (é idempotente).

## 3. Subir o servidor

```bash
NODE_ENV=production npm start     # node server/index.js
```

Rode atrás de um proxy HTTPS (Nginx/Caddy/load balancer da PaaS). Para várias
instâncias atrás de um balanceador, veja `RATE_LIMIT_STORE=db` no passo 5.

## 4. Verificação pós-deploy (smoke)

```bash
curl -s https://SEU-DOMINIO/api/health      # → {"ok":true,"db":"up"}
```

Depois, no navegador, confirme o caminho crítico:
1. abrir a landing e **criar uma conta** de turista;
2. **explorar** e abrir o detalhe de um anúncio;
3. como produtor aprovado, **publicar um anúncio** com foto;
4. como turista, **fazer uma reserva**; como produtor, **confirmar**.

`GET /sitemap.xml` e `GET /robots.txt` devem responder para SEO.

## 5. Opcionais (ligue conforme precisar)

Todos são **no-op sem configuração** — nada quebra se ficarem desligados.

- **Fotos que sobrevivem a redeploy** — em disco efêmero as imagens somem. Use
  um volume persistente (`UPLOADS_DIR`) **ou** S3/Cloudflare R2
  (`S3_*` no `.env` + `npm i @aws-sdk/client-s3`).
- **E-mails transacionais** (recuperação de senha, reservas, aprovações) —
  configure `SMTP_*`, `MAIL_FROM` e `APP_URL` (usada nos links). Sem SMTP os
  e-mails só aparecem no log.
- **Notificações push** (avisos com o app fechado) — gere as chaves com
  `npm run push:keys` e preencha `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`.
- **Gerador de roteiros por IA** — `AI_PROVIDER=anthropic` (+ `ANTHROPIC_API_KEY`,
  `ANTHROPIC_MODEL`) ou `AI_PROVIDER=n8n` (+ `N8N_WEBHOOK_URL`). Se o provedor
  externo falhar, o modo local assume sozinho.
- **Rastreamento de erros** — `SENTRY_DSN` + `npm i @sentry/node`.
- **Rate-limit compartilhado** (múltiplas instâncias) — `RATE_LIMIT_STORE=db`.

## 6. Backup e restauração

```bash
npm run db:backup     # gera backups/caminhos-<data>.dump (pg_dump custom)
                      # e backups/uploads-<data>.tar.gz (as fotos em disco)
```

- Agende com cron (ex.: diário) e **copie os arquivos para fora do servidor**
  (outro bucket/região). Ajuste o destino com `BACKUP_DIR`.
- Restaurar o banco:
  ```bash
  pg_restore --clean --no-owner -d "$DATABASE_URL" backups/caminhos-<data>.dump
  ```
- Restaurar as fotos: extraia o `uploads-<data>.tar.gz` no `UPLOADS_DIR`
  (desnecessário se estiver usando S3/R2).

## 7. Testes (CI e local)

```bash
npm test         # API de ponta a ponta (sobe o servidor real contra o banco)
npm run test:ui  # smoke de navegador (Playwright)
```

O GitHub Actions já roda os dois em cada push (serviço Postgres + `npm ci`).

## Checklist rápido de produção

- [ ] `NODE_ENV=production` e `SESSION_SECRET` forte
- [ ] HTTPS na frente (cookie `Secure`/HSTS dependem disso)
- [ ] Senha do admin trocada; contas demo removidas (se aplicável)
- [ ] `db:migrate` aplicado
- [ ] Fotos em volume persistente **ou** S3/R2 configurado
- [ ] SMTP configurado (senão os e-mails só vão para o log)
- [ ] `/api/health` respondendo `{"ok":true,"db":"up"}`
- [ ] Backup agendado e testado (restauração)
