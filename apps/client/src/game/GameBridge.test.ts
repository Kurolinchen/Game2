import { describe, expect, it, vi } from "vitest";
import type { MatchSnapshot } from "../multiplayer/types";
import { GameBridge } from "./GameBridge";

vi.mock("phaser", async () => {
  class EventEmitter {
    private readonly listeners = new Map<
      string,
      Array<(...args: unknown[]) => void>
    >();

    on(event: string, listener: (...args: unknown[]) => void): this {
      const eventListeners = this.listeners.get(event) ?? [];
      eventListeners.push(listener);
      this.listeners.set(event, eventListeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
      return this.listeners.has(event);
    }
  }

  return {
    default: {
      Events: { EventEmitter },
    },
  };
});

describe("GameBridge", () => {
  it("replays a snapshot published before the scene subscribes", () => {
    const bridge = new GameBridge();
    const snapshot = { round: 1 } as unknown as MatchSnapshot;
    const listener = vi.fn();

    bridge.publishSnapshot(snapshot, "player-1", {
      selectedUnitId: "unit-1",
      actionMode: "move",
    });
    bridge.on(GameBridge.SNAPSHOT, listener);

    expect(bridge.replayLatestSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot, "player-1", {
      selectedUnitId: "unit-1",
      actionMode: "move",
    });
  });

  it("does nothing when no snapshot has been published", () => {
    const bridge = new GameBridge();
    const listener = vi.fn();

    bridge.on(GameBridge.SNAPSHOT, listener);

    expect(bridge.replayLatestSnapshot()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
