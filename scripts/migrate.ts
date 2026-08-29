import { readEnvironment } from "../src/config/environment.ts";
import { openDatabase } from "../src/db/database.ts";
import { migrateDatabase } from "../src/db/migrate.ts";

const environment = readEnvironment();
const database = openDatabase(environment.DATABASE_PATH);

try {
  migrateDatabase(database);
  console.info(`Migrations applied to ${environment.DATABASE_PATH}`);
} finally {
  database.close();
}
