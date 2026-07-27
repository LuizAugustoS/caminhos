import { Router } from 'express';
import { query } from '../db.js';

export const dashboard = Router();

// Visão de operação do admin: o que precisa de ação (fila), os números reais
// da plataforma (sem métricas de vaidade) e o que a região anda buscando.
// A plataforma não processa pagamento — não há "volume transacionado".
dashboard.get('/', async (_req, res) => {
  const [queue, totals, searched, itineraries] = await Promise.all([
    // Fila de trabalho: tudo que espera decisão da equipe.
    query(`SELECT
             (SELECT count(*) FROM producers WHERE status IN ('pending', 'in_review')) AS pending_producers,
             (SELECT count(*) FROM listings  WHERE status IN ('pending', 'in_review')) AS pending_listings,
             (SELECT count(*) FROM listing_reports WHERE status = 'open')             AS open_reports`),
    // Números reais da plataforma, ditos sem drama.
    query(`SELECT
             (SELECT count(*) FROM tourists)                                          AS tourists,
             (SELECT count(*) FROM producers WHERE status = 'approved')               AS producers,
             (SELECT count(*) FROM listings  WHERE status = 'approved')               AS listings,
             (SELECT count(DISTINCT producer_id) FROM listings WHERE status = 'approved') AS with_listings`),
    // O que a região buscou nos últimos 7 dias (top destinos), sem mapa de calor.
    query(`SELECT spot, count(*) AS searches
             FROM search_events
             WHERE created_at >= now() - interval '7 days' AND spot IS NOT NULL
             GROUP BY spot ORDER BY searches DESC, spot LIMIT 6`),
    query(`SELECT count(*) FILTER (WHERE offline_ready AND published) AS offline_ready,
                  max(updated_at) AS last_sync
             FROM itineraries`),
  ]);

  const q = queue.rows[0], t = totals.rows[0], it = itineraries.rows[0];
  res.json({
    queue: {
      pendingProducers: Number(q.pending_producers),
      pendingListings: Number(q.pending_listings),
      openReports: Number(q.open_reports),
    },
    totals: {
      tourists: Number(t.tourists),
      activeProducers: Number(t.producers),
      listings: Number(t.listings),
      withListingsPct: Math.round((Number(t.with_listings) / Math.max(1, Number(t.producers))) * 100),
    },
    topSearched: searched.rows.map(r => ({ spot: r.spot, searches: Number(r.searches) })),
    offlineItineraries: Number(it.offline_ready),
    lastSync: it.last_sync,
  });
});
