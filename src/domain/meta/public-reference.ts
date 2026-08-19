import { createHash } from "node:crypto";

/**
 * Stable, tenant-scoped aliases for the public read-only Meta projections.
 * These are identifiers for joining independently-read canonical projections;
 * they never expose the Meta identifier used as the hash input.
 */
export type MetaPublicReferenceKind = "connection" | "account" | "campaign" | "ad_set" | "ad" | "creative" | "post";

const KINDS = new Set<MetaPublicReferenceKind>(["connection", "account", "campaign", "ad_set", "ad", "creative", "post"]);

export function metaPublicReference(kind: MetaPublicReferenceKind, workspaceId: string, id: string): string {
  if (!KINDS.has(kind) || !workspaceId || !id) throw new Error("meta public reference rejected");
  return `${kind}_${createHash("sha256").update(`${workspaceId}\u0000${kind}\u0000${id}`).digest("hex").slice(0, 24)}`;
}
