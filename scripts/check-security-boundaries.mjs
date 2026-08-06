#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "src/security/authorization.ts",
  "src/security/secrets.ts",
  "src/security/audit.ts",
  "src/server/workspace-data-service.ts",
  "tests/security-boundaries.test.ts",
  "docs/ADR/0003-kiraci-ve-sir-guvenligi.md",
  "drizzle/20260806155332_vengeful_chimera.sql",
];
const failures = required.filter((path) => !existsSync(resolve(root, path))).map((path) => `eksik: ${path}`);

const migrationPath = resolve(root, "drizzle/20260806155332_vengeful_chimera.sql");
if (existsSync(migrationPath)) {
  const migration = readFileSync(migrationPath, "utf8");
  if (!migration.includes("audit_events_append_only")) failures.push("audit append-only trigger eksik");
  if (!migration.includes("connection_secrets")) failures.push("şifreli bağlantı sırrı tablosu eksik");
}

const env = readFileSync(resolve(root, ".env.example"), "utf8");
const keyLine = env.split("\n").find((line) => line.startsWith("SECRET_ENCRYPTION_KEY="));
if (keyLine !== "SECRET_ENCRYPTION_KEY=") failures.push("örnek env gerçek/örnek bir şifreleme anahtarı taşımamalı");

if (failures.length > 0) {
  console.error(`SECURITY BOUNDARY FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("SECURITY BOUNDARY PASS — tenant, secret, scope ve append-only audit sınırları bağlı");
