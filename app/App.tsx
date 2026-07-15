import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';
import { ConnectionConfig } from './src/lib/storage';
import { TerminalClient } from './src/lib/wsClient';

export default function App() {
  const clientRef = useRef<TerminalClient | null>(null);
  const [connected, setConnected] = useState(false);

  const handleConnect = async (config: ConnectionConfig) => {
    const client = new TerminalClient(config.host, config.port, config.token);
    await client.connect();
    clientRef.current = client;
    setConnected(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      {connected && clientRef.current ? (
        <TerminalScreen client={clientRef.current} />
      ) : (
        <ConnectionScreen onConnect={handleConnect} />
      )}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0e14',
  },
});
