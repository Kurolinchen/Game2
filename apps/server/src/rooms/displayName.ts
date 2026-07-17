const MAX_DISPLAY_NAME_LENGTH = 24;

export function sanitizeDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return "Player";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, MAX_DISPLAY_NAME_LENGTH) || "Player";
}

