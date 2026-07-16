import { useEffect, useMemo, useRef } from "react";
import { createBoardGame } from "./createGame";
import {
  GameBridge,
  type ActionMode,
  type BoardInteractionContext,
  type BoardSelection,
} from "./GameBridge";
import type { MatchSnapshot } from "../multiplayer/types";

interface BoardProps {
  snapshot: MatchSnapshot;
  localPlayerId: string;
  selectedUnitId: string;
  actionMode: ActionMode;
  onSelection(selection: BoardSelection): void;
}

export function Board({
  snapshot,
  localPlayerId,
  selectedUnitId,
  actionMode,
  onSelection,
}: BoardProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const bridge = useMemo(() => new GameBridge(), []);

  useEffect(() => {
    if (!parentRef.current) return undefined;
    const game = createBoardGame(parentRef.current, bridge);
    return () => {
      game.destroy(true);
      bridge.removeAllListeners();
    };
  }, [bridge]);

  useEffect(() => {
    const context: BoardInteractionContext = { selectedUnitId, actionMode };
    bridge.publishSnapshot(snapshot, localPlayerId, context);
  }, [actionMode, bridge, snapshot, localPlayerId, selectedUnitId]);

  useEffect(() => {
    bridge.on(GameBridge.SELECTION, onSelection);
    return () => {
      bridge.off(GameBridge.SELECTION, onSelection);
    };
  }, [bridge, onSelection]);

  return <div className="board-canvas" ref={parentRef} aria-label="Tactical board" />;
}
