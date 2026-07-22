-- Direito de resposta: o produtor pode responder publicamente a uma avaliação.
ALTER TABLE reviews ADD COLUMN reply TEXT;
ALTER TABLE reviews ADD COLUMN reply_at TIMESTAMPTZ;
