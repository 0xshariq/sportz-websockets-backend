import AgentAPI from 'apminsight';
AgentAPI.config();

import express from 'express';
import http from 'http';
import { matchRouter } from './routes/matches.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { commentaryRouter } from './routes/commentary.js';
import { config, publicBaseUrl } from './config.js';
import { pool } from './db/db.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(securityMiddleware());

app.get('/', (req, res) => res.json({ name: 'sportz-live-sports-dashboard', status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), environment: config.NODE_ENV }));
app.get('/ready', async (req, res, next) => {
  try { await pool.query('select 1'); res.json({ status: 'ready' }); } catch (error) { next(error); }
});

app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);

const broadcasts = attachWebSocketServer(server);
Object.assign(app.locals, broadcasts);
app.use(notFoundHandler);
app.use(errorHandler);

server.listen(config.PORT, config.HOST, () => {
  console.log(`Server is running on ${publicBaseUrl}`);
  console.log(`WebSocket server is running on ${publicBaseUrl.replace(/^http/, 'ws')}/ws`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully`);
  await broadcasts.closeWebSocketServer();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
