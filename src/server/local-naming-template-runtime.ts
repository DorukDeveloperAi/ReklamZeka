import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { DrizzleNamingTemplateRepository } from "@/connectors/campaigns/naming-template-drizzle-repository";
import { DrizzleNamingTemplateReplayEvidenceRepository } from "@/connectors/campaigns/naming-template-replay-evidence-drizzle-repository";
import { createNamingTemplateHttpHandlers,namingTemplateForbidden,namingTemplateInvalidInput,namingTemplateRequestKind,namingTemplateSessionRequired,namingTemplateUnavailable } from "@/server/naming-template-http";
import { hasTrustedFrameworkForwarding,LocalDecisionRoomBoundaryError,resolveTrustedLocalSessionIdentity,type LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { cookieToken,LocalSessionCapabilityError,verifyLocalSessionCapability } from "@/security/local-session-capability";
type Database=NodePgDatabase<typeof schema>;
function trusted(request:Request,config:LocalDecisionRoomConfig){
  let url:URL;try{url=new URL(request.url);}catch{return false;} const operation=namingTemplateRequestKind(request);
  return operation!==null&&url.origin===config.origin&&request.headers.get("host")===new URL(config.origin).host&&!request.headers.has("authorization")&&request.headers.get("sec-fetch-site")==="same-origin"&&hasTrustedFrameworkForwarding(request,config.origin)&&(operation==="list"?request.headers.get("origin")===null||request.headers.get("origin")===config.origin:request.headers.get("origin")===config.origin);
}
export function createLocalNamingTemplateHandlers(input:Readonly<{database:Pick<Database,"transaction"|"execute">;config:LocalDecisionRoomConfig}>){
  const repository=new DrizzleNamingTemplateRepository(input.database as never),replay=new DrizzleNamingTemplateReplayEvidenceRepository(input.database as never);
  const invoke=async(request:Request,method:"GET"|"POST")=>{
    if(request.method!==method||!trusted(request,input.config))return namingTemplateInvalidInput(); if(!request.headers.get("cookie"))return namingTemplateSessionRequired();
    try{const operation=namingTemplateRequestKind(request)!;const bound=await resolveTrustedLocalSessionIdentity({request,database:input.database as never,config:input.config,credential:"cookie"});verifyLocalSessionCapability({token:cookieToken(request)!,key:input.config.signingKey,now:Math.floor(Date.now()/1000),osUid:typeof process.getuid==="function"?process.getuid():-1,requiredScope:operation==="list"||operation==="preview"?"naming_template:read":"naming_template:write",expected:input.config});return createNamingTemplateHttpHandlers({repository,replay,identity:async()=>({workspaceId:bound.principal.workspaceId,actorId:bound.principal.actor.userId})})[method](request);}
    catch(reason){if(reason instanceof LocalSessionCapabilityError)return namingTemplateSessionRequired();if(reason instanceof LocalDecisionRoomBoundaryError)return reason.code==="principal_unavailable"?namingTemplateForbidden():namingTemplateSessionRequired();return namingTemplateUnavailable();}
  };return Object.freeze({GET:(request:Request)=>invoke(request,"GET"),POST:(request:Request)=>invoke(request,"POST")});
}
