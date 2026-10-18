import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SpecialKeysToolbar, applyCtrl } from '../components/SpecialKeysToolbar';
import { TerminalWebView, TerminalWebViewHandle } from '../components/TerminalWebView';
import { ScreenControlScreen } from './ScreenControlScreen';
import { ConnectionStatus, TerminalClient } from '../lib/wsClient';

type Props = {
  client: TerminalClient;
  onDisconnect: () => void;
};

type SessionMeta = {
  id: string;
  title: string;
};

export function TerminalScreen({ client, onDisconnect }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connected');
  const [ctrlSticky, setCtrlSticky] = useState(false);
  const [mode, setMode] = useState<'terminal' | 'screen'>('terminal');

  const webviewRefs = useRef(new Map<string, TerminalWebViewHandle>());
  // Output for a session whose WebView hasn't mounted yet (e.g. a shell's
  // first prompt arriving right behind its "created" message).
  const pendingOutput = useRef(new Map<string, string>());
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const ctrlStickyRef = useRef(false);
  ctrlStickyRef.current = ctrlSticky;
  const sessionsRef = useRef<SessionMeta[]>([]);
  sessionsRef.current = sessions;

  useEffect(() => {
    if (!activeId || mode !== 'terminal') return;
    const timer = setTimeout(() => {
      webviewRefs.current.get(activeId)?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [activeId, mode]);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    webviewRefs.current.delete(sessionId);
    pendingOutput.current.delete(sessionId);
    setActiveId((prev) => {
      if (prev !== sessionId) return prev;
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
      return remaining.length > 0 ? remaining[0].id : null;
    });
  }, []);

  useEffect(() => {
    const unsubMessage = client.onMessage((msg) => {
      if (msg.type === 'created') {
        setSessions((prev) =>
          prev.some((s) => s.id === msg.sessionId)
            ? prev
            : [...prev, { id: msg.sessionId, title: msg.title }]
        );
        // Only the client that asked for it gets "created": switch to it.
        setActiveId(msg.sessionId);
      } else if (msg.type === 'sessions') {
        // The server is the source of truth (it may have restarted, or another
        // device may have opened/closed terminals). This client starts out
        // attached to nothing, so attach to everything, replaying scrollback
        // into a cleared terminal so nothing already on screen is duplicated.
        const alive = msg.sessions.filter((s) => s.alive);
        for (const s of alive) {
          webviewRefs.current.get(s.id)?.reset();
          const dropped = pendingOutput.current.get(s.id);
          if (dropped) client.ack(s.id, dropped.length);
          pendingOutput.current.delete(s.id);
          client.attach(s.id);
        }
        setSessions(alive.map((s) => ({ id: s.id, title: s.title })));
        setActiveId((prev) =>
          prev && alive.some((s) => s.id === prev) ? prev : alive[0]?.id ?? null
        );
        if (alive.length === 0) client.create();
      } else if (msg.type === 'output') {
        const handle = webviewRefs.current.get(msg.sessionId);
        if (handle) {
          handle.write(msg.data);
        } else {
          const pending = pendingOutput.current;
          pending.set(msg.sessionId, (pending.get(msg.sessionId) ?? '') + msg.data);
        }
      } else if (msg.type === 'exit') {
        removeSession(msg.sessionId);
      }
    });

    const unsubStatus = client.onStatus((s) => {
      setStatus(s);
      // A fresh socket is attached to nothing: resync on every reconnect.
      if (s === 'connected') client.list();
    });

    // Ask the server what's already running (covers app relaunch); the
    // "sessions" reply creates a first terminal if there's nothing yet.
    client.list();

    return () => {
      unsubMessage();
      unsubStatus();
    };
  }, [client, removeSession]);

  const registerWebView = (sessionId: string, handle: TerminalWebViewHandle | null) => {
    if (!handle) {
      webviewRefs.current.delete(sessionId);
      return;
    }
    webviewRefs.current.set(sessionId, handle);
    const pending = pendingOutput.current.get(sessionId);
    if (pending) {
      pendingOutput.current.delete(sessionId);
      handle.write(pending);
    }
  };

  const handleInput = useCallback(
    (sessionId: string, data: string) => {
      if (ctrlStickyRef.current) {
        setCtrlSticky(false);
        client.input(sessionId, applyCtrl(data));
        return;
      }
      client.input(sessionId, data);
    },
    [client]
  );

  const closeTerminal = (sessionId: string) => {
    client.close(sessionId);
    removeSession(sessionId);
  };

  const sendToActive = (bytes: string) => {
    if (activeIdRef.current) {
      client.input(activeIdRef.current, bytes);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // 'padding' on Android too: with edge-to-edge the window no longer
      // resizes for the keyboard, and KAV only pads by the actual overlap.
      behavior="padding"
    >
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
          {sessions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                setActiveId(s.id);
                setMode('terminal');
              }}
              style={[styles.tab, s.id === activeId && mode === 'terminal' && styles.tabActive]}
            >
              <Text style={styles.tabText}>{s.title}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => closeTerminal(s.id)}
                style={styles.tabClose}
                accessibilityLabel={`Close ${s.title}`}
              >
                <Text style={styles.tabCloseText}>×</Text>
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => setMode((m) => (m === 'terminal' ? 'screen' : 'terminal'))}
          style={[styles.headerButton, mode === 'screen' && styles.tabActive]}
          accessibilityLabel={mode === 'terminal' ? 'Show screen control' : 'Show terminals'}
        >
          <Text style={styles.modeButtonText}>{mode === 'terminal' ? '🖥️' : '⌨️'}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            client.create();
            setMode('terminal');
          }}
          style={styles.headerButton}
          accessibilityLabel="New terminal"
        >
          <Text style={styles.headerButtonText}>+</Text>
        </Pressable>
        <Pressable onPress={onDisconnect} style={styles.headerButton} accessibilityLabel="Disconnect">
          <Text style={styles.disconnectText}>⏏</Text>
        </Pressable>
      </View>

      {status !== 'connected' && (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>
            {status === 'error' ? 'Connection error — retrying…' : 'Reconnecting…'}
          </Text>
        </View>
      )}

      {/* Terminals stay mounted while the screen view is up, so their content
          and live output aren't lost; they're just hidden. */}
      <View style={[styles.terminalArea, mode !== 'terminal' && styles.hidden]}>
        {sessions.map((s) => (
          <TerminalWebView
            key={s.id}
            ref={(handle) => registerWebView(s.id, handle)}
            visible={s.id === activeId}
            onInput={(data) => handleInput(s.id, data)}
            onResize={(cols, rows) => client.resize(s.id, cols, rows)}
            onWritten={(chars) => client.ack(s.id, chars)}
            onReload={() => client.attach(s.id)}
          />
        ))}
        {sessions.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No terminals open. Tap + to start one.</Text>
          </View>
        )}
      </View>
      {mode === 'terminal' ? (
        <SpecialKeysToolbar
          onSend={sendToActive}
          ctrlSticky={ctrlSticky}
          onToggleCtrl={() => setCtrlSticky((v) => !v)}
        />
      ) : (
        <ScreenControlScreen client={client} />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0e14',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2f3a',
    paddingVertical: 4,
    paddingRight: 4,
  },
  tabScroll: {
    flex: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22293a',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 4,
  },
  tabActive: {
    backgroundColor: '#3b82f6',
  },
  tabText: {
    color: '#e6e6e6',
    fontSize: 13,
    fontWeight: '600',
  },
  tabClose: {
    marginLeft: 8,
  },
  tabCloseText: {
    color: '#c6cad3',
    fontSize: 15,
    fontWeight: '700',
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#22293a',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  modeButtonText: {
    fontSize: 16,
  },
  headerButtonText: {
    color: '#e6e6e6',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  disconnectText: {
    color: '#e6e6e6',
    fontSize: 16,
  },
  statusBanner: {
    backgroundColor: '#5b3d0a',
    paddingVertical: 4,
    alignItems: 'center',
  },
  statusText: {
    color: '#ffd580',
    fontSize: 12,
  },
  terminalArea: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#5b6270',
  },
});
