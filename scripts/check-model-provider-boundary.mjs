#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_ROOTS = ["src", "scripts"];
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const SELF_PATH = "scripts/check-model-provider-boundary.mjs";

const FORBIDDEN_PACKAGES = [
  "openai",
  "openai-edge",
  "anthropic",
  "@openai",
  "@anthropic-ai",
  "@anthropic-ai/sdk",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
];

const FORBIDDEN_ENV_NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
const FORBIDDEN_API_HOSTS = ["api.openai.com", "api.anthropic.com"];

function parseRootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root" && argv[1]?.trim()) return resolve(argv[1]);
  throw new Error("Kullanım: node scripts/check-model-provider-boundary.mjs [--root <repo-root>]");
}

function readJson(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`${label}: bulunamadı`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    failures.push(`${label}: geçerli JSON değil`);
    return null;
  }
}

function forbiddenPackage(name) {
  return FORBIDDEN_PACKAGES.find((candidate) => name === candidate)
    ?? FORBIDDEN_PACKAGES.find((candidate) => name.startsWith(`${candidate}/`))
    ?? null;
}

function manifestDependencies(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .flatMap((key) => {
      const value = manifest[key];
      return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
    });
}

function lockPackageNames(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return [];
  const names = new Set();
  if (lock.packages && typeof lock.packages === "object" && !Array.isArray(lock.packages)) {
    for (const [path, metadata] of Object.entries(lock.packages)) {
      const marker = "node_modules/";
      const index = path.lastIndexOf(marker);
      if (index >= 0) names.add(path.slice(index + marker.length));
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)
        && typeof metadata.name === "string") names.add(metadata.name);
    }
  }
  if (lock.dependencies && typeof lock.dependencies === "object" && !Array.isArray(lock.dependencies)) {
    Object.keys(lock.dependencies).forEach((name) => names.add(name));
  }
  return [...names];
}

function sourceFilesBelow(root, relative = "") {
  const absolute = resolve(root, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFilesBelow(root, child);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [child] : [];
  });
}

function importedSpecifiers(source) {
  const values = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  return values.filter((value) => typeof value === "string");
}

function inspectText(label, source, failures) {
  for (const specifier of importedSpecifiers(source)) {
    const matched = forbiddenPackage(specifier);
    if (matched) failures.push(`${label}: yasak model-provider import'u (${matched})`);
  }
  for (const name of FORBIDDEN_ENV_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(source)) {
      failures.push(`${label}: yasak model-provider environment anahtarı (${name})`);
    }
  }
  for (const host of FORBIDDEN_API_HOSTS) {
    if (source.toLowerCase().includes(host)) {
      failures.push(`${label}: doğrudan model-provider API host'u (${host})`);
    }
  }
}

function inspectSource(root, relativePath, failures) {
  if (relativePath === SELF_PATH) return;
  inspectText(relativePath, readFileSync(resolve(root, relativePath), "utf8"), failures);
}

export function checkModelProviderBoundary(rootInput = DEFAULT_ROOT) {
  const root = resolve(rootInput);
  const failures = [];
  const manifest = readJson(resolve(root, "package.json"), "package.json", failures);
  const lock = readJson(resolve(root, "package-lock.json"), "package-lock.json", failures);

  for (const name of new Set([...manifestDependencies(manifest), ...lockPackageNames(lock)])) {
    const matched = forbiddenPackage(name);
    if (matched) failures.push(`bağımlılık: yasak model-provider paketi (${matched})`);
  }
  if (manifest?.scripts && typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts)) {
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (typeof command === "string") inspectText(`package.json#scripts.${name}`, command, failures);
    }
  }

  for (const runtimeRoot of RUNTIME_ROOTS) {
    for (const relativePath of sourceFilesBelow(root, runtimeRoot)) inspectSource(root, relativePath, failures);
  }

  return Object.freeze({
    ok: failures.length === 0,
    root,
    failures: Object.freeze([...new Set(failures)].sort()),
  });
}

function main() {
  let root;
  try {
    root = parseRootArgument(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Geçersiz argüman");
    process.exitCode = 2;
    return;
  }
  const result = checkModelProviderBoundary(root);
  if (!result.ok) {
    console.error(`MODEL PROVIDER BOUNDARY FAIL (${result.failures.length})`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log("MODEL PROVIDER BOUNDARY PASS — ReklamZeka runtime/dependency yüzeyinde model SDK, provider API anahtarı veya doğrudan model API çağrısı yok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
