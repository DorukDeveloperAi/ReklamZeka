import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { LocalSessionClaims } from "@/security/local-session-capability";

type RecordShape = Readonly<{
  version: 1;
  sessionRef: string;
  nonce: string;
  tokenHash: string;
  expiresAt: number;
  osUid: number;
}>;

export class LocalSessionBootstrapStoreError extends Error {
  constructor() {
    super("Local session bootstrap proof rejected");
    this.name = "LocalSessionBootstrapStoreError";
  }
}

function fail(): never {
  throw new LocalSessionBootstrapStoreError();
}

function root(baseDirectory: string): string {
  return resolve(baseDirectory, ".reklamzeka", "local-session-bootstrap");
}

function parent(baseDirectory: string): string {
  return resolve(baseDirectory, ".reklamzeka");
}

function name(baseDirectory: string, nonce: string): string {
  if (!/^[a-f0-9]{64}$/.test(nonce)) fail();
  return resolve(root(baseDirectory), `${createHash("sha256").update(nonce).digest("hex")}.json`);
}

async function ownedDirectory(path: string, osUid: number): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== osUid || (stat.mode & 0o077) !== 0) fail();
}

async function secureDirectory(baseDirectory: string, osUid: number): Promise<void> {
  // Validate both controlled path components. mkdir({recursive:true}) would
  // otherwise permit an attacker-controlled `.reklamzeka` symlink parent.
  await ownedDirectory(parent(baseDirectory), osUid);
  await ownedDirectory(root(baseDirectory), osUid);
}

function record(claims: LocalSessionClaims, token: string): RecordShape {
  if (claims.kind !== "bootstrap") fail();
  return Object.freeze({
    version: 1,
    sessionRef: claims.sessionRef,
    nonce: claims.nonce,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: claims.expiresAt,
    osUid: claims.osUid,
  });
}

export async function registerLocalSessionBootstrap(
  claims: LocalSessionClaims,
  token: string,
  baseDirectory = process.cwd(),
): Promise<void> {
  await secureDirectory(baseDirectory, claims.osUid);
  const handle = await open(name(baseDirectory, claims.nonce), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(JSON.stringify(record(claims, token)), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function consumeLocalSessionBootstrap(
  claims: LocalSessionClaims,
  token: string,
  now: number,
  baseDirectory = process.cwd(),
): Promise<void> {
  await secureDirectory(baseDirectory, claims.osUid);
  const source = name(baseDirectory, claims.nonce);
  const consuming = `${source}.consuming-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await rename(source, consuming);
  } catch {
    fail();
  }
  try {
    const stat = await lstat(consuming);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== claims.osUid || (stat.mode & 0o077) !== 0 || stat.size > 1024) fail();
    const parsed: unknown = JSON.parse(await readFile(consuming, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).length !== 6
      || Object.keys(parsed).some((key) => !["version", "sessionRef", "nonce", "tokenHash", "expiresAt", "osUid"].includes(key))) fail();
    const value = parsed as Record<string, unknown>;
    const actualHash = createHash("sha256").update(token).digest();
    const storedHash = typeof value.tokenHash === "string" ? Buffer.from(value.tokenHash, "hex") : Buffer.alloc(0);
    if (value.version !== 1 || value.sessionRef !== claims.sessionRef || value.nonce !== claims.nonce
      || value.expiresAt !== claims.expiresAt || value.osUid !== claims.osUid || claims.expiresAt <= now
      || storedHash.byteLength !== actualHash.byteLength || !timingSafeEqual(storedHash, actualHash)) fail();
  } catch {
    fail();
  } finally {
    await unlink(consuming).catch(() => undefined);
  }
}
