import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const migrationDatabaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  migrations: { prefix: "timestamp" },
  strict: true,
  ...(migrationDatabaseUrl ? { dbCredentials: { url: migrationDatabaseUrl } } : {}),
});
