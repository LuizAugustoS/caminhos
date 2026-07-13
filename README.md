# Caminhos do Caparaó

Plataforma digital de turismo rural e marketplace regional do **Caparaó (ES/MG)** — MVP completo com três perfis (Turista, Produtor/Comerciante e Administrador).

Aplicação **PWA offline-first** (instalável, sem lojas de aplicativos) com backend **Node.js/Express** e banco **PostgreSQL**.

## Perfis e funcionalidades

### 🧭 Turista (`/app`)
- **Explorar**: busca de produtos, serviços, eventos e estabelecimentos da região
- **Meus Roteiros**: criação e gestão de itinerários personalizados **100% offline-first** — os roteiros vivem no IndexedDB do dispositivo, funcionam sem rede e sincronizam automaticamente quando a conexão volta
- **Favoritos**: disponíveis offline
- **Mensagens**: chat assimétrico com produtores (dúvidas/reservas); envios offline entram na fila e são entregues ao reconectar

### ☕ Produtor/Comerciante (`/portal`)
- **Vitrine virtual**: criação rápida de anúncios (produtos, serviços, eventos) — novos anúncios e edições entram na fila de moderação do admin
- **Mensagens**: caixa de entrada dedicada com turistas
- **Meu Estabelecimento**: edição do perfil público (descrição, categoria, endereço, contato, horários)

### 🛠 Administrador (`/admin`)
- Painel completo conforme o protótipo: 4 cartões de KPI com gráficos, gestão/moderação de produtores e conteúdo, mapa de calor de buscas 12×6 com indicador de itinerários offline, listas de conteúdo com abas, chat interno e alertas

## Arquitetura offline-first

| Camada | Papel |
| --- | --- |
| **Service Worker** (`public/sw.js`) | App shell em *cache-first*; API GET em *network-first* com fallback ao cache; fontes com timeout (nunca bloqueiam a página) |
| **IndexedDB** (`public/js/idb.js`, JS puro) | Dados operacionais locais: roteiros (fonte da verdade), favoritos, caches de exploração e conversas |
| **Fila de sincronização** (outbox no IndexedDB) | Toda mutação offline (roteiro, favorito, mensagem) entra na fila e é reenviada no evento `online`; o servidor expõe rotas **idempotentes** por `client_uid`, então reenvio nunca duplica |

## Stack

| Camada | Tecnologia |
| --- | --- |
| Banco | PostgreSQL 16 |
| Backend | Node.js 20+, Express 5, `pg` |
| Frontend | HTML/CSS/JS vanilla (sem build), Service Worker, IndexedDB, Web App Manifest |
| Auth | Sessão em cookie HMAC-SHA256, senhas scrypt, papéis (tourist/producer/admin) |

## Como rodar

### 1. Banco de dados

Com Docker:

```bash
docker compose up -d db
```

Ou em um Postgres existente:

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

### 3. Contas de demonstração (criadas pelo seed)

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Admin | `admin@caminhosdocaparao.com.br` | `caparao2026` |
| Turista | `turista@demo.com` | `caparao2026` |
| Produtor | `produtor@demo.com` | `caparao2026` |

Novas contas de turista e produtor podem ser criadas pela própria landing page (produtores entram na fila de aprovação do admin).

## API (resumo)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/register` · `/api/login` · `/api/logout` | público | Autenticação multi-perfil |
| GET | `/api/explore/listings?type=&q=` | público | Anúncios aprovados |
| GET | `/api/explore/establishments?q=` | público | Estabelecimentos de parceiros |
| GET | `/api/explore/itineraries` | público | Itinerários publicados (flag offline) |
| GET/PUT/DELETE | `/api/trips[/:clientUid]` | turista | Roteiros — upsert completo idempotente |
| GET/PUT/DELETE | `/api/favorites[/:listingId]` | turista | Favoritos idempotentes |
| GET/POST | `/api/conversations[/:id/messages]` | turista/produtor | Chat assimétrico (envio idempotente por `client_uid`) |
| GET/PUT/POST/DELETE | `/api/portal/*` | produtor | Overview, estabelecimento e vitrine |
| GET/POST | `/api/dashboard` · `/api/producers` · `/api/listings` … | admin | Painel e moderação |
| GET | `/api/health` | público | Saúde do serviço/banco |

## Estrutura

```
db/            migrations SQL (001 schema base, 002 perfis MVP) + migrate/seed
server/        Express: auth multi-perfil e rotas (dashboard, moderação,
               explore, trips, chat, portal)
public/        PWA: landing (index), /app turista, /portal produtor,
               /admin, styles.css, sw.js, js/ (shared, idb, tourist, producer)
```

## Testado de ponta a ponta

O MVP foi verificado em navegador real (Chromium): cadastro de turista, exploração, favoritos, **criação de roteiro em modo offline com sincronização automática ao reconectar**, chat turista ↔ produtor nos dois sentidos, criação de anúncio pelo produtor caindo na moderação do admin, e o painel admin completo.
