-- Notificações do admin gerenciáveis: marcar como lida e excluir.
BEGIN;

ALTER TABLE alerts ADD COLUMN read_at TIMESTAMPTZ;

COMMIT;
