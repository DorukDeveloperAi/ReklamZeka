import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { CanonicalPerformanceReadService, type CanonicalPerformanceReadRepository } from "@/application/canonical-performance-read-service";
import { DrizzleCanonicalPerformanceReadRepository } from "@/connectors/meta/canonical-performance-read-drizzle-repository";
import { canonicalPerformanceNotConfiguredResponse, canonicalPerformanceSessionRequiredResponse, createCanonicalPerformanceReadHttpHandler } from "@/server/canonical-performance-read-http";
import { LocalDecisionRoomBoundaryError, resolveTrustedLocalReadPrincipal, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database = NodePgDatabase<typeof schema>;
export function createLocalCanonicalPerformanceReadRouteHandler(input: Readonly<{ database: Pick<Database, "transaction" | "execute">; config: LocalDecisionRoomConfig; repository?: CanonicalPerformanceReadRepository }>) { return async (request: Request) => { try { const bound = await resolveTrustedLocalReadPrincipal({ request, database: input.database, config: input.config, requiredScope: "decision_room:read" }); const repository = input.repository ?? new DrizzleCanonicalPerformanceReadRepository(input.database as never); return createCanonicalPerformanceReadHttpHandler({ load: (workspaceId) => new CanonicalPerformanceReadService(repository).read(workspaceId), workspaceId: async () => bound.principal.workspaceId })(request); } catch (reason) { return reason instanceof LocalSessionCapabilityError || reason instanceof LocalDecisionRoomBoundaryError && reason.code === "untrusted_request" ? canonicalPerformanceSessionRequiredResponse() : canonicalPerformanceNotConfiguredResponse(); } }; }
export { canonicalPerformanceNotConfiguredResponse };
