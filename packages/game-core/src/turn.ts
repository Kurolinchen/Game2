import type { TurnResult } from "./types.js";

export function nextTurn(
  orderedPlayerIds: readonly string[],
  activePlayerId: string,
  round: number,
): TurnResult {
  if (orderedPlayerIds.length === 0) {
    throw new Error("Cannot advance a turn without players.");
  }

  const currentIndex = orderedPlayerIds.indexOf(activePlayerId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % orderedPlayerIds.length;
  const wrapped = currentIndex >= 0 && nextIndex === 0;

  return {
    activePlayerId: orderedPlayerIds[nextIndex] ?? orderedPlayerIds[0]!,
    round: wrapped ? round + 1 : round,
  };
}

