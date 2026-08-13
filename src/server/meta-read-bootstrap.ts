import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { AppendOnlyAuditLog } from "@/security/audit";
import { MetaConnectionService } from "@/connectors/meta/connection-service";
import { DrizzleMetaConnectionRepository } from "@/connectors/meta/connection-drizzle-repository";
import { DrizzleEnvironmentMetaSecretRepository } from "@/connectors/meta/environment-secret-drizzle-repository";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import * as schema from "@/db/schema";

type Database=NodePgDatabase<typeof schema>;
type Account=Readonly<{id?:string;name?:string;currency?:string;timezone_name?:string;account_status?:number|string}>;
const ACCOUNT=/^act_[0-9]{1,32}$/;
export class MetaReadBootstrapError extends Error { constructor(readonly code:"invalid_input"|"connection_unavailable"|"account_unavailable"){super(code);} }
/** Server-private, GET-only root materializer for a pre-authorized read-only connection. */
export async function bootstrapMetaReadMirror(input:Readonly<{database:Database;workspaceId:string;actorId:string;connectionId:string;environment?:Record<string,string|undefined>}>) {
  const environment=input.environment??process.env; const connections=new DrizzleMetaConnectionRepository(input.database); const secrets=new DrizzleEnvironmentMetaSecretRepository(input.database,environment);
  const service=new MetaConnectionService({memberships:[{workspaceId:input.workspaceId,userId:input.actorId,role:"owner"}],connections,secrets,audit:new AppendOnlyAuditLog(),tokenSecurityStatus:()=>environment.META_TOKEN_SECURITY_STATUS});
  let connection; try { connection=await service.doctor({userId:input.actorId},input.workspaceId,input.connectionId); } catch { throw new MetaReadBootstrapError("connection_unavailable"); }
  if(connection.status!=="active"||connection.accessMode!=="read_only")throw new MetaReadBootstrapError("connection_unavailable");
  const privateConnection=await connections.find(input.workspaceId,input.connectionId); const token=await secrets.resolve(privateConnection.secretReference,{workspaceId:input.workspaceId,connectionId:input.connectionId});
  const records=await new MetaGraphClient(token).listAll<Account>("/me/adaccounts",{fields:"id,name,currency,timezone_name,account_status",limit:"100"});
  const accounts=records.filter((value):value is Required<Pick<Account,"id">>&Account=>typeof value.id==="string"&&ACCOUNT.test(value.id));
  if(!accounts.length||accounts.length>1000)throw new MetaReadBootstrapError("account_unavailable");
  const now=new Date();
  await input.database.transaction(async(tx)=>{ for(const account of accounts){ const source=await tx.insert(schema.dataSources).values({workspaceId:input.workspaceId,metaConnectionId:input.connectionId,platform:"meta_ads",externalAccountId:account.id,displayName:account.name?.slice(0,250)||"Meta Ads"}).onConflictDoUpdate({target:[schema.dataSources.workspaceId,schema.dataSources.platform,schema.dataSources.externalAccountId],set:{metaConnectionId:input.connectionId,displayName:account.name?.slice(0,250)||"Meta Ads",lastSyncedAt:now}}).returning({id:schema.dataSources.id}); const sourceId=source[0]?.id; if(!sourceId)throw new MetaReadBootstrapError("account_unavailable"); const hash=createHash("sha256").update(JSON.stringify(account)).digest("hex"); await tx.insert(schema.adAccounts).values({workspaceId:input.workspaceId,dataSourceId:sourceId,externalAccountId:account.id,name:account.name?.slice(0,250)||"Meta Ads",currency:/^[A-Z]{3}$/.test(account.currency??"")?account.currency!:"UNK",timezone:account.timezone_name?.slice(0,100)||"Etc/UTC",accountStatus:account.account_status===undefined?null:String(account.account_status),fetchedAt:now,rawPayloadHash:hash,sourceGraphVersion:"v23.0",fieldCatalogVersion:"meta-read-bootstrap/1.0.0",provenance:{source:"meta_read_bootstrap",sourcePriority:10},firstSeenAt:now,lastSeenAt:now}).onConflictDoUpdate({target:[schema.adAccounts.dataSourceId,schema.adAccounts.externalAccountId],set:{name:account.name?.slice(0,250)||"Meta Ads",currency:/^[A-Z]{3}$/.test(account.currency??"")?account.currency!:"UNK",timezone:account.timezone_name?.slice(0,100)||"Etc/UTC",accountStatus:account.account_status===undefined?null:String(account.account_status),fetchedAt:now,rawPayloadHash:hash,sourceGraphVersion:"v23.0",fieldCatalogVersion:"meta-read-bootstrap/1.0.0",provenance:{source:"meta_read_bootstrap",sourcePriority:10},lastSeenAt:now,disappearedAt:null}}); } });
  return Object.freeze({status:"ready" as const,accounts:accounts.length,readNetworkCalls:2,writeNetworkCalls:0});
}
