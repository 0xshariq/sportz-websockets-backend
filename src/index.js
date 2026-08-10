import AgentAPI from "apminsight";
AgentAPI.config();

import express from 'express';
import http from 'http';
import { matchRouter } from "./routes/matches.js";
import { attachWebSocketServer } from "./ws/server.js";
import { securityMiddleware } from "./arcjet.js";
import { commentaryRouter } from "./routes/commentary.js";

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
app.use('/matches/:id/commentary', commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate } = attachWebSocketServer(server);

// Attach the broadcast functions to the app locals so they can be accessed in the routes.
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdate = broadcastScoreUpdate;

// What is app.locals? It's a property of the Express application instance that allows you to store variables that are accessible throughout the application. In this case, we're storing the broadcast functions so they can be accessed in the routes.
// In simple terms, app.locals is like a global storage for your Express app where you can keep data that you want to share across different parts of your application, such as routes and middleware.

server.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

  console.log(`Server is running on ${baseUrl}`);
  console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});