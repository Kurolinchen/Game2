import { describe, expect, it } from "vitest";
import { MAP_DEFINITIONS, MAP_ORDER, createMapTiles, parseMapId } from "./config.js";

describe("battlefield maps", () => {
  it("builds every map as a valid 8 by 8 board", () => {
    for (const mapId of MAP_ORDER) {
      const tiles = createMapTiles(mapId);
      expect(tiles).toHaveLength(64);
      expect(new Set(tiles.map((tile) => `${tile.x}:${tile.y}`)).size).toBe(64);
      expect(tiles.some((tile) => tile.type === "cover")).toBe(true);
      expect(tiles.some((tile) => tile.type === "obstacle")).toBe(true);
      for (const spawn of MAP_DEFINITIONS[mapId].spawnPoints.flat()) {
        expect(
          tiles.find((tile) => tile.x === spawn.x && tile.y === spawn.y)?.walkable,
        ).toBe(true);
      }
    }
  });

  it("falls back to Warehouse for untrusted map values", () => {
    expect(parseMapId("crossfire")).toBe("crossfire");
    expect(parseMapId("unknown-map")).toBe("warehouse");
    expect(parseMapId(null)).toBe("warehouse");
  });
});
