import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { NamingTemplateError, replayNamingTemplate, type NamingEvidenceKind, type NamingReplayInput, type NamingTemplateReplayResult, type NamingTemplateRevision } from "@/domain/campaigns/naming-template";
import { metaPublicReference } from "@/domain/meta/public-reference";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENTITY=/^(?:campaign|ad_set)_[a-f0-9]{24}$/;
const rows=(value:unknown):Row[]=>value&&typeof value==="object"&&"rows" in value&&Array.isArray(value.rows)?value.rows as Row[]:(()=>{throw new NamingTemplateError("corrupt_template")})();
const text=(row:Row,key:string):string=>typeof row[key]==="string"&&row[key]?row[key] as string:(()=>{throw new NamingTemplateError("corrupt_template")})();
const optional=(value:unknown):string|null=>typeof value==="string"&&value?value:null;
const evidenceRef=(kind:string,parts:unknown)=>`${kind}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0,24)}`;
const normalized=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,64);
const KINDS:readonly NamingEvidenceKind[]=["objective","optimization","geo","targeting","platform","creative","cta","destination"];

export class DrizzleNamingTemplateReplayEvidenceRepository {
  constructor(private readonly database:Pick<Database,"transaction">){}
  async replay(input:Readonly<{workspaceId:string;template:NamingTemplateRevision;entityRef:string}>):Promise<NamingTemplateReplayResult>{
    if(!UUID.test(input.workspaceId)||!ENTITY.test(input.entityRef)||input.template.workspaceRef!==`workspace_${createHash("sha256").update(input.workspaceId).digest("hex").slice(0,24)}`) throw new NamingTemplateError("invalid_scope");
    return this.database.transaction(async tx=>{
      await tx.execute(sql`set local transaction isolation level repeatable read`); await tx.execute(sql`set local transaction read only`);
      const accounts=rows(await tx.execute(sql`select id::text from ad_accounts where workspace_id=${input.workspaceId}::uuid and disappeared_at is null order by id limit 1001`));
      if(accounts.length>1000) throw new NamingTemplateError("invalid_scope");
      const accountIds=accounts.map(row=>text(row,"id")).filter(id=>metaPublicReference("account",input.workspaceId,id)===input.template.accountRef);
      if(accountIds.length!==1) throw new NamingTemplateError("invalid_scope"); const accountId=accountIds[0]!;
      const entityRows=input.template.entityLevel==="campaign"
        ? rows(await tx.execute(sql`select c.id::text entity_id,c.id::text campaign_id,c.name campaign_name,null::text ad_set_name,c.canonical_objective objective,null::text optimization,c.raw_payload_hash campaign_hash,null::text ad_set_hash from ad_campaigns c where c.workspace_id=${input.workspaceId}::uuid and c.ad_account_id=${accountId}::uuid and c.disappeared_at is null order by c.id limit 1001`))
        : rows(await tx.execute(sql`select s.id::text entity_id,c.id::text campaign_id,c.name campaign_name,s.name ad_set_name,c.canonical_objective objective,s.optimization_goal optimization,c.raw_payload_hash campaign_hash,s.raw_payload_hash ad_set_hash from meta_ad_sets s join ad_campaigns c on c.workspace_id=s.workspace_id and c.id=s.campaign_id and c.disappeared_at is null where s.workspace_id=${input.workspaceId}::uuid and c.ad_account_id=${accountId}::uuid and s.disappeared_at is null order by s.id limit 1001`));
      if(entityRows.length>1000) throw new NamingTemplateError("invalid_scope");
      const matches=entityRows.filter(row=>metaPublicReference(input.template.entityLevel,input.workspaceId,text(row,"entity_id"))===input.entityRef);
      if(matches.length!==1) throw new NamingTemplateError("invalid_scope"); const entity=matches[0]!;
      const campaignId=text(entity,"campaign_id"), entityId=text(entity,"entity_id");
      const assignmentRows=rows(await tx.execute(sql`select a.id::text,d.key dimension_key,v.key definition_key,a.manual_lock from category_assignments a join category_dimensions d on d.workspace_id=a.workspace_id and d.id=a.dimension_id and d.archived_at is null join category_definitions v on v.workspace_id=a.workspace_id and v.id=a.definition_id and v.dimension_id=a.dimension_id and v.archived_at is null where a.workspace_id=${input.workspaceId}::uuid and a.archived_at is null and a.operation in('add','override') and ((a.entity_level='campaign' and a.campaign_id=${campaignId}::uuid) or (a.entity_level='ad_set' and a.ad_set_id=${input.template.entityLevel==="ad_set"?entityId:null}::uuid)) order by a.dimension_id,a.entity_level,a.id limit 65`));
      if(assignmentRows.length>64) throw new NamingTemplateError("invalid_scope");
      const known:Partial<Record<NamingEvidenceKind,string[]>>={platform:["meta_ads"]};
      const objective=optional(entity.objective), optimization=optional(entity.optimization);
      if(objective&&normalized(objective)) known.objective=[normalized(objective)];
      if(optimization&&normalized(optimization)) known.optimization=[normalized(optimization)];
      const evidence=KINDS.map(kind=>Object.freeze({kind,state:known[kind]?.length?"known" as const:"missing" as const,values:Object.freeze(known[kind]??[]),evidenceRef:evidenceRef(`naming_${kind}`,{workspaceId:input.workspaceId,entityRef:input.entityRef,kind,value:known[kind]??null,source:kind==="objective"?entity.campaign_hash:kind==="optimization"?entity.ad_set_hash:"canonical_meta_mirror"})}));
      const currentAssignments=assignmentRows.map(row=>Object.freeze({dimensionRef:categoryDimensionPublicRef(text(row,"dimension_key")),definitionRef:categoryDefinitionPublicRef(text(row,"dimension_key"),text(row,"definition_key")),manualLock:row.manual_lock===true,evidenceRef:evidenceRef("category_assignment",{workspaceId:input.workspaceId,id:text(row,"id")})}));
      const replayInput:NamingReplayInput=Object.freeze({workspaceRef:input.template.workspaceRef,accountRef:input.template.accountRef,entityLevel:input.template.entityLevel,entityRef:input.entityRef,
        names:Object.freeze({campaign:Object.freeze({value:text(entity,"campaign_name"),evidenceRef:evidenceRef("campaign_name",{id:campaignId,hash:entity.campaign_hash})}),adSet:input.template.entityLevel==="ad_set"?Object.freeze({value:text(entity,"ad_set_name"),evidenceRef:evidenceRef("ad_set_name",{id:entityId,hash:entity.ad_set_hash})}):null}),
        evidence:Object.freeze(evidence),currentAssignments:Object.freeze(currentAssignments)});
      return replayNamingTemplate(input.template,replayInput);
    });
  }
}
