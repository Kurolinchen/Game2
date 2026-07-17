const os = require("node:os");

/**
 * Process configuration used by Colyseus Cloud.
 * Keep this file at the repository root so the managed runtime can discover it.
 */
module.exports = {
  apps: [
    {
      name: "tactics-lite-server",
      script: "apps/server/dist/index.js",
      time: true,
      watch: false,
      instances: os.cpus().length,
      exec_mode: "fork",
      wait_ready: true,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
