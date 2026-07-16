import server from "./app.config.js";

const port = Number.parseInt(process.env.PORT ?? "2567", 10);

await server.listen(port);
console.log(`Tactics Lite server listening on http://localhost:${port}`);

