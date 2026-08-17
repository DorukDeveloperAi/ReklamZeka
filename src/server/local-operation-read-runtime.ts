import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { OperationReadService } from "@/application/operation-read-service";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { createOperationReadHttpHandler, operationReadUnavailable } from "@/server/operation-read-http";
import { resolveTrustedLocalReadPrincipal, localDecisionRoomConfig, LocalDecisionRoomBoundaryError, type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LocalSessionCapabilityError } from "@/security/local-session-capability";
type Database=NodePgDatabase<typeof schema>;
export function createLocalOperationReadHandler(input:Readonly<{database:Pick<Database,"transaction">;config:LocalDecisionRoomConfig}>){return async(request:Request)=>{try{const bound=await resolveTrustedLocalReadPrincipal({request,database:input.database as never,config:input.config,requiredScope:"decision_room:read"});return createOperationReadHttpHandler({service:new OperationReadService(new DrizzleOperationReadRepository(input.database)),workspaceId:async()=>bound.principal.workspaceId})(request)}catch(reason){return reason instanceof LocalDecisionRoomBoundaryError||reason instanceof LocalSessionCapabilityError?operationReadUnavailable():operationReadUnavailable()}}}
export { localDecisionRoomConfig };
