// Tempo real via Server-Sent Events (sem dependências extras).
// Cada usuário logado mantém uma conexão; o servidor empurra eventos
// (ex.: nova mensagem de chat) na hora, e o EventSource reconecta sozinho.
import { Router } from 'express';

export const events = Router();

const clients = new Map(); // userId → Set<res>

events.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: não bufferizar o stream
  });
  res.write('retry: 3000\n\n');

  const userId = Number(req.user.id);
  const set = clients.get(userId) || new Set();
  set.add(res);
  clients.set(userId, set);

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (!set.size) clients.delete(userId);
  });
});

// Empurra um evento para todas as conexões abertas de um usuário
export function notify(userId, event, data) {
  const set = clients.get(Number(userId));
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* conexão morta: o close limpa */ }
  }
}
