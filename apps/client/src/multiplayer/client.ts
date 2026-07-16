import { Client, type Room } from "@colyseus/sdk";
import type { NetworkMatchState } from "./types";

const defaultServerUrl = `${window.location.protocol}//${window.location.hostname}:2567`;
const serverUrl = import.meta.env.VITE_SERVER_URL || defaultServerUrl;
const client = new Client(serverUrl);

export type TacticsRoomConnection = Room<NetworkMatchState>;

export async function createTacticsRoom(
  displayName: string,
): Promise<TacticsRoomConnection> {
  return client.create<NetworkMatchState>("tactics", { displayName });
}

export async function joinTacticsRoom(
  roomCode: string,
  displayName: string,
): Promise<TacticsRoomConnection> {
  return client.joinById<NetworkMatchState>(roomCode.trim().toUpperCase(), {
    displayName,
  });
}

