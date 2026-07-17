import { Client, type Room } from "@colyseus/sdk";
import type { NetworkMatchState } from "./types";

const defaultServerUrl = `${window.location.protocol}//${window.location.hostname}:2567`;
const serverUrl = import.meta.env.VITE_SERVER_URL || defaultServerUrl;
const client = new Client(serverUrl);
const RECONNECT_STORAGE_KEY = "tactics-lite-reconnect";

export type TacticsRoomConnection = Room<NetworkMatchState>;
export type CpuDifficulty = "easy" | "normal" | "hard";

interface StoredReconnectSession {
  roomId: string;
  token: string;
}

export async function wakeTacticsServer(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(`${serverUrl}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Server health check returned ${response.status}.`);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

export function storeReconnectSession(room: TacticsRoomConnection): void {
  window.sessionStorage.setItem(
    RECONNECT_STORAGE_KEY,
    JSON.stringify({
      roomId: room.roomId,
      token: room.reconnectionToken,
    } satisfies StoredReconnectSession),
  );
}

export function clearReconnectSession(): void {
  window.sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
}

export function readReconnectSession(): StoredReconnectSession | undefined {
  const value = window.sessionStorage.getItem(RECONNECT_STORAGE_KEY);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredReconnectSession>;
    if (typeof parsed.roomId !== "string" || typeof parsed.token !== "string") {
      clearReconnectSession();
      return undefined;
    }
    return { roomId: parsed.roomId, token: parsed.token };
  } catch {
    clearReconnectSession();
    return undefined;
  }
}

export async function reconnectTacticsRoom(
  token: string,
): Promise<TacticsRoomConnection> {
  return client.reconnect<NetworkMatchState>(token);
}

export async function createTacticsRoom(
  displayName: string,
  cpuDifficulty?: CpuDifficulty,
): Promise<TacticsRoomConnection> {
  return client.create<NetworkMatchState>("tactics", {
    displayName,
    opponent: cpuDifficulty ? "cpu" : "human",
    cpuDifficulty,
  });
}

export async function joinTacticsRoom(
  roomCode: string,
  displayName: string,
): Promise<TacticsRoomConnection> {
  return client.joinById<NetworkMatchState>(roomCode.trim().toUpperCase(), {
    displayName,
  });
}
