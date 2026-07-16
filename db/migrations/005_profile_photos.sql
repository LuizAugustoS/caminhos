-- Fotos de perfil enviadas pelos usuários:
--  - users.avatar_path: avatar do turista/produtor/admin (/uploads/<arquivo>)
--  - establishments.photo_path: foto do estabelecimento na vitrine
BEGIN;

ALTER TABLE users ADD COLUMN avatar_path TEXT;
ALTER TABLE establishments ADD COLUMN photo_path TEXT;

COMMIT;
