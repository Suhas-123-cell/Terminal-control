import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';
import { ConnectionConfig } from './src/lib/storage';
import { TerminalClient } from './src/lib/wsClient';

export default function App() {
  const [client, setClient] = useState<TerminalClient | null>(null);

  const handleConnect = async (config: ConnectionConfig) => {
    const next = new TerminalClient(config.host, config.port, config.token);
    try {
      await next.connect();
    } catch (e) {
      // Don't leave a failed client retrying in the background.
      next.disconnect();
      throw e;
    }
    setClient(next);
  };

  const handleDisconnect = () => {
    // Shells keep running on the laptop; reconnecting reattaches to them.
    client?.disconnect();
    setClient(null);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {client ? (
          <TerminalScreen client={client} onDisconnect={handleDisconnect} />
        ) : (
          <ConnectionScreen onConnect={handleConnect} />
        )}
        <StatusBar style="light" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0e14',
  },
});
