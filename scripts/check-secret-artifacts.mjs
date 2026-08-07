import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

delete process.env.META_ACCESS_TOKEN;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const configured = process.env.META_ACCESS_TOKEN?.trim();
if (!configured) {
  console.log("SECRET ARTIFACT CHECK SKIP — canlı Meta tokenı yapılandırılmamış");
  process.exit(0);
}

const secret = Buffer.from(configured);
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const groups = {
  tracked: trackedFiles,
  build: filesBelow(".next").filter((file) => !file.startsWith(join(".next", "cache"))),
  cache: [...filesBelow(join(".next", "cache")), ...filesBelow(".turbo")],
};
const matches = Object.fromEntries(Object.entries(groups).map(([name, files]) => [
  name,
  files.filter((file) => containsSecret(file, secret)).length,
]));
if (Object.values(matches).some((count) => count > 0)) {
  console.error(`SECRET ARTIFACT CHECK FAIL — ${JSON.stringify(matches)}`);
  process.exit(1);
}
console.log(`SECRET ARTIFACT CHECK PASS — ${JSON.stringify(matches)}`);
