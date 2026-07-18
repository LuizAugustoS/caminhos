# Caminhos do Caparaó

Plataforma digital de turismo rural e marketplace regional do **Caparaó (ES/MG)** — MVP completo com três perfis (Turista, Produtor/Comerciante e Administrador).

Aplicação **PWA offline-first** (instalável, sem lojas de aplicativos) com backend **Node.js/Express** e banco **PostgreSQL**.

## Perfis e funcionalidades

### 🧭 Turista (`/app`)
- **Explorar**: busca de produtos, serviços, eventos, estabelecimentos e **roteiros publicados** pela equipe (com "usar como base", que copia para os seus roteiros — funciona offline). Cada busca real alimenta o mapa de calor do admin
- **✨ Montar roteiro pra mim**: o turista informa seus gostos (café, trilhas, cachoeiras…), o tempo disponível, o ritmo e o que quer viver — e uma **IA (ou fluxo N8N) monta o roteiro** usando o catálogo aprovado da plataforma. O roteiro é salvo com as preferências informadas e fica disponível em "Meus Roteiros" para consultar depois (inclusive offline)
- **Meus Roteiros**: criação e gestão de itinerários personalizados **100% offline-first** — os roteiros vivem no IndexedDB do dispositivo, funcionam sem rede e sincronizam automaticamente quando a conexão volta
- **Mapa da região**: aba "Mapa" no Explorar com os estabelecimentos parceiros no OpenStreetMap (Leaflet servido localmente, sem chave de API) e botão **"como chegar"** nos cards, no detalhe do anúncio e nos popups do mapa
- **Favoritos**: disponíveis offline
- **Mensagens**: chat assimétrico com produtores (dúvidas/reservas); envios offline entram na fila e são entregues ao reconectar
- **Avaliações**: após uma reserva concluída, o turista avalia com 1–5 estrelas e comentário (editável); a média aparece nos cards do Explorar, no detalhe do anúncio e nos estabelecimentos
- **Notificações push**: mensagens e respostas de reserva avisam no aparelho mesmo com o app fechado (ativação em "Minha conta"; requer chaves VAPID no servidor)

### ☕ Produtor/Comerciante (`/portal`)
- **Planos de cadastro** (a cobrança acontece fora da plataforma — sem pagamento no app): **Gratuito** (até 3 anúncios, 1 foto por anúncio), **Profissional** (até 10 anúncios, 5 fotos, selo) e **Premium** (anúncios ilimitados, 10 fotos, selo ★ e destaque no topo do Explorar). O produtor escolhe o plano no cadastro; o admin pode trocar o plano de qualquer parceiro pelo painel
- **Vitrine virtual**: criação rápida de anúncios (produtos, serviços, eventos) com **galeria de fotos** (várias por anúncio conforme o plano, JPG/PNG/WebP até 5 MB — a primeira é a capa; servidas em `/uploads` e cacheadas offline pelo PWA) — novos anúncios e edições entram na fila de moderação do admin
- **Mensagens**: caixa de entrada dedicada com turistas
- **Meu Estabelecimento**: edição do perfil público (descrição, categoria, endereço, contato, horários) e **localização no mapa** — toque para marcar o ponto ou use a própria localização; o marcador aparece no mapa do Explorar

### 🛠 Administrador (`/admin`)
- Painel completo conforme o protótipo: 4 cartões de KPI com gráficos, gestão/moderação de produtores e conteúdo, mapa de calor de buscas 12×6 com indicador de itinerários offline, listas de conteúdo com abas, chat interno e alertas
- **Moderação de avaliações**: o detalhe do anúncio lista todas as avaliações (inclusive ocultas) com ocultar/exibir — avaliações ocultas saem das médias públicas

## Arquitetura offline-first

| Camada | Papel |
| --- | --- |
| **Service Worker** (`public/sw.js`) | App shell em *cache-first*; API GET em *network-first* com fallback ao cache; fontes com timeout (nunca bloqueiam a página) |
| **IndexedDB** (`public/js/idb.js`, JS puro) | Dados operacionais locais: roteiros (fonte da verdade), favoritos, caches de exploração e conversas |
| **Fila de sincronização** (outbox no IndexedDB) | Toda mutação offline (roteiro, favorito, mensagem) entra na fila e é reenviada no evento `online`; o servidor expõe rotas **idempotentes** por `client_uid`, então reenvio nunca duplica |

## Geração de roteiros por IA / N8N

O motor é plugável via `AI_PROVIDER` no `.env` (`server/ai.js`):

| Provedor | Configuração | Comportamento |
| --- | --- | --- |
| `local` *(padrão)* | nenhuma | Gerador por regras sobre o catálogo aprovado — funciona sem chave/serviço externo |
| `anthropic` | `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, padrão `claude-opus-4-8`) | Claude monta o roteiro a partir das preferências + catálogo, com saída estruturada (JSON Schema) |
| `n8n` | `N8N_WEBHOOK_URL` | POST `{ preferences, catalog }` para o seu fluxo N8N, que responde `{ title, notes, items: [{listing_id\|null, label\|null, note\|null}] }` |

Se o provedor externo falhar (timeout, erro, recusa), o gerador local assume automaticamente — o turista sempre recebe um roteiro. Toda geração valida os `listing_id` contra o catálogo antes de salvar, e o roteiro é gravado em `trips` com `origin='ai'` e as `preferences` em JSONB.

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
| POST | `/api/password/forgot` · `/api/password/reset` | público | Recuperação de senha por e-mail (token de 1h, uso único) |
| GET | `/api/plans` | público | Planos de produtor (limites e preço de referência) |
| GET | `/api/explore/listings?type=&q=` | público | Anúncios aprovados (Premium em destaque) |
| GET | `/api/explore/establishments?q=` | público | Estabelecimentos de parceiros |
| GET | `/api/explore/itineraries` | público | Itinerários publicados (flag offline) |
| GET/PUT/DELETE | `/api/trips[/:clientUid]` | turista | Roteiros — upsert completo idempotente |
| GET/PUT/DELETE | `/api/favorites[/:listingId]` | turista | Favoritos idempotentes |
| POST | `/api/reviews` | turista | Avaliação de reserva concluída (1–5 estrelas, editável) |
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

## Deploy (produção)

O app é um único serviço Node + um PostgreSQL — roda em qualquer host (Railway, Render, Fly.io, VPS). Requisitos:

1. **HTTPS obrigatório** — sem ele o PWA não é instalável fora do localhost (as plataformas acima já fornecem TLS)
2. Variáveis: `DATABASE_URL` (Postgres gerenciado), `SESSION_SECRET` (valor longo e aleatório), `NODE_ENV=production` (ativa o cookie `Secure`), `PORT` (a plataforma define). Opcional: `AI_PROVIDER`/`ANTHROPIC_API_KEY` ou `N8N_WEBHOOK_URL`, `UPLOADS_DIR` (aponte para um volume persistente — em filesystem efêmero as fotos se perdem no redeploy)
3. **E-mails** (recuperação de senha, aprovação de produtor e avisos de reserva): configure `SMTP_HOST`, `SMTP_PORT` (padrão 587), `SMTP_USER`/`SMTP_PASS`, `SMTP_SECURE=true` para porta 465, `MAIL_FROM` (remetente) e `APP_URL` (URL pública usada nos links). Sem `SMTP_HOST`, os e-mails são apenas registrados no log — a plataforma segue funcionando
4. **Notificações push** (mensagens e reservas com o app fechado): gere as chaves VAPID com `npm run push:keys` e configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (mailto: de contato). Sem as chaves o recurso fica desligado e a opção some do menu. O usuário ativa em **Minha conta → Ativar notificações**
5. Build: `npm ci` · Release: `npm run db:migrate` · Start: `npm start` (rode o seed apenas uma vez, se quiser dados demo)

Proteções já embutidas: CSP e security headers, HSTS sob HTTPS, rate-limiting em login (10/15min por IP+e-mail) e cadastro (5/h por IP), cookie de sessão `HttpOnly`+`SameSite`+`Secure`, senhas com scrypt e uploads validados por tipo/tamanho.

## Testado de ponta a ponta

O MVP foi verificado em navegador real (Chromium): cadastro de turista, exploração, favoritos, **criação de roteiro em modo offline com sincronização automática ao reconectar**, chat turista ↔ produtor nos dois sentidos, criação de anúncio pelo produtor caindo na moderação do admin, e o painel admin completo.
