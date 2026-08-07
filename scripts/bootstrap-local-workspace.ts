#!/usr/bin/env node

import { existsSync } from "node:fs";
import { Pool } from "pg";
import {
  bootstrapLocalWorkspace,
  localWorkspaceBootstrapIdentity,
  writeLocalWorkspaceSessionConfig,
} from "../src/server/local-workspace-bootstrap";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const arguments_ = process.argv.slice(2);
if (arguments_.includes("--help")) {
  console.log("Usage: npm run local-workspace:bootstrap -- [--apply]");
  console.log("Default is a read-only dry-run. --apply creates or reuses only the exact bootstrap binding.");
  process.exit(0);
}
if (arguments_.some((argument) => argument !== "--apply") || arguments_.filter((argument) => argument === "--apply").length > 1) {
  console.error("Unknown or repeated argument. Use --help.");
  process.exit(2);
}
const apply = arguments_.includes("--apply");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("Database connection is not configured.");
  process.exit(1);
}
const identity = localWorkspaceBootstrapIdentity(process.env);
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });

try {
  const result = await bootstrapLocalWorkspace({ pool, identity, apply });
  if (!apply) {
    console.log(result.status === "existing"
      ? "Dry-run: exact active local owner binding exists; no rows changed."
      : "Dry-run: exact local owner binding would be created; no rows changed.");
  } else {
    const path = await writeLocalWorkspaceSessionConfig({ baseDirectory: process.cwd(), identity, result });
    console.log(result.status === "created"
      ? "Local workspace owner binding created in one committed transaction."
      : "Exact local workspace owner binding reused; no tenant rows changed.");
    console.log(`Server-private identity config written with mode 0600: ${path}`);
    console.log("Copy/source those non-secret identity values into .env.local; configure the signing key separately.");
  }
} catch {
  console.error("Local workspace bootstrap failed safely; no credentials or identifiers were printed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
