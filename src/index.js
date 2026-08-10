import AgentAPI from "apminsight";
AgentAPI.config();

import express from 'express';
import http from 'http';
import { matchRouter } from "./routes/matches.js";
import { attachWebSocketServer } from "./ws/server.js";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello from Express server!');
});

// app.use(securityMiddleware());

app.use('/matches', matchRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate } = attachWebSocketServer(server);

// Attach the broadcast functions to the app locals so they can be accessed in the routes.
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdate = broadcastScoreUpdate;

// What is app.locals? It's a property of the Express application instance that allows you to store variables that are accessible throughout the application. In this case, we're storing the broadcast functions so they can be accessed in the routes.
// In simple terms, app.locals is like a global storage for your Express app where you can keep data that you want to share across different parts of your application, such as routes and middleware.

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = address.port;
  const actualHost = address.address;

  // Format IPv6 addresses with brackets
  const formattedHost = actualHost.includes(':') ? `[${actualHost}]` : actualHost;
  const fallbackHost = actualHost === '::' || actualHost === '0.0.0.0' ? 'localhost' : formattedHost;

  // Use PUBLIC_URL if configured, otherwise derive from server address
  const publicUrl = process.env.PUBLIC_URL;
  const httpUrl = publicUrl || `http://${fallbackHost}:${actualPort}`;
  const wsUrl = publicUrl ? `${publicUrl.replace('http://', 'ws://').replace('https://', 'wss://')}/ws` : `ws://${fallbackHost}:${actualPort}/ws`;

  console.log(`Server is running on http://${formattedHost}:${actualPort}`);
  console.log(`WebSocket Server is running on ${wsUrl}`);
});