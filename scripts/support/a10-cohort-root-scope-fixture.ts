import { randomUUID } from "node:crypto";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { A10CohortFixtureRootScope } from "./a10-cohort-sync-fixture";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type A10CohortRootScopeFixture = Readonly<{
  root: A10CohortFixtureRootScope;
  actorId: string;
  workspaceRef: string;
  actorRef: string;
}>;

/**
 * Test-only identity bootstrap for the A10 outer-rollback verifier.
 *
 * There is no normal production writer for a brand-new tenant's platform
 * identity before onboarding. This helper is therefore intentionally limited
 * to workspace, user/membership, connection, data-source and ad-account
 * identity. It must never seed campaigns, ad sets, sync runs, insights,
 * snapshots, contexts, features, windows, evidence, or cohort assets.
 */
export async function materializeA10CohortRootScopeFixture(database: Database): Promise<A10CohortRootScopeFixture> {
  const workspaceId = randomUUID();
  const actorId = randomUUID();
  const connectionId = randomUUID();
  const dataSourceId = randomUUID();
  const adAccountId = randomUUID();
  const suffix = workspaceId.replaceAll("-", "").slice(0, 12);
  const externalAccountId = `act_a10_${suffix}`;

  await database.insert(schema.workspaces).values({ id: workspaceId, name: "A10 cohort verifier" });
  await database.insert(schema.users).values({ id: actorId, email: `a10-cohort-${suffix}@example.invalid` });
  await database.insert(schema.memberships).values({ workspaceId, userId: actorId, role: "owner" });
  await database.insert(schema.metaConnections).values({
    id: connectionId,
    workspaceId,
    externalConnectionKey: `connection_a10_${suffix}`,
    displayName: "A10 cohort verifier",
    graphApiVersion: "v23.0",
    fieldCatalogVersion: "meta-change-fields-v1",
    accessMode: "read_only",
    status: "active",
  });
  await database.insert(schema.dataSources).values({
    id: dataSourceId,
    workspaceId,
    metaConnectionId: connectionId,
    platform: "meta_ads",
    externalAccountId,
    displayName: "A10 cohort account",
  });
  await database.insert(schema.adAccounts).values({
    id: adAccountId,
    workspaceId,
    dataSourceId,
    externalAccountId,
    name: "A10 cohort account",
    currency: "TRY",
    timezone: "Europe/Istanbul",
  });

  return Object.freeze({
    root: Object.freeze({ workspaceId, connectionId, adAccountId, externalAccountId }),
    actorId,
    workspaceRef: `workspace_a10_${suffix}`,
    actorRef: `actor_a10_${suffix}`,
  });
}
