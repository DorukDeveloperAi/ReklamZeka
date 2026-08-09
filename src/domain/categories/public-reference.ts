import { createHash } from "node:crypto";

function validKey(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Stable across immutable UUID revisions; exact revision evidence stays in frozen context. */
export function categoryDimensionPublicRef(dimensionKey: string): string {
  if (!validKey(dimensionKey)) throw new TypeError("invalid_category_key");
  return `dimension_${createHash("sha256").update(JSON.stringify({ dimensionKey })).digest("hex").slice(0, 24)}`;
}

/** Stable across immutable UUID revisions; exact revision evidence stays in frozen context. */
export function categoryDefinitionPublicRef(dimensionKey: string, definitionKey: string): string {
  if (!validKey(dimensionKey) || !validKey(definitionKey)) throw new TypeError("invalid_category_key");
  const canonical = JSON.stringify({ definitionKey, dimensionKey });
  return `category_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Server-resolved opaque assignment identity; raw database UUIDs never cross the HTTP boundary. */
export function categoryAssignmentPublicRef(workspaceId: string, assignmentId: string): string {
  if (!validUuid(workspaceId) || !validUuid(assignmentId)) throw new TypeError("invalid_category_identity");
  const canonical = JSON.stringify({ assignmentId: assignmentId.toLowerCase(), workspaceId: workspaceId.toLowerCase() });
  return `assignment_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

/** Server-resolved opaque Meta hierarchy identity used only for category assignment authoring. */
export function categoryEntityPublicRef(
  workspaceId: string,
  level: "campaign" | "ad_set" | "ad" | "creative",
  entityId: string,
): string {
  if (!validUuid(workspaceId) || !validUuid(entityId)) throw new TypeError("invalid_category_identity");
  const canonical = JSON.stringify({ entityId: entityId.toLowerCase(), level, workspaceId: workspaceId.toLowerCase() });
  return `category_entity_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}
