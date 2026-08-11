import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function filesBelow(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

function containsSecret(file, secret) {
  try {
    return readFileSync(file).includes(secret);
  } catch {
    return false;
  }
}

export const SECRET_NAMES = Object.freeze([
  "META_ACCESS_TOKEN",
  "META_MCP_ACCESS_TOKEN",
  "SECRET_ENCRYPTION_KEY",
  "REPORT_SIGNING_KEY",
  "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
]);

export function checkSecretArtifacts(rootInput = DEFAULT_ROOT) {
  const root = resolve(rootInput);
  const environmentPath = join(root, ".env.local");
  const localEnvironment = existsSync(environmentPath) ? parseEnv(readFileSync(environmentPath, "utf8")) : {};
  const secrets = SECRET_NAMES.map((name) => localEnvironment[name]?.trim())
    .filter((value) => typeof value === "string" && value.length >= 16)
    .map((value) => Buffer.from(value));
  if (secrets.length === 0) return Object.freeze({ ok: true, skipped: true, matches: Object.freeze({}) });
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean).map((file) => join(root, file));
  const buildRoot = join(root, ".next");
  const cacheRoot = join(buildRoot, "cache");
  const developmentCacheRoot = join(buildRoot, "dev", "cache");
  const groups = {
    tracked: trackedFiles,
    build: filesBelow(buildRoot).filter((file) => !file.startsWith(cacheRoot) && !file.startsWith(developmentCacheRoot)),
    cache: [...filesBelow(cacheRoot), ...filesBelow(join(root, ".turbo"))],
  };
  const matches = Object.freeze(Object.fromEntries(Object.entries(groups).map(([name, files]) => [
    name, files.filter((file) => secrets.some((secret) => containsSecret(file, secret))).length,
  ])));
  return Object.freeze({ ok: !Object.values(matches).some((count) => count > 0), skipped: false, matches });
}

function rootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]?.trim()) return resolve(argv[1]);
  throw new Error("Kullanım: node scripts/check-secret-artifacts.mjs [--root <repo-root>]");
}

function main() {
  let result;
  try { result = checkSecretArtifacts(rootArgument(process.argv.slice(2))); }
  catch { console.error("SECRET ARTIFACT CHECK FAIL — güvenli tarama başlatılamadı"); process.exitCode = 1; return; }
  if (result.skipped) { console.log("SECRET ARTIFACT CHECK SKIP — taranabilir yerel secret yapılandırılmamış"); return; }
  if (!result.ok) { console.error(`SECRET ARTIFACT CHECK FAIL — ${JSON.stringify(result.matches)}`); process.exitCode = 1; return; }
  console.log(`SECRET ARTIFACT CHECK PASS — ${JSON.stringify(result.matches)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
