-- Controle de estoque/vagas opcional por anúncio.
-- stock NULL = sem controle (comportamento atual); >= 0 = unidades/vagas
-- restantes. Ao concluir uma venda, decrementa pela quantidade reservada;
-- em 0, o anúncio some do Explorar e não aceita novas reservas.
BEGIN;

ALTER TABLE listings ADD COLUMN stock INTEGER CHECK (stock IS NULL OR stock >= 0);

COMMIT;
