const os = require('os');
const http = require('http');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const screen = require('./screen');

const PORT = process.env.PORT || 3000;
const TERM_TOKEN = process.env.TERM_TOKEN;
const SCROLLBACK_CAP = 200 * 1024; // ~200KB per session

if (!TERM_TOKEN) {
  console.error('TERM_TOKEN is not set. Copy .env.example to .env and set a token, or export TERM_TOKEN.');
  process.exit(1);
}

const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');

// sessionId -> { pty, title, scrollback (string), cols, rows, alive }
const sessions = new Map();
let nextId = 1;

// Clients currently watching the screen stream, and the shared capture loop.
const screenClients = new Set();
let screenInterval = null;

function startScreenStreamIfNeeded() {
  if (screenInterval) return;
  screenInterval = setInterval(() => {
    screen.captureFrame((err, buf) => {
      if (err || screenClients.size === 0) return;
      const dims = screen.jpegDimensions(buf);
      const payload = JSON.stringify({
        type: 'screen-frame',
        data: buf.toString('base64'),
        width: dims ? dims.width : undefined,
        height: dims ? dims.height : undefined,
      });
      for (const client of screenClients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    });
  }, screen.FRAME_INTERVAL_MS);
}

function stopScreenStreamIfIdle() {
  if (screenClients.size === 0 && screenInterval) {
    clearInterval(screenInterval);
    screenInterval = null;
  }
}

function shortTitle() {
  return `term-${nextId}`;
}

function appendScrollback(session, data) {
  session.scrollback += data;
  if (session.scrollback.length > SCROLLBACK_CAP) {
    session.scrollback = session.scrollback.slice(session.scrollback.length - SCROLLBACK_CAP);
  }
}

function broadcastToAttached(sessionId, message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN && client.attachedSessions && client.attachedSessions.has(sessionId)) {
      client.send(payload);
    }
  }
}

function createSession(cols = 80, rows = 24) {
  const id = String(nextId++);
  const title = shortTitle();
  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: process.env,
  });

  const session = { id, pty: term, title, scrollback: '', cols, rows, alive: true };
  sessions.set(id, session);

  term.onData((data) => {
    appendScrollback(session, data);
    broadcastToAttached(id, { type: 'output', sessionId: id, data });
  });

  term.onExit(() => {
    session.alive = false;
    broadcastToAttached(id, { type: 'exit', sessionId: id });
    sessions.delete(id);
  });

  return session;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('remote-terminal-server ok\n');
});

const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const url = new URL(info.req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    callback(token === TERM_TOKEN, 401, 'invalid token');
  },
});

wss.on('connection', (ws, req) => {
  ws.attachedSessions = new Set();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        const session = createSession(msg.cols, msg.rows);
        ws.attachedSessions.add(session.id);
        ws.send(JSON.stringify({ type: 'created', sessionId: session.id, title: session.title }));
        break;
      }
      case 'list': {
        const list = Array.from(sessions.values()).map((s) => ({
          id: s.id, title: s.title, alive: s.alive,
        }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: list }));
        break;
      }
      case 'attach': {
        const session = sessions.get(msg.sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'exit', sessionId: msg.sessionId }));
          break;
        }
        ws.attachedSessions.add(session.id);
        if (session.scrollback) {
          ws.send(JSON.stringify({ type: 'output', sessionId: session.id, data: session.scrollback }));
        }
        break;
      }
      case 'input': {
        const session = sessions.get(msg.sessionId);
        if (session && session.alive) {
          session.pty.write(msg.data);
        }
        break;
      }
      case 'resize': {
        const session = sessions.get(msg.sessionId);
        if (session && session.alive && msg.cols > 0 && msg.rows > 0) {
          session.cols = msg.cols;
          session.rows = msg.rows;
          session.pty.resize(msg.cols, msg.rows);
        }
        break;
      }
      case 'close': {
        const session = sessions.get(msg.sessionId);
        if (session) {
          session.pty.kill();
          sessions.delete(session.id);
        }
        break;
      }
      case 'screen-start': {
        screenClients.add(ws);
        startScreenStreamIfNeeded();
        break;
      }
      case 'screen-stop': {
        screenClients.delete(ws);
        stopScreenStreamIfIdle();
        break;
      }
      case 'screen-input': {
        screen.performInput(msg);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    // Sessions are NOT killed on disconnect — they keep running until
    // an explicit "close" message or the shell process exits on its own.
    screenClients.delete(ws);
    stopScreenStreamIfIdle();
  });
});

// Drop dead sockets so attachedSessions bookkeeping doesn't leak.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`remote-terminal-server listening on :${PORT} (shell: ${shell})`);
});
