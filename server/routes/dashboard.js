import { Router } from 'express';
import { query } from '../db.js';

export const dashboard = Router();

const pctDelta = (current, previous) =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

// KPIs, sparklines, heatmap e estatísticas da semana — tudo em uma chamada.
dashboard.get('/', async (_req, res) => {
  const [tourists, touristSeries, producers, producerSeries, listings, listingShare, volume, volumeSeries, heat, weekStats, itineraries] =
    await Promise.all([
      query(`SELECT
               count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS current,
               count(*) FILTER (WHERE created_at >= now() - interval '60 days'
                                  AND created_at <  now() - interval '30 days') AS previous
             FROM tourists`),
      query(`SELECT count(t.id) AS n
             FROM generate_series(7, 0, -1) AS bucket
             LEFT JOIN tourists t
               ON t.created_at >= now() - (bucket + 1) * interval '4 days'
              AND t.created_at <  now() - bucket * interval '4 days'
             GROUP BY bucket ORDER BY bucket DESC`),
      query(`SELECT
               (SELECT count(*) FROM producers WHERE status = 'approved') AS approved,
               (SELECT count(*) FROM producers WHERE status = 'approved'
                  AND created_at < now() - interval '30 days') AS previous,
               (SELECT count(*) FROM producers WHERE status IN ('pending', 'in_review')) AS pending,
               (SELECT count(DISTINCT producer_id) FROM listings WHERE status = 'approved') AS with_listings`),
      // Crescimento de produtores aprovados: aprovações por janela de 4 dias
      query(`SELECT count(p.id) AS n
             FROM generate_series(7, 0, -1) AS bucket
             LEFT JOIN producers p
               ON p.status = 'approved'
              AND coalesce(p.reviewed_at, p.created_at) >= now() - (bucket + 1) * interval '4 days'
              AND coalesce(p.reviewed_at, p.created_at) <  now() - bucket * interval '4 days'
             GROUP BY bucket ORDER BY bucket DESC`),
      query(`SELECT
               count(*) FILTER (WHERE status = 'approved') AS current,
               count(*) FILTER (WHERE status = 'approved' AND created_at < now() - interval '30 days') AS previous
             FROM listings`),
      query(`SELECT round(100.0 * count(*) FILTER (WHERE type = 'product') / greatest(count(*), 1)) AS product_pct
             FROM listings WHERE status = 'approved'`),
      query(`SELECT
               coalesce(sum(amount_cents) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS current,
               coalesce(sum(amount_cents) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month'
                                                    AND created_at <  date_trunc('month', now())), 0) AS previous
             FROM transactions`),
      query(`SELECT coalesce(sum(amount_cents), 0) AS n
             FROM generate_series(7, 0, -1) AS bucket
             LEFT JOIN transactions t
               ON t.created_at >= now() - (bucket + 1) * interval '4 days'
              AND t.created_at <  now() - bucket * interval '4 days'
             GROUP BY bucket ORDER BY bucket DESC`),
      query(`SELECT grid_row, grid_col, max(spot) AS spot, count(*) AS searches
             FROM search_events
             WHERE created_at >= now() - interval '7 days'
             GROUP BY grid_row, grid_col`),
      query(`SELECT
               count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS current,
               count(*) FILTER (WHERE created_at >= now() - interval '14 days'
                                  AND created_at <  now() - interval '7 days') AS previous
             FROM search_events`),
      query(`SELECT count(*) FILTER (WHERE offline_ready AND published) AS offline_ready,
                    max(updated_at) AS last_sync
             FROM itineraries`),
    ]);

  // Grade 12×6 normalizada em níveis 0–5 para o mapa de calor
  const cells = Array.from({ length: 72 }, () => ({ level: 0, searches: 0, spot: null }));
  const maxSearches = Math.max(1, ...heat.rows.map(r => Number(r.searches)));
  let topCell = null;
  for (const row of heat.rows) {
    const idx = row.grid_row * 12 + row.grid_col;
    const searches = Number(row.searches);
    cells[idx] = { level: Math.ceil((searches / maxSearches) * 5), searches, spot: row.spot };
    if (!topCell || searches > topCell.searches) topCell = { spot: row.spot, searches };
  }

  const t = tourists.rows[0], p = producers.rows[0], l = listings.rows[0], v = volume.rows[0], w = weekStats.rows[0];
  res.json({
    kpis: {
      newTourists: {
        value: Number(t.current),
        deltaPct: pctDelta(Number(t.current), Number(t.previous)),
        series: touristSeries.rows.map(r => Number(r.n)),
      },
      activeProducers: {
        value: Number(p.approved),
        deltaPct: pctDelta(Number(p.approved), Number(p.previous)),
        withListingsPct: Math.round((Number(p.with_listings) / Math.max(1, Number(p.approved))) * 100),
        series: producerSeries.rows.map(r => Number(r.n)),
      },
      totalListings: {
        value: Number(l.current),
        deltaPct: pctDelta(Number(l.current), Number(l.previous)),
        productSharePct: Number(listingShare.rows[0].product_pct),
      },
      transactionVolume: {
        valueCents: Number(v.current),
        deltaPct: pctDelta(Number(v.current), Number(v.previous)),
        series: volumeSeries.rows.map(r => Number(r.n)),
      },
    },
    heatmap: {
      cells,
      top: topCell,
      weeklySearches: Number(w.current),
      weeklyDeltaPct: pctDelta(Number(w.current), Number(w.previous)),
      offlineItineraries: Number(itineraries.rows[0].offline_ready),
      lastSync: itineraries.rows[0].last_sync,
    },
    pendingReviews: Number(p.pending),
  });
});
