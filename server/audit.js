// Registro de auditoria das ações do admin — nunca derruba a rota.
import { query } from './db.js';

export function audit(req, action, target) {
  query(
    'INSERT INTO audit_log (admin_id, admin_name, action, target) VALUES ($1, $2, $3, $4)',
    [req.user?.id ?? null, req.user?.name || 'sistema', action, target]
  ).catch(err => console.warn('audit falhou:', err.message));
}
