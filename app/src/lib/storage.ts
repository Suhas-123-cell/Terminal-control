import * as SecureStore from 'expo-secure-store';

export type ConnectionConfig = {
  host: string;
  port: string;
  token: string;
};

export type SessionMeta = {
  id: string;
  title: string;
};

const CONNECTION_KEY = 'remote-terminal:connection';
const SESSIONS_KEY = 'remote-terminal:sessions';

export async function loadConnectionConfig(): Promise<ConnectionConfig | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveConnectionConfig(config: ConnectionConfig): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(config));
}

export async function loadSessionList(): Promise<SessionMeta[]> {
  const raw = await SecureStore.getItemAsync(SESSIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveSessionList(sessions: SessionMeta[]): Promise<void> {
  await SecureStore.setItemAsync(SESSIONS_KEY, JSON.stringify(sessions));
}
