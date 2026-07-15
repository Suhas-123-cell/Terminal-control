import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { ConnectionConfig, loadConnectionConfig, saveConnectionConfig } from '../lib/storage';

type Props = {
  onConnect: (config: ConnectionConfig) => Promise<void>;
};

export function ConnectionScreen({ onConnect }: Props) {
  const [host, setHost] = useState('10.0.2.2');
  const [port, setPort] = useState('3000');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const userEditedRef = useRef(false);

  useEffect(() => {
    loadConnectionConfig().then((saved) => {
      // Don't clobber input the user already started typing while this
      // (async, sometimes slow) SecureStore read was still in flight.
      if (saved && !userEditedRef.current) {
        setHost(saved.host);
        setPort(saved.port);
        setToken(saved.token);
      }
    });
  }, []);

  const markEdited = () => {
    userEditedRef.current = true;
  };

  const handleConnect = async () => {
    setStatus('connecting');
    setError(null);
    const config = { host: host.trim(), port: port.trim(), token };
    try {
      await onConnect(config);
      await saveConnectionConfig(config);
    } catch (e) {
      setStatus('error');
      setError('Could not connect. Check host, port, token, and that the server is running.');
      return;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Remote Terminal</Text>
      <Text style={styles.label}>Host</Text>
      <TextInput
        testID="host-input"
        style={styles.input}
        value={host}
        onChangeText={(v) => { markEdited(); setHost(v); }}
        onFocus={markEdited}
        placeholder="10.0.2.2"
        placeholderTextColor="#5b6270"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Port</Text>
      <TextInput
        testID="port-input"
        style={styles.input}
        value={port}
        onChangeText={(v) => { markEdited(); setPort(v); }}
        onFocus={markEdited}
        placeholder="3000"
        placeholderTextColor="#5b6270"
        keyboardType="number-pad"
      />
      <Text style={styles.label}>Token</Text>
      <TextInput
        testID="token-input"
        style={styles.input}
        value={token}
        onChangeText={(v) => { markEdited(); setToken(v); }}
        onFocus={markEdited}
        placeholder="TERM_TOKEN"
        placeholderTextColor="#5b6270"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Pressable
        testID="connect-button"
        style={styles.button}
        onPress={handleConnect}
        disabled={status === 'connecting'}
      >
        {status === 'connecting' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Connect</Text>
        )}
      </Pressable>

      {status === 'error' && error && (
        <Text testID="connect-error" style={styles.error}>
          {error}
        </Text>
      )}

      <Text style={styles.hint}>
        Android emulator: use 10.0.2.2{'\n'}iOS simulator: use localhost{'\n'}
        Real device: your laptop's Tailscale IP
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0e14',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    color: '#e6e6e6',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
  },
  label: {
    color: '#8b93a5',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#161b22',
    color: '#e6e6e6',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2f3a',
  },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#f87171',
    marginTop: 14,
    textAlign: 'center',
  },
  hint: {
    color: '#5b6270',
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
    lineHeight: 18,
  },
});
