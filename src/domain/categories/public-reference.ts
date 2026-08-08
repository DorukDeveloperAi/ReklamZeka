import { createHash } from "node:crypto";

function validKey(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Stable across immutable UUID revisions; exact revision evidence stays in frozen context. */
export function categoryDefinitionPublicRef(dimensionKey: string, definitionKey: string): string {
  if (!validKey(dimensionKey) || !validKey(definitionKey)) throw new TypeError("invalid_category_key");
  const canonical = JSON.stringify({ definitionKey, dimensionKey });
  return `category_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}
