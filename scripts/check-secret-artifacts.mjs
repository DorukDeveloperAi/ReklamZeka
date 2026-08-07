import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

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

const secretNames = [
  "META_ACCESS_TOKEN",
  "SECRET_ENCRYPTION_KEY",
  "REPORT_SIGNING_KEY",
  "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
];
const localEnvironment = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const secrets = secretNames
  .map((name) => localEnvironment[name]?.trim())
  .filter((value) => typeof value === "string" && value.length >= 16)
  .map((value) => Buffer.from(value));
if (secrets.length === 0) {
  console.log("SECRET ARTIFACT CHECK SKIP — taranabilir yerel secret yapılandırılmamış");
  process.exit(0);
}
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const groups = {
  tracked: trackedFiles,
  build: filesBelow(".next").filter((file) => !file.startsWith(join(".next", "cache"))),
  cache: [...filesBelow(join(".next", "cache")), ...filesBelow(".turbo")],
};
const matches = Object.fromEntries(Object.entries(groups).map(([name, files]) => [
  name,
  files.filter((file) => secrets.some((secret) => containsSecret(file, secret))).length,
]));
if (Object.values(matches).some((count) => count > 0)) {
  console.error(`SECRET ARTIFACT CHECK FAIL — ${JSON.stringify(matches)}`);
  process.exit(1);
}
console.log(`SECRET ARTIFACT CHECK PASS — ${JSON.stringify(matches)}`);
