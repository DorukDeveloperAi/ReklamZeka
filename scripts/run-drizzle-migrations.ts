import { existsSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL not configured");
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 30_000 });
try { await migrate(drizzle(pool), { migrationsFolder: "drizzle" }); console.log("programmatic drizzle migrations applied"); }
finally { await pool.end(); }
