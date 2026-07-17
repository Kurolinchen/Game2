import { defineRoom, defineServer } from "colyseus";
import { TacticsRoom } from "./rooms/TacticsRoom.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";

const matchmakingLimiter = new FixedWindowRateLimiter(30, 60_000);
const allowedOrigins = (
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.some((pattern) => {
    if (!pattern.includes("*")) return pattern === origin;
    const expression = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${expression}$`).test(origin);
  });
}

export default defineServer({
  rooms: {
    tactics: defineRoom(TacticsRoom),
  },
  express: (app) => {
    app.set("trust proxy", 1);
    app.disable("x-powered-by");
    app.use((
      request: { method?: string; headers: Record<string, string | string[] | undefined> },
      response: { status: (code: number) => { json: (body: unknown) => unknown }; setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      const header = request.headers.origin;
      const origin = Array.isArray(header) ? header[0] : header;
      if (origin && allowedOrigins.length > 0 && !isAllowedOrigin(origin)) {
        response.status(403).json({ error: "Origin is not allowed." });
        return;
      }
      next();
    });
    app.use("/matchmake", (
      request: {
        ip?: string;
        headers: Record<string, string | string[] | undefined>;
      },
      response: {
        status: (code: number) => {
          json: (body: unknown) => unknown;
        };
        setHeader: (name: string, value: string) => void;
      },
      next: () => void,
    ) => {
      const forwarded = request.headers["x-forwarded-for"];
      const forwardedIp = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded?.split(",")[0]?.trim();
      const result = matchmakingLimiter.check(
        request.ip || forwardedIp || "unknown",
      );
      if (result.allowed) {
        next();
        return;
      }
      response.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))),
      );
      response.status(429).json({
        error: "Too many room requests. Please wait a moment and try again.",
      });
    });
    app.get("/health", (
      _request: unknown,
      response: { json: (body: unknown) => unknown },
    ) => {
      response.json({ status: "ok", service: "tactics-lite-server" });
    });
  },
});
