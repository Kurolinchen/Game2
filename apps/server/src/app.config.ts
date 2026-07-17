import { defineRoom, defineServer } from "colyseus";
import { TacticsRoom } from "./rooms/TacticsRoom.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";

const matchmakingLimiter = new FixedWindowRateLimiter(30, 60_000);

export default defineServer({
  rooms: {
    tactics: defineRoom(TacticsRoom),
  },
  express: (app) => {
    app.set("trust proxy", 1);
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
