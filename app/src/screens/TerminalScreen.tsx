import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SpecialKeysToolbar, ctrlCode } from '../components/SpecialKeysToolbar';
import { TerminalWebView, TerminalWebViewHandle } from '../components/TerminalWebView';
import { saveSessionList, SessionMeta } from '../lib/storage';
import { ConnectionStatus, TerminalClient } from '../lib/wsClient';

type Props = {
  client: TerminalClient;
};

export function TerminalScreen({ client }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connected');
  const [ctrlSticky, setCtrlSticky] = useState(false);

  const webviewRefs = useRef(new Map<string, TerminalWebViewHandle>());
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const ctrlStickyRef = useRef(false);
  ctrlStickyRef.current = ctrlSticky;
  const sessionsRef = useRef<SessionMeta[]>([]);
  sessionsRef.current = sessions;

  useEffect(() => {
    saveSessionList(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!activeId) return;
    const timer = setTimeout(() => {
      webviewRefs.current.get(activeId)?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [activeId]);

  useEffect(() => {
    const unsubMessage = client.onMessage((msg) => {
      if (msg.type === 'created') {
        setSessions((prev) =>
          prev.some((s) => s.id === msg.sessionId)
            ? prev
            : [...prev, { id: msg.sessionId, title: msg.title }]
        );
        setActiveId((prev) => prev ?? msg.sessionId);
        // The WebView ref may not be mounted yet when the shell's first
        // prompt output arrives, silently dropping it. Re-attach shortly
        // after so the server replays scrollback once the ref is ready.
        setTimeout(() => client.attach(msg.sessionId), 150);
      } else if (msg.type === 'sessions') {
        const alive = msg.sessions.filter((s) => s.alive);
        if (alive.length > 0) {
          setSessions(alive.map((s) => ({ id: s.id, title: s.title })));
          setActiveId((prev) => prev ?? alive[0].id);
          alive.forEach((s) => client.attach(s.id));
        }
      } else if (msg.type === 'output') {
        webviewRefs.current.get(msg.sessionId)?.write(msg.data);
      } else if (msg.type === 'exit') {
        setSessions((prev) => prev.filter((s) => s.id !== msg.sessionId));
        webviewRefs.current.delete(msg.sessionId);
        setActiveId((prev) => {
          if (prev !== msg.sessionId) return prev;
          const remaining = sessionsRef.current.filter((s) => s.id !== msg.sessionId);
          return remaining.length > 0 ? remaining[0].id : null;
        });
      }
    });

    const unsubStatus = client.onStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        client.list();
      }
    });

    // Initial load: ask the server what's already running (covers app relaunch
    // and reconnects), and create a first terminal if there's nothing yet.
    client.list();
    const bootTimer = setTimeout(() => {
      if (sessionsRef.current.length === 0) {
        client.create();
      }
    }, 500);

    return () => {
      unsubMessage();
      unsubStatus();
      clearTimeout(bootTimer);
    };
  }, [client]);

  const handleInput = useCallback(
    (sessionId: string, data: string) => {
      if (ctrlStickyRef.current && data.length === 1 && /[a-zA-Z]/.test(data)) {
        client.input(sessionId, ctrlCode(data));
        setCtrlSticky(false);
        return;
      }
      client.input(sessionId, data);
    },
    [client]
  );

  const handleResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      client.resize(sessionId, cols, rows);
    },
    [client]
  );

  const addTerminal = () => client.create();

  const closeTerminal = (sessionId: string) => {
    client.close(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    webviewRefs.current.delete(sessionId);
    setActiveId((prev) => {
      if (prev !== sessionId) return prev;
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
      return remaining.length > 0 ? remaining[0].id : null;
    });
  };

  const sendToActive = (bytes: string) => {
    if (activeIdRef.current) {
      client.input(activeIdRef.current, bytes);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
          {sessions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setActiveId(s.id)}
              style={[styles.tab, s.id === activeId && styles.tabActive]}
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
        <Pressable onPress={addTerminal} style={styles.addButton} accessibilityLabel="New terminal">
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {status !== 'connected' && (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>
            {status === 'reconnecting' ? 'Reconnecting…' : status === 'error' ? 'Connection error' : 'Connecting…'}
          </Text>
        </View>
      )}

      <View style={styles.terminalArea}>
        {sessions.map((s) => (
          <TerminalWebView
            key={s.id}
            ref={(handle) => {
              if (handle) webviewRefs.current.set(s.id, handle);
              else webviewRefs.current.delete(s.id);
            }}
            visible={s.id === activeId}
            onInput={(data) => handleInput(s.id, data)}
            onResize={(cols, rows) => handleResize(s.id, cols, rows)}
          />
        ))}
        {sessions.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No terminals open. Tap + to start one.</Text>
          </View>
        )}
      </View>

      <SpecialKeysToolbar
        onSend={sendToActive}
        ctrlSticky={ctrlSticky}
        onToggleCtrl={() => setCtrlSticky((v) => !v)}
      />
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
    paddingTop: Platform.OS === 'ios' ? 44 : 8,
    paddingBottom: 4,
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
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#22293a',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  addButtonText: {
    color: '#e6e6e6',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
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
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#5b6270',
  },
});
