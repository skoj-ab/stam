import { readEnvironment } from "../config/environment.ts";
import { openDatabase } from "../db/database.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { recordRuntimeConfiguration } from "../modules/audit/index.ts";
import { createAuth } from "../modules/auth/index.ts";
import { createApp } from "./app.ts";

const environment = readEnvironment();
const database = openDatabase(environment.DATABASE_PATH);

let server: ReturnType<typeof Bun.serve>;
try {
  migrateDatabase(database);
  recordRuntimeConfiguration(database, environment);
  const auth = createAuth(database, environment);
  const app = createApp(database, auth, environment);
  server = Bun.serve({
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: environment.PORT,
  });
} catch (error) {
  database.close();
  throw error;
}

console.info(`Stam listening on ${server.url}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; stopping HTTP server`);

  try {
    await server.stop();
    database.close();
    process.exit(0);
  } catch (error) {
    console.error("Failed to shut down cleanly", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
