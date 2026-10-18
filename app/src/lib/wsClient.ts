export type ServerMessage =
  | { type: 'created'; sessionId: string; title: string }
  | { type: 'sessions'; sessions: { id: string; title: string; alive: boolean }[] }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'exit'; sessionId: string }
  | { type: 'screen-frame'; data: string; width?: number; height?: number }
  | { type: 'screen-error'; message: string };

export type ScreenInputAction =
  | { action: 'move'; x: number; y: number }
  | { action: 'click'; x: number; y: number }
  | { action: 'rightclick'; x: number; y: number }
  | { action: 'doubleclick'; x: number; y: number }
  | { action: 'drag'; x: number; y: number; toX: number; toY: number }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string };

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

type Listener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

const RECONNECT_DELAY_MS = 2000;
// An unreachable host (e.g. Tailscale off) can otherwise hang for a minute+.
const CONNECT_TIMEOUT_MS = 10000;

export class TerminalClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: ConnectionStatus = 'idle';
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: string, port: string, token: string) {
    // Bare IPv6 addresses (e.g. Tailscale's fd7a:…) need brackets in a URL.
    const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    this.url = `ws://${urlHost}:${port}?token=${encodeURIComponent(token)}`;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): Promise<void> {
    this.shouldReconnect = true;
    return new Promise((resolve, reject) => {
      this.setStatus(this.status === 'idle' ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(this.url);
      this.ws = ws;

      let closed = false;
      const handleClose = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        reject(new Error('closed'));
        if (this.ws !== ws) return; // replaced by a newer socket, or disconnect()ed
        if (this.shouldReconnect) {
          this.setStatus('reconnecting');
          // Retries report progress through onStatus; their rejections are expected.
          this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), RECONNECT_DELAY_MS);
        } else {
          this.setStatus('idle');
        }
      };
      // Don't rely on close() of a still-connecting socket emitting onclose.
      const timeout = setTimeout(() => {
        handleClose();
        ws.close();
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (closed) {
          ws.close(); // opened after we already gave up on it
          return;
        }
        clearTimeout(timeout);
        this.setStatus('connected');
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          this.listeners.forEach((cb) => cb(msg));
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (this.ws === ws) this.setStatus('error');
      };

      ws.onclose = handleClose;
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus('idle');
  }

  private send(payload: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  create() {
    this.send({ type: 'create' });
  }

  list() {
    this.send({ type: 'list' });
  }

  attach(sessionId: string) {
    this.send({ type: 'attach', sessionId });
  }

  input(sessionId: string, data: string) {
    this.send({ type: 'input', sessionId, data });
  }

  ack(sessionId: string, chars: number) {
    this.send({ type: 'ack', sessionId, chars });
  }

  resize(sessionId: string, cols: number, rows: number) {
    this.send({ type: 'resize', sessionId, cols, rows });
  }

  close(sessionId: string) {
    this.send({ type: 'close', sessionId });
  }

  screenStart() {
    this.send({ type: 'screen-start' });
  }

  screenStop() {
    this.send({ type: 'screen-stop' });
  }

  screenInput(action: ScreenInputAction) {
    this.send({ type: 'screen-input', ...action });
  }
}
