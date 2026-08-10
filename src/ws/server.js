import { WebSocket, WebSocketServer } from 'ws';
import { wsArcjet } from "../arcjet.js";

// Stores WebSocket clients subscribed to each match.
// Map structure:
// matchId -> Set<WebSocket>
const matchSubscribers = new Map();

// Add a socket to a match's subscriber list.
function subscribe(matchId, socket) {
    if (!matchSubscribers.has(matchId)) {
        matchSubscribers.set(matchId, new Set());
    }

    matchSubscribers.get(matchId).add(socket);
}

// Remove a socket from a match's subscriber list.
// If no clients remain subscribed to the match, remove the match entry.
function unsubscribe(matchId, socket) {
    const subscribers = matchSubscribers.get(matchId);

    if (!subscribers) return;

    subscribers.delete(socket);

    if (subscribers.size === 0) {
        matchSubscribers.delete(matchId);
    }
}

// Remove the socket from every match it was subscribed to.
// This is called when the WebSocket connection closes.
function cleanupSubscriptions(socket) {
    for (const matchId of socket.subscriptions) {
        unsubscribe(matchId, socket);
    }
}

// Send a JSON payload to a single WebSocket client.
// Only send when the connection is currently open.
function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

// Broadcast a JSON payload to every connected WebSocket client.
function broadcastToAll(wss, payload) {
    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        client.send(JSON.stringify(payload));
    }
}

// Broadcast a JSON payload only to clients subscribed to a specific match.
function broadcastToMatch(matchId, payload) {
    const subscribers = matchSubscribers.get(matchId);

    if (!subscribers || subscribers.size === 0) return;

    // Serialize the payload only once instead of once per client.
    const message = JSON.stringify(payload);

    for (const client of subscribers) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// Handle messages received from a WebSocket client.
function handleMessage(socket, data) {
    let message;

    // Parse the incoming message as JSON.
    try {
        message = JSON.parse(data.toString());
    } catch {
        // Tell the client that the message was not valid JSON.
        sendJson(socket, {
            type: 'error',
            message: 'Invalid JSON'
        });
        return;
    }

    // Subscribe the client to updates for a specific match.
    if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
        subscribe(message.matchId, socket);
        socket.subscriptions.add(message.matchId);

        sendJson(socket, {
            type: 'subscribed',
            matchId: message.matchId
        });

        return;
    }

    // Unsubscribe the client from updates for a specific match.
    if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
        unsubscribe(message.matchId, socket);
        socket.subscriptions.delete(message.matchId);

        sendJson(socket, {
            type: 'unsubscribed',
            matchId: message.matchId
        });
    }
}

// Attach the WebSocket server to the existing HTTP server.
export function attachWebSocketServer(server) {
    // Create a WebSocket server that does not create its own HTTP server.
    // The existing HTTP server handles the upgrade request.
    const wss = new WebSocketServer({
        noServer: true,
        path: '/ws',
        maxPayload: 1024 * 1024
    });

    // Handle HTTP -> WebSocket upgrade requests.
    server.on('upgrade', async (req, socket, head) => {
        const { pathname } = new URL(
            req.url,
            `http://${req.headers.host}`
        );

        // Only allow WebSocket connections through the /ws endpoint.
        if (pathname !== '/ws') {
            return;
        }

        // Apply Arcjet protection to the WebSocket upgrade request
        // when WebSocket protection is configured.
        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);

                // Reject requests that Arcjet denies.
                if (decision.isDenied()) {
                    if (decision.reason.isRateLimit()) {
                        socket.write(
                            'HTTP/1.1 429 Too Many Requests\r\n\r\n'
                        );
                    } else {
                        socket.write(
                            'HTTP/1.1 403 Forbidden\r\n\r\n'
                        );
                    }

                    socket.destroy();
                    return;
                }
            } catch (e) {
                // If Arcjet protection itself fails, reject the upgrade
                // instead of allowing an unprotected WebSocket connection.
                console.error('WS upgrade protection error', e);

                socket.write(
                    'HTTP/1.1 500 Internal Server Error\r\n\r\n'
                );
                socket.destroy();
                return;
            }
        }

        // Complete the HTTP upgrade and create the WebSocket connection.
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    // Handle newly established WebSocket connections.
    wss.on('connection', async (socket, req) => {
        // Used by the heartbeat mechanism to detect dead connections.
        socket.isAlive = true;

        // A pong response means the client is still alive.
        socket.on('pong', () => {
            socket.isAlive = true;
        });

        // Keep track of the matches this socket is subscribed to.
        socket.subscriptions = new Set();

        // Let the client know that the WebSocket connection is ready.
        sendJson(socket, {
            type: 'welcome'
        });

        // Handle messages sent by this client.
        socket.on('message', (data) => {
            handleMessage(socket, data);
        });

        // Terminate the connection if an error occurs.
        socket.on('error', () => {
            socket.terminate();
        });

        // Remove all subscriptions when the client disconnects.
        socket.on('close', () => {
            cleanupSubscriptions(socket);
        });

        // Log WebSocket errors on the server.
        socket.on('error', console.error);
    });

    // Periodically ping all clients to detect broken connections.
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            // No pong since the previous heartbeat means the connection
            // is probably dead, so terminate it.
            if (ws.isAlive === false) {
                return ws.terminate();
            }

            // Mark the client as waiting for a pong and send a ping.
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    // Stop the heartbeat timer when the WebSocket server closes.
    wss.on('close', () => {
        clearInterval(interval);
    });

    // Broadcast a newly created match to every connected client.
    function broadcastMatchCreated(match) {
        broadcastToAll(wss, {
            type: 'match_created',
            data: match
        });
    }

    // Broadcast new commentary only to clients subscribed to the match.
    function broadcastCommentary(matchId, comment) {
        broadcastToMatch(matchId, {
            type: 'commentary',
            data: comment
        });
    }

    // Expose broadcast functions so the HTTP routes can trigger
    // WebSocket notifications after successful database operations.
    return {
        broadcastMatchCreated,
        broadcastCommentary
    };
}