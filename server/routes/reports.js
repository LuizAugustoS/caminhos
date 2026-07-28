// Denúncias genéricas: turistas denunciam ANÚNCIOS e PRODUTORES; produtores
// denunciam TURISTAS (abuso no chat). A equipe modera tudo por uma fila única.
// Motivos são uma lista fechada (categoria) + detalhe opcional.
import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../audit.js';

export const reports = Router();       // turista/produtor (autenticado)
export const adminReports = Router();  // admin

export const REPORT_REASONS = ['spam', 'inapropriado', 'enganoso', 'fora_regiao', 'outro'];

// Configuração por tipo de alvo: quem pode denunciar e como validar o alvo.
const TARGETS = {
  listing: {
    roles: ['tourist'],
    validate: id => query(`SELECT id FROM listings WHERE id = $1 AND status = 'approved'`, [id]),
  },
  producer: {
    roles: ['tourist'],
    validate: id => query(`SELECT id FROM producers WHERE id = $1 AND status = 'approved'`, [id]),
  },
  tourist: {
    roles: ['producer'],
    validate: id => query(`SELECT id FROM users WHERE id = $1 AND role = 'tourist'`, [id]),
  },
};

// Abre uma denúncia. Índice único evita duas denúncias abertas do mesmo
// usuário para o mesmo alvo (devolve already:true nesse caso).
reports.post('/', async (req, res) => {
  const { target_type, target_id, reason, detail } = req.body || {};
  const cfg = TARGETS[target_type];
  if (!cfg) return res.status(400).json({ error: 'Tipo de denúncia inválido' });
  if (!cfg.roles.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão para esta denúncia' });
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Motivo inválido' });
  const id = Number(target_id);
  if (!id || !(await cfg.validate(id)).rows[0]) return res.status(404).json({ error: 'Alvo não encontrado' });
  try {
    await query(
      `INSERT INTO listing_reports (target_type, target_id, listing_id, reporter_id, reason, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [target_type, id, target_type === 'listing' ? id : null, req.user.id,
       reason, (detail || '').trim().slice(0, 500) || null]
    );
  } catch (e) {
    if (e.code === '23505') return res.json({ ok: true, already: true }); // já denunciado
    throw e;
  }
  res.status(201).json({ ok: true });
});

// Fila de denúncias: agrupadas por alvo (mais denúncias primeiro). O nome do
// alvo e um subtítulo são resolvidos conforme o tipo.
adminReports.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT r.target_type, r.target_id,
            count(*)::int AS reports, max(r.created_at) AS last_report,
            array_agg(DISTINCT r.reason) AS reasons,
            array_remove(array_agg(r.detail ORDER BY r.created_at DESC), NULL) AS details,
            CASE r.target_type
              WHEN 'listing'  THEN (SELECT title FROM listings  WHERE id = r.target_id)
              WHEN 'producer' THEN (SELECT name  FROM producers WHERE id = r.target_id)
              WHEN 'tourist'  THEN (SELECT name  FROM users     WHERE id = r.target_id)
            END AS target_name,
            CASE r.target_type
              WHEN 'listing'  THEN (SELECT p.name FROM listings l JOIN producers p ON p.id = l.producer_id WHERE l.id = r.target_id)
              WHEN 'producer' THEN (SELECT city  FROM producers WHERE id = r.target_id)
              ELSE NULL
            END AS target_sub
     FROM listing_reports r
     WHERE r.status = 'open'
     GROUP BY r.target_type, r.target_id
     ORDER BY count(*) DESC, max(r.created_at) DESC`
  );
  const { rows: [c] } = await query(
    `SELECT count(*)::int AS n FROM (
       SELECT DISTINCT target_type, target_id FROM listing_reports WHERE status = 'open'
     ) s`
  );
  res.json({ reports: rows, openCount: c.n });
});

// Resolver: marca como revisadas todas as denúncias abertas de um alvo.
adminReports.post('/:targetType/:targetId/reviewed', async (req, res) => {
  const { targetType, targetId } = req.params;
  if (!TARGETS[targetType]) return res.status(400).json({ error: 'Tipo inválido' });
  const { rows } = await query(
    `UPDATE listing_reports SET status = 'reviewed', reviewed_at = now()
     WHERE target_type = $1 AND target_id = $2 AND status = 'open' RETURNING id`,
    [targetType, targetId]
  );
  audit(req, 'report.reviewed', `${targetType} #${targetId}`);
  res.json({ ok: true, resolved: rows.length });
});
