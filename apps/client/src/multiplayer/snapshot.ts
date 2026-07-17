import type { MatchSnapshot, NetworkMatchState } from "./types";

export function toMatchSnapshot(state: NetworkMatchState): MatchSnapshot {
  const players: MatchSnapshot["players"] = [];
  const units: MatchSnapshot["units"] = [];
  const tiles: MatchSnapshot["tiles"] = [];
  const stats: MatchSnapshot["stats"] = [];

  state.players?.forEach((player) => {
    players.push({
      id: player.id,
      displayName: player.displayName,
      slot: player.slot,
      ready: player.ready,
      connected: player.connected,
      isCpu: player.isCpu,
      difficulty: player.difficulty,
      rematchReady: player.rematchReady,
    });
  });
  state.units?.forEach((unit) => {
    const cooldowns: Record<string, number> = {};
    unit.cooldowns?.forEach((remaining, abilityId) => {
      cooldowns[abilityId] = remaining;
    });
    units.push({
      id: unit.id,
      ownerId: unit.ownerId,
      classId: unit.classId,
      name: unit.name,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
      maxHp: unit.maxHp,
      movementRange: unit.movementRange,
      attackRange: unit.attackRange,
      attackDamage: unit.attackDamage,
      alive: unit.alive,
      isDecoy: unit.isDecoy,
      sourceUnitId: unit.sourceUnitId,
      movementDiscountAvailable: unit.movementDiscountAvailable,
      overwatchActive: unit.overwatchActive,
      overwatchExpiresRound: unit.overwatchExpiresRound,
      cooldowns,
    });
  });
  state.tiles?.forEach((tile) => {
    tiles.push({
      x: tile.x,
      y: tile.y,
      tileType: tile.tileType,
      walkable: tile.walkable,
      blocksLineOfSight: tile.blocksLineOfSight,
      coverValue: tile.coverValue,
    });
  });
  state.stats?.forEach((entry) => {
    stats.push({
      playerId: entry.playerId,
      damageDealt: entry.damageDealt,
      unitsEliminated: entry.unitsEliminated,
      abilitiesUsed: entry.abilitiesUsed,
      movesMade: entry.movesMade,
      apSpent: entry.apSpent,
    });
  });

  return {
    roomCode: state.roomCode,
    status: state.status,
    currentRound: state.currentRound,
    activePlayerId: state.activePlayerId,
    actionPointsRemaining: state.actionPointsRemaining,
    boardWidth: state.boardWidth,
    boardHeight: state.boardHeight,
    players: players.sort((a, b) => a.slot - b.slot),
    units,
    tiles,
    winnerId: state.winnerId,
    winReason: state.winReason,
    mapId: state.mapId,
    matchNumber: state.matchNumber,
    stats,
  };
}
