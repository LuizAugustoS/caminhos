// E-mails transacionais. Com SMTP_HOST configurado envia de verdade
// (nodemailer); sem configuração, registra no console — útil em
// desenvolvimento e mantém a plataforma funcional sem serviço de e-mail.
import nodemailer from 'nodemailer';

const FROM = process.env.MAIL_FROM || 'Caminhos do Caparaó <no-reply@caminhosdocaparao.com.br>';

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  : null;

// Nunca derruba a requisição que disparou o e-mail: falha vira warning.
export async function sendMail({ to, subject, text }) {
  if (!to) return false;
  if (!transport) {
    console.log(`[mail] (SMTP não configurado) para: ${to} · assunto: ${subject}\n${text}`);
    return false;
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, text });
    return true;
  } catch (err) {
    console.warn(`sendMail falhou (${to}):`, err.message);
    return false;
  }
}
