import { defineRoom, defineServer } from "colyseus";
import { TacticsRoom } from "./rooms/TacticsRoom.js";

export default defineServer({
  rooms: {
    tactics: defineRoom(TacticsRoom),
  },
  express: (app) => {
    app.get("/health", (
      _request: unknown,
      response: { json: (body: unknown) => unknown },
    ) => {
      response.json({ status: "ok", service: "tactics-lite-server" });
    });
  },
});
