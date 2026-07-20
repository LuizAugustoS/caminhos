// Rastreamento de erros. No-op por padrão; com SENTRY_DSN configurado envia
// as exceções para o Sentry (dependência opcional: npm i @sentry/node).
// Mantém o servidor funcional sem nenhum serviço externo.
let sentry = null;
export const errorTrackingEnabled = Boolean(process.env.SENTRY_DSN);

if (errorTrackingEnabled) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
    });
    sentry = Sentry;
    console.log('[errors] Sentry ativo');
  } catch {
    console.warn('[errors] SENTRY_DSN configurado, mas @sentry/node não está instalado (npm i @sentry/node)');
  }
}

// Registra uma exceção (além do log local). Nunca lança.
export function captureError(err, context) {
  try {
    sentry?.captureException(err, context ? { extra: context } : undefined);
  } catch { /* rastreamento nunca deve quebrar o fluxo */ }
}
