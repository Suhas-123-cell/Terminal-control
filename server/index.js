const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const screen = require('./screen');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // no .env file — fall back to whatever is already exported
}

const PORT = process.env.PORT || 3000;
const TERM_TOKEN = process.env.TERM_TOKEN;
const SCROLLBACK_CAP = 200 * 1024; // ~200KB per session
const MAX_BUFFERED_SCREEN_BYTES = 2 * 1024 * 1024; // skip frames for slow clients
// Flow control: pause a shell's output while any attached client has more
// than this many characters it hasn't acked as rendered. Without it, `yes` or
// a big `cat` floods the phone with a backlog it takes ages to chew through.
const MAX_UNACKED_CHARS = 256 * 1024;

if (!TERM_TOKEN) {
  console.error('TERM_TOKEN is not set. Copy .env.example to .env and set a token, or export TERM_TOKEN.');
  process.exit(1);
}

const isWindows = os.platform() === 'win32';
const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash');
// Login shell, so ~/.zprofile / ~/.bash_profile run (Homebrew PATH etc.).
const shellArgs = isWindows ? [] : ['-l'];
// The shell must not inherit the server's own secret.
const shellEnv = { ...process.env };
delete shellEnv.TERM_TOKEN;
if (!shellEnv.LANG) shellEnv.LANG = 'en_US.UTF-8';

// sessionId -> { pty, title, scrollback (string), cols, rows, alive }
const sessions = new Map();
let terminalCount = 0;

// Clients currently watching the screen stream, and the shared capture loop.
const screenClients = new Set();
let screenTimer = null;
let lastScreenError = null;

function sendToScreenClients(message) {
  const payload = JSON.stringify(message);
  for (const client of screenClients) {
    if (client.readyState === client.OPEN && client.bufferedAmount < MAX_BUFFERED_SCREEN_BYTES) {
      client.send(payload);
    }
  }
}

function reportScreenError(message) {
  if (message === lastScreenError) return;
  lastScreenError = message;
  console.error(`screen: ${message}`);
  sendToScreenClients({ type: 'screen-error', message });
}

screen.setInputErrorHandler((err) => {
  reportScreenError(`input injection failed (is cliclick installed?): ${err.message}`);
});

// Self-scheduling rather than setInterval: the next capture only starts once
// the previous one finished, so slow captures never overlap.
function captureLoop() {
  screen.captureFrame((err, buf) => {
    if (screenClients.size === 0) {
      screenTimer = null;
      return;
    }
    if (err) {
      reportScreenError('screen capture failed — grant Screen Recording permission to the app running the server, then restart it');
    } else {
      lastScreenError = null;
      const dims = screen.jpegDimensions(buf);
      sendToScreenClients({
        type: 'screen-frame',
        data: buf.toString('base64'),
        width: dims ? dims.width : undefined,
        height: dims ? dims.height : undefined,
      });
    }
    screenTimer = setTimeout(captureLoop, screen.FRAME_INTERVAL_MS);
  });
}

function startScreenStreamIfNeeded() {
  if (screenTimer) return;
  lastScreenError = null;
  screen.refreshScreenInfo();
  screenTimer = setTimeout(captureLoop, 0);
}

function appendScrollback(session, data) {
  session.scrollback += data;
  if (session.scrollback.length > SCROLLBACK_CAP) {
    // Cut at a line boundary so the replay doesn't start mid escape sequence.
    const cut = session.scrollback.length - SCROLLBACK_CAP;
    const nl = session.scrollback.indexOf('\n', cut);
    session.scrollback = session.scrollback.slice(nl === -1 ? cut : nl + 1);
  }
}

function attachedClients(sessionId) {
  return Array.from(wss.clients).filter(
    (client) => client.readyState === client.OPEN && client.attachedSessions?.has(sessionId)
  );
}

function broadcastToAttached(sessionId, message) {
  const payload = JSON.stringify(message);
  for (const client of attachedClients(sessionId)) client.send(payload);
}

// Clients opt in to flow control by sending their first "ack", so a client
// that never acks can't stall a shell.
function trackSent(client, sessionId, chars) {
  if (client.unacked) client.unacked.set(sessionId, (client.unacked.get(sessionId) || 0) + chars);
}

function updateFlow(session) {
  if (!session.alive) return;
  const backedUp = attachedClients(session.id).some(
    (client) => client.unacked && (client.unacked.get(session.id) || 0) > MAX_UNACKED_CHARS
  );
  if (backedUp && !session.paused) {
    session.paused = true;
    session.pty.pause();
  } else if (!backedUp && session.paused) {
    session.paused = false;
    session.pty.resume();
  }
}

function validDimension(n, fallback) {
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback;
}

function createSession(cols, rows) {
  // Random ids: a server restart must never hand a reconnecting phone a new
  // session that reuses the id of one it still has a tab for.
  const id = crypto.randomUUID();
  const title = `term-${++terminalCount}`;
  cols = validDimension(cols, 80);
  rows = validDimension(rows, 24);
  const term = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: shellEnv,
  });

  const session = { id, pty: term, title, scrollback: '', cols, rows, alive: true, paused: false };
  sessions.set(id, session);

  term.onData((data) => {
    appendScrollback(session, data);
    broadcastToAttached(id, { type: 'output', sessionId: id, data });
    for (const client of attachedClients(id)) trackSent(client, id, data.length);
    updateFlow(session);
  });

  term.onExit(() => {
    session.alive = false;
    broadcastToAttached(id, { type: 'exit', sessionId: id });
    sessions.delete(id);
    for (const client of wss.clients) {
      client.attachedSessions?.delete(id);
      client.unacked?.delete(id);
    }
  });

  return session;
}

function tokenMatches(token) {
  if (typeof token !== 'string') return false;
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(TERM_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('remote-terminal-server ok\n');
});

const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const url = new URL(info.req.url, 'http://localhost');
    callback(tokenMatches(url.searchParams.get('token')), 401, 'invalid token');
  },
});

function handleMessage(ws, msg) {
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
        trackSent(ws, session.id, session.scrollback.length);
      }
      break;
    }
    case 'ack': {
      const session = sessions.get(msg.sessionId);
      if (!session || !Number.isFinite(msg.chars)) break;
      if (!ws.unacked) ws.unacked = new Map();
      ws.unacked.set(session.id, Math.max(0, (ws.unacked.get(session.id) || 0) - msg.chars));
      updateFlow(session);
      break;
    }
    case 'input': {
      const session = sessions.get(msg.sessionId);
      if (session && session.alive && typeof msg.data === 'string') {
        session.pty.write(msg.data);
      }
      break;
    }
    case 'resize': {
      const session = sessions.get(msg.sessionId);
      const cols = validDimension(msg.cols, null);
      const rows = validDimension(msg.rows, null);
      if (session && session.alive && cols && rows) {
        session.cols = cols;
        session.rows = rows;
        session.pty.resize(cols, rows);
      }
      break;
    }
    case 'close': {
      const session = sessions.get(msg.sessionId);
      if (session) session.pty.kill(); // onExit does the cleanup + broadcast
      break;
    }
    case 'screen-start': {
      screenClients.add(ws);
      startScreenStreamIfNeeded();
      break;
    }
    case 'screen-stop': {
      screenClients.delete(ws);
      break;
    }
    case 'screen-input': {
      screen.performInput(msg);
      break;
    }
    default:
      break;
  }
}

wss.on('connection', (ws) => {
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
    if (!msg || typeof msg !== 'object') return;
    // One bad message must never take down every other running shell.
    try {
      handleMessage(ws, msg);
    } catch (err) {
      console.error(`error handling "${msg.type}" message:`, err);
    }
  });

  ws.on('close', () => {
    // Sessions are NOT killed on disconnect — they keep running until
    // an explicit "close" message or the shell process exits on its own.
    screenClients.delete(ws);
    // A gone client must not keep any shell paused.
    for (const session of sessions.values()) updateFlow(session);
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
