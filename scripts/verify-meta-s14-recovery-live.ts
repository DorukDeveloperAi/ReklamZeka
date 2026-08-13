import { existsSync } from "node:fs";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  recoverMetaPostMediaInventoryFromCreativeEvidence,
  type MetaCreativePostRecoveryTarget,
} from "@/connectors/meta/post-media-inventory";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL?.trim();
const token = process.env.META_ACCESS_TOKEN?.trim();
const workspaceId = process.env.META_S14_RECOVERY_WORKSPACE_ID?.trim();
const connectionId = process.env.META_S14_RECOVERY_CONNECTION_ID?.trim();
const maxActors = Number(process.env.META_S14_RECOVERY_MAX_TARGET_ACTORS ?? "5");

if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");
if (process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("META_TOKEN_SECURITY_STATUS=rotated olmadan canlı recovery doğrulaması çalışmaz");
}
if (!workspaceId || !connectionId) {
  throw new Error("META_S14_RECOVERY_WORKSPACE_ID ve META_S14_RECOVERY_CONNECTION_ID yapılandırılmalı");
}
if (!Number.isSafeInteger(maxActors) || maxActors < 1 || maxActors > 10) {
  throw new Error("META_S14_RECOVERY_MAX_TARGET_ACTORS 1-10 aralığında olmalı");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
let getNetworkCalls = 0;
let writeNetworkCalls = 0;

const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    writeNetworkCalls += 1;
    throw new Error("S1.4 recovery doğrulaması GET dışı Meta çağrısını reddetti");
  }
  getNetworkCalls += 1;
  const timeout = AbortSignal.timeout(20_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

try {
  // Targets are derived only from canonical persisted post↔actor evidence.
  // The verifier never writes Meta or the local database.
  const evidence = await database.select({
    actorType: schema.metaAssets.assetType,
    actorExternalId: schema.metaAssets.externalAssetId,
    externalPostId: schema.metaPosts.externalPostId,
  }).from(schema.metaCreatives)
    .innerJoin(schema.metaPosts, eq(schema.metaCreatives.postId, schema.metaPosts.id))
    .innerJoin(schema.metaAssets, eq(schema.metaPosts.actorAssetId, schema.metaAssets.id))
    .where(and(
      eq(schema.metaCreatives.workspaceId, workspaceId),
      eq(schema.metaPosts.workspaceId, workspaceId),
      eq(schema.metaPosts.metaConnectionId, connectionId),
      eq(schema.metaAssets.workspaceId, workspaceId),
      eq(schema.metaAssets.metaConnectionId, connectionId),
      isNotNull(schema.metaCreatives.postId),
      inArray(schema.metaAssets.assetType, ["facebook_page", "instagram_account"]),
    ))
    .orderBy(asc(schema.metaPosts.externalPostId))
    .limit(maxActors * 10);
  const targetByActor = new Map<string, MetaCreativePostRecoveryTarget[]>();
  for (const row of evidence) {
    if (row.actorType !== "facebook_page" && row.actorType !== "instagram_account") continue;
    const target: MetaCreativePostRecoveryTarget = {
      actorType: row.actorType,
      actorExternalId: row.actorExternalId,
      externalPostId: row.externalPostId,
    };
    const key = `${target.actorType}:${target.actorExternalId}`;
    if (!targetByActor.has(key) && targetByActor.size >= maxActors) continue;
    targetByActor.set(key, [...(targetByActor.get(key) ?? []), target]);
  }
  const targets = [...targetByActor.values()].flat();
  if (targets.length === 0) {
    console.log(JSON.stringify({
      schemaVersion: "meta-s14-recovery-live-v1",
      status: "partial",
      reason: "no_persisted_actor_post_evidence",
      persistedEvidence: { candidateRows: evidence.length, targetActors: 0, targetPosts: 0 },
      recovery: { recoveredItems: 0, verifiedDiscoveries: 0, partialDiscoveries: 0 },
      metaNetwork: { getCalls: getNetworkCalls, writeCalls: writeNetworkCalls },
      localDatabaseWrites: 0,
    }));
    process.exitCode = 2;
  } else {
    const inventory = await recoverMetaPostMediaInventoryFromCreativeEvidence({
      token,
      workspaceId,
      connectionExternalKey: connectionId,
      targets,
      fetchImpl: trackedFetch,
      maxPagesPerActor: 1,
    });
    const verifiedDiscoveries = inventory.discoveries.filter((entry) => entry.status === "verified" || entry.status === "empty").length;
    const partialDiscoveries = inventory.discoveries.length - verifiedDiscoveries;
    const status = writeNetworkCalls !== 0
      ? "unavailable"
      : inventory.items.length === 0 || partialDiscoveries > 0
        ? "partial"
        : "completed";
    console.log(JSON.stringify({
      schemaVersion: "meta-s14-recovery-live-v1",
      status,
      reason: inventory.items.length === 0
        ? "no_exact_actor_post_returned"
        : partialDiscoveries > 0 ? "some_actor_edges_unavailable" : null,
      persistedEvidence: { candidateRows: evidence.length, targetActors: targetByActor.size, targetPosts: targets.length },
      recovery: { recoveredItems: inventory.items.length, verifiedDiscoveries, partialDiscoveries },
      metaNetwork: { getCalls: getNetworkCalls, writeCalls: writeNetworkCalls },
      localDatabaseWrites: 0,
    }));
    if (status !== "completed") process.exitCode = 2;
  }
} finally {
  await pool.end();
}
