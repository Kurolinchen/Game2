import { describe, expect, it } from "vitest";
import { sanitizeDisplayName } from "./displayName.js";

describe("sanitizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeDisplayName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
  });

  it("uses a safe fallback for empty or non-string values", () => {
    expect(sanitizeDisplayName("  ")).toBe("Player");
    expect(sanitizeDisplayName(null)).toBe("Player");
  });

  it("caps names to 24 characters", () => {
    expect(sanitizeDisplayName("x".repeat(50))).toHaveLength(24);
  });
});

