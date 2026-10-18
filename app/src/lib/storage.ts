import * as SecureStore from 'expo-secure-store';

export type ConnectionConfig = {
  host: string;
  port: string;
  token: string;
};

const CONNECTION_KEY = 'remote-terminal.connection';

export async function loadConnectionConfig(): Promise<ConnectionConfig | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveConnectionConfig(config: ConnectionConfig): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(config));
}
