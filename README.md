# Caminhos do Caparaó — Admin

Painel administrativo do marketplace de turismo rural **Caminhos do Caparaó** (região do Caparaó, ES/MG).

Aplicação **PWA** (instalável, funciona offline) com backend **Node.js/Express** e banco **PostgreSQL**.

## Funcionalidades

- **Login administrativo** com sessão assinada (HMAC) e senhas com scrypt
- **KPIs em tempo real** calculados no Postgres: novos turistas, produtores ativos, total de anúncios e volume de transações (com variação vs. período anterior, sparklines e donut)
- **Gestão de produtores/comerciantes**: fila de moderação com aprovar/recusar
- **Listas de conteúdo** (produtos, serviços e eventos) com abas e moderação
- **Monitoramento de turismo**: mapa de calor 12×6 das buscas dos últimos 7 dias por localidade
- **Chat interno & alertas** do sistema
- **PWA**: manifest + service worker — app shell em cache, API com *network-first* e fallback offline (o painel e os itinerários continuam acessíveis sem conexão, com os últimos dados sincronizados)

## Stack

| Camada | Tecnologia |
| --- | --- |
| Banco | PostgreSQL 16 |
| Backend | Node.js 20+, Express, `pg` |
| Frontend | HTML/CSS/JS vanilla (sem build), Service Worker, Web App Manifest |
| Auth | Cookie de sessão HMAC-SHA256, senhas scrypt (sem dependências extras) |

## Como rodar

### 1. Banco de dados

Com Docker:

```bash
docker compose up -d db
```

Ou use um Postgres existente e crie usuário/banco:

```sql
CREATE USER caminhos WITH PASSWORD 'caminhos';
CREATE DATABASE caminhos OWNER caminhos;
```

### 2. Aplicação

```bash
cp .env.example .env       # ajuste DATABASE_URL/SESSION_SECRET se necessário
npm install
npm run db:setup           # migrations + seed com dados de demonstração
npm start                  # http://localhost:3000
```

### 3. Login

O seed cria o admin:

- **E-mail:** `admin@caminhosdocaparao.com.br`
- **Senha:** `caparao2026`

(Personalizável via `ADMIN_EMAIL`/`ADMIN_PASSWORD` antes do seed.)

## API

Todas as rotas (exceto login/health) exigem sessão.

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/login` | Autenticação (`{email, password}`) |
| POST | `/api/logout` | Encerra a sessão |
| GET | `/api/me` | Admin autenticado |
| GET | `/api/dashboard` | KPIs, sparklines, mapa de calor, estatísticas |
| GET | `/api/producers?status=&limit=` | Produtores (pendentes primeiro) |
| POST | `/api/producers/:id/status` | Aprova/recusa (`{status: "approved"\|"rejected"}`) |
| GET | `/api/listings?type=product\|service\|event` | Anúncios por tipo |
| POST | `/api/listings/:id/status` | Aprova/recusa anúncio |
| GET | `/api/chat` · POST `/api/chat` | Chat interno |
| GET | `/api/alerts` | Alertas do sistema |
| GET | `/api/itineraries` | Itinerários (flag `offline_ready`) |
| GET | `/api/health` | Saúde do serviço/banco |

## Estrutura

```
db/            migrations SQL + scripts de migrate/seed
server/        Express: auth, rotas de dashboard, moderação e utilitários
public/        PWA: index.html, styles.css, app.js, sw.js, manifest, ícones
```

## PWA offline

O service worker (`public/sw.js`) mantém dois caches:

- **shell**: HTML/CSS/JS/ícones e fontes (cache-first com revalidação)
- **data**: respostas GET da API (network-first; offline, serve o último snapshot)

Ao ficar offline o painel mostra um aviso e continua operável em modo leitura com os dados mais recentes.
