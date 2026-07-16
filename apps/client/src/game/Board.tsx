import { useEffect, useMemo, useRef } from "react";
import { createBoardGame } from "./createGame";
import { GameBridge, type TileSelection } from "./GameBridge";
import type { MatchSnapshot } from "../multiplayer/types";

interface BoardProps {
  snapshot: MatchSnapshot;
  localPlayerId: string;
  onTileSelected(selection: TileSelection): void;
}

export function Board({ snapshot, localPlayerId, onTileSelected }: BoardProps) {
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
    bridge.publishSnapshot(snapshot, localPlayerId);
  }, [bridge, snapshot, localPlayerId]);

  useEffect(() => {
    bridge.on(GameBridge.TILE_SELECTED, onTileSelected);
    return () => {
      bridge.off(GameBridge.TILE_SELECTED, onTileSelected);
    };
  }, [bridge, onTileSelected]);

  return <div className="board-canvas" ref={parentRef} aria-label="Tactical board" />;
}

