import { z } from "zod";
import { readEnvironment } from "../src/config/environment.ts";
import { openDatabase } from "../src/db/database.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { bootstrapFirstAdmin, createAuth } from "../src/modules/auth/index.ts";

const bootstrapEnvironmentSchema = z.object({
  STAM_ADMIN_EMAIL: z.string().min(1),
  STAM_ADMIN_NAME: z.string().min(1),
  STAM_ADMIN_PASSWORD: z.string().min(1),
});

const environment = readEnvironment();
const admin = bootstrapEnvironmentSchema.parse(Bun.env);
const database = openDatabase(environment.DATABASE_PATH);

try {
  migrateDatabase(database);
  const auth = createAuth(database, environment);
  const result = await bootstrapFirstAdmin(auth, database, {
    email: admin.STAM_ADMIN_EMAIL,
    name: admin.STAM_ADMIN_NAME,
    password: admin.STAM_ADMIN_PASSWORD,
  });
  console.info(`Created initial administrator ${result.user.email} (${result.user.id})`);
} finally {
  database.close();
}
