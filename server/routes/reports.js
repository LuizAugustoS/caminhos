// Denúncias de anúncios: o turista sinaliza um anúncio; a equipe modera pela
// fila no painel. Motivos são uma lista fechada (categoria) + detalhe opcional.
import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../audit.js';

export const reports = Router();       // turista (autenticado)
export const adminReports = Router();  // admin

export const REPORT_REASONS = ['spam', 'inapropriado', 'enganoso', 'fora_regiao', 'outro'];

// Turista denuncia um anúncio aprovado. Um mesmo usuário não abre duas
// denúncias abertas para o mesmo anúncio (índice único no banco).
reports.post('/:listingId', async (req, res) => {
  const { reason, detail } = req.body || {};
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Motivo inválido' });
  const { rows: [l] } = await query(
    `SELECT id FROM listings WHERE id = $1 AND status = 'approved'`, [req.params.listingId]
  );
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado' });
  try {
    await query(
      `INSERT INTO listing_reports (listing_id, reporter_id, reason, detail)
       VALUES ($1, $2, $3, $4)`,
      [l.id, req.user.id, reason, (detail || '').trim().slice(0, 500) || null]
    );
  } catch (e) {
    if (e.code === '23505') return res.json({ ok: true, already: true }); // já denunciado
    throw e;
  }
  res.status(201).json({ ok: true });
});

// Fila de denúncias: anúncios com denúncias abertas, agrupados, mais graves
// (mais denúncias) primeiro.
adminReports.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT l.id AS listing_id, l.title, l.status AS listing_status, l.available,
            p.id AS producer_id, p.name AS producer_name,
            count(*)::int AS reports, max(r.created_at) AS last_report,
            array_agg(DISTINCT r.reason) AS reasons,
            array_remove(array_agg(r.detail ORDER BY r.created_at DESC), NULL) AS details
     FROM listing_reports r
     JOIN listings l ON l.id = r.listing_id
     JOIN producers p ON p.id = l.producer_id
     WHERE r.status = 'open'
     GROUP BY l.id, l.title, l.status, l.available, p.id, p.name
     ORDER BY count(*) DESC, max(r.created_at) DESC`
  );
  const { rows: [c] } = await query(
    `SELECT count(DISTINCT listing_id)::int AS n FROM listing_reports WHERE status = 'open'`
  );
  res.json({ reports: rows, openCount: c.n });
});

// Resolver: marca como revisadas todas as denúncias abertas de um anúncio.
adminReports.post('/:listingId/reviewed', async (req, res) => {
  const { rows } = await query(
    `UPDATE listing_reports SET status = 'reviewed', reviewed_at = now()
     WHERE listing_id = $1 AND status = 'open' RETURNING id`,
    [req.params.listingId]
  );
  const { rows: [l] } = await query('SELECT title FROM listings WHERE id = $1', [req.params.listingId]);
  audit(req, 'report.reviewed', l ? l.title : `#${req.params.listingId}`);
  res.json({ ok: true, resolved: rows.length });
});
