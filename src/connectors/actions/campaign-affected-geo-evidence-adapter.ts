import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuthenticAffectedGeoEvidencePort, ProtectionEvidenceScope } from "@/application/existing-post-promotion-protection-evidence-materializer";
import { DrizzleMetaAffectedGeoSnapshotRepository, type MetaAffectedGeoSnapshotExactScope } from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import type { CanonicalAffectedGeoCountrySnapshot } from "@/domain/meta/affected-geo-country-snapshot";
import * as schema from "@/db/schema";
type Database=NodePgDatabase<typeof schema>; type ReadDatabase=Pick<Database,"execute"|"transaction">;
type Row=Readonly<Record<string,unknown>>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,REF=/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/,HASH=/^[a-f0-9]{64}$/;
const rows=(value:unknown):readonly Row[]=>value&&typeof value==="object"&&"rows" in value&&Array.isArray(value.rows)?value.rows as readonly Row[]:[];
const iso=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
type SnapshotReader=Readonly<{resolveExactReadOnly(scope:MetaAffectedGeoSnapshotExactScope):Promise<CanonicalAffectedGeoCountrySnapshot>}>;

/** Complete campaign aggregate: every live ad set must contribute one exact snapshot. */
export class DrizzleCampaignAffectedGeoEvidenceAdapter implements AuthenticAffectedGeoEvidencePort {
 constructor(private readonly database:ReadDatabase,private readonly workspaceId:string,private readonly workspaceRef:string,private readonly reader:SnapshotReader=new DrizzleMetaAffectedGeoSnapshotRepository(database,workspaceId)){
  if(!UUID.test(workspaceId)||!REF.test(workspaceRef))throw new Error("invalid_campaign_geo_binding");
 }
 async resolveCandidates(scope:ProtectionEvidenceScope):Promise<readonly unknown[]>{
  if(scope.workspaceId!==this.workspaceId||scope.workspaceRef!==this.workspaceRef||scope.entity.level!=="campaign"||scope.entity.ref!==scope.campaignRef||!REF.test(scope.accountRef)||!REF.test(scope.campaignRef)||!iso(scope.notBefore)||!iso(scope.evaluatedAt)||scope.notBefore>scope.evaluatedAt)return [];
  const found=rows(await this.database.execute(sql`
   select a.id::text ad_account_id,a.external_account_id account_ref,c.id::text campaign_id,c.external_campaign_id campaign_ref,
    s.id::text ad_set_id,s.external_ad_set_id ad_set_ref,to_char(snapshot.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') captured_at,
    snapshot.workspace_ref,snapshot.source_graph_version,snapshot.field_catalog_version,snapshot.raw_payload_hash,snapshot.source_geo_subtree_hash,snapshot.snapshot_hash
   from workspaces w join ad_accounts a on a.workspace_id=w.id and a.external_account_id=${scope.accountRef} and a.disappeared_at is null
   join ad_campaigns c on c.workspace_id=w.id and c.ad_account_id=a.id and c.external_campaign_id=${scope.campaignRef} and c.disappeared_at is null
   join meta_ad_sets s on s.workspace_id=w.id and s.ad_account_id=a.id and s.campaign_id=c.id and s.disappeared_at is null
   left join lateral(select x.* from meta_affected_geo_snapshots x where x.workspace_id=w.id and x.ad_account_id=a.id and x.campaign_id=c.id and x.ad_set_id=s.id and x.captured_at>=${scope.notBefore}::timestamptz and x.captured_at<=${scope.evaluatedAt}::timestamptz order by x.captured_at desc,x.id desc limit 1) snapshot on true
   where w.id=${this.workspaceId}::uuid and w.lifecycle_state='active' and w.tombstoned_at is null order by s.id limit 501
  `));
  if(found.length===0||found.length>500)return [];
  const geoRefs=new Set<string>(),sourceRevisions:Readonly<{sourceRef:string;revision:number;sourceHash:string}>[]=[];let aggregateCapturedAt=scope.notBefore;
  for(const row of found){
   if(typeof row.ad_account_id!=="string"||!UUID.test(row.ad_account_id)||typeof row.campaign_id!=="string"||!UUID.test(row.campaign_id)||typeof row.ad_set_id!=="string"||!UUID.test(row.ad_set_id)||row.account_ref!==scope.accountRef||row.campaign_ref!==scope.campaignRef||typeof row.ad_set_ref!=="string"||!REF.test(row.ad_set_ref)||row.workspace_ref!==this.workspaceRef||!iso(row.captured_at)||typeof row.source_graph_version!=="string"||typeof row.field_catalog_version!=="string"||typeof row.raw_payload_hash!=="string"||!HASH.test(row.raw_payload_hash)||typeof row.source_geo_subtree_hash!=="string"||!HASH.test(row.source_geo_subtree_hash)||typeof row.snapshot_hash!=="string"||!HASH.test(row.snapshot_hash))return [];
   const identity=Object.freeze({workspaceId:this.workspaceId,workspaceRef:this.workspaceRef,adAccountId:row.ad_account_id,accountRef:scope.accountRef,campaignId:row.campaign_id,campaignRef:scope.campaignRef,adSetId:row.ad_set_id,adSetRef:row.ad_set_ref,capturedAt:row.captured_at,sourceGraphVersion:row.source_graph_version,fieldCatalogVersion:row.field_catalog_version,rawPayloadHash:row.raw_payload_hash,sourceGeoSubtreeHash:row.source_geo_subtree_hash,snapshotHash:row.snapshot_hash}) as MetaAffectedGeoSnapshotExactScope;
   let snapshot:CanonicalAffectedGeoCountrySnapshot;try{snapshot=await this.reader.resolveExactReadOnly(identity);}catch{return [];}
   if(snapshot.snapshotHash!==identity.snapshotHash||snapshot.capturedAt!==identity.capturedAt||snapshot.scope.adSetRef!==identity.adSetRef||snapshot.status!=="known"||snapshot.items.length===0)return [];
   snapshot.items.forEach((item)=>geoRefs.add(item.geoRef));if(geoRefs.size>500)return [];
   sourceRevisions.push(Object.freeze({sourceRef:`affected_geo_adset_${digest({adSetRef:identity.adSetRef,snapshotHash:identity.snapshotHash}).slice(0,20)}`,revision:1,sourceHash:identity.snapshotHash}));
   if(identity.capturedAt>aggregateCapturedAt)aggregateCapturedAt=identity.capturedAt;
  }
  const refs=Object.freeze([...geoRefs].sort());const revisions=Object.freeze(sourceRevisions.sort((a,b)=>a.sourceRef.localeCompare(b.sourceRef)));
  if(refs.length===0||refs.length>500||new Set(revisions.map((item)=>item.sourceRef)).size!==revisions.length)return [];
  return Object.freeze([Object.freeze({sourceKind:"canonical_meta_affected_geo_snapshot" as const,workspaceId:this.workspaceId,workspaceRef:this.workspaceRef,accountRef:scope.accountRef,campaignRef:scope.campaignRef,entity:Object.freeze({...scope.entity}),capturedAt:aggregateCapturedAt,geoRefs:refs,sourceRevisions:revisions})]);
 }
}
