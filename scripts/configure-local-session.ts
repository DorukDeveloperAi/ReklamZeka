#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { constants, lstatSync, openSync, readFileSync, closeSync, fsyncSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arguments_ = process.argv.slice(2);
if (arguments_.includes("--help")) {
  console.log("Usage: npm run local-session:configure -- [--apply] [--rotate-signing-key]");
  console.log("Default is a read-only preview. --apply updates only the local-session keys in .env.local.");
  console.log("--rotate-signing-key requires --apply and replaces an invalid or intentionally rotated local signing key.");
  process.exit(0);
}
const apply = arguments_.includes("--apply");
const rotateSigningKey = arguments_.includes("--rotate-signing-key");
if (arguments_.some((argument) => argument !== "--apply" && argument !== "--rotate-signing-key")
  || arguments_.filter((argument) => argument === "--apply").length > 1
  || arguments_.filter((argument) => argument === "--rotate-signing-key").length > 1
  || (rotateSigningKey && !apply)) {
  console.error("Unknown or repeated argument. Use --help.");
  process.exit(2);
}
const sourcePath = resolve(".reklamzeka/local-session-config");
const targetPath = resolve(".env.local");
const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
const identityKeys = [
  "REKLAMZEKA_LOCAL_SESSION_ENABLED",
  "REKLAMZEKA_LOCAL_ORIGIN",
  "REKLAMZEKA_LOCAL_WORKSPACE_ID",
  "REKLAMZEKA_LOCAL_WORKSPACE_REF",
  "REKLAMZEKA_LOCAL_USER_ID",
  "REKLAMZEKA_LOCAL_READER_REF",
] as const;
const signingKeyName = "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY";
const managedKeys = new Set<string>([...identityKeys, signingKeyName]);

function privateRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== osUid || (stat.mode & 0o077) !== 0) {
    throw new Error("unsafe private configuration file");
  }
}

function parseEnvironment(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || result.has(match[1]!)) throw new Error("invalid environment configuration");
    result.set(match[1]!, match[2]!);
  }
  return result;
}

function validSigningKey(value: string | undefined): boolean {
  if (!value) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 && decoded.toString("base64") === value;
}

try {
  if (osUid < 0) throw new Error("OS identity unavailable");
  privateRegularFile(sourcePath);
  privateRegularFile(targetPath);
  const source = parseEnvironment(readFileSync(sourcePath, "utf8"));
  const currentText = readFileSync(targetPath, "utf8");
  const current = parseEnvironment(currentText);
  for (const key of identityKeys) {
    const value = source.get(key);
    if (!value || /[\r\n]/.test(value)) throw new Error("identity configuration incomplete");
  }
  const existingSigningKey = current.get(signingKeyName);
  if (existingSigningKey !== undefined && !validSigningKey(existingSigningKey) && !rotateSigningKey) {
    throw new Error("existing signing key is invalid");
  }
  if (!apply) {
    console.log("Dry-run: local-session identity keys and a signing key can be configured; no file changed.");
    process.exit(0);
  }

  const values = new Map<string, string>();
  for (const key of identityKeys) values.set(key, source.get(key)!);
  values.set(signingKeyName, rotateSigningKey ? randomBytes(32).toString("base64") : existingSigningKey ?? randomBytes(32).toString("base64"));
  const retained = currentText.split(/\r?\n/).filter((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    return !match || !managedKeys.has(match[1]!);
  });
  while (retained.at(-1) === "") retained.pop();
  const nextText = `${retained.join("\n")}\n\n# ReklamZeka local Decision Room session (managed)\n${
    [...values].map(([key, value]) => `${key}=${value}`).join("\n")
  }\n`;
  const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, nextText, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, targetPath);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
  privateRegularFile(targetPath);
  console.log("Local-session identity and signing key configured in private .env.local; no values were printed.");
} catch {
  console.error("Local-session configuration failed safely; no credentials or identifiers were printed.");
  process.exitCode = 1;
}
