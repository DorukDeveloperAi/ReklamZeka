import { createHash, randomBytes } from "node:crypto";
import { CORE_SKILL_MANIFESTS, CLOSED_SKILL_AUTHORITY } from "@/domain/orchestrator/skill-catalog";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

export type SkillCatalogRepository = Readonly<{
  list(workspaceId: string): Promise<readonly Record<string, unknown>[]>;
  appendProfile(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  appendPlaybook(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}>;
const h=(value: unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ref=(kind:string)=>`${kind}_${randomBytes(12).toString("hex")}`;
export class SkillCatalogService {
  constructor(private readonly repository: SkillCatalogRepository, private readonly memberships: readonly WorkspaceMembership[]) {}
  async list(principal: TrustedDecisionRoomPrincipal) { const member=authorizeWorkspace(principal.actor,principal.workspaceId,"guidance:read",this.memberships); const rows=await this.repository.list(principal.workspaceId); return Object.freeze({ contractVersion:"skill-catalog-ui/1.0.0", activeProfile:rows.find((x)=>x.kind==="profile")??null, playbooks:rows.filter((x)=>x.kind==="playbook"), skills:CORE_SKILL_MANIFESTS.map(({ref,name,version,hash,lifecycle,citationRequired,negativeCapabilities})=>Object.freeze({ref,name,version,hash,lifecycle,citationRequired,negativeCapabilities})), authority:Object.freeze({canSelectProfile:member.role!=="viewer",canCreatePlaybookRevision:member.role!=="viewer",canTombstonePlaybook:member.role!=="viewer",...CLOSED_SKILL_AUTHORITY}) }); }
  async selectProfile(principal: TrustedDecisionRoomPrincipal, corePack: readonly Readonly<{ref:string;version:string;hash:string}>[]) { const member=authorizeWorkspace(principal.actor,principal.workspaceId,"guidance:draft",this.memberships); if(member.role==="viewer"||corePack.length!==9||corePack.some((x)=>!CORE_SKILL_MANIFESTS.some((m)=>m.ref===x.ref&&m.version===x.version&&m.hash===x.hash))) throw new Error("invalid_input"); const payload={corePack}; return this.repository.appendProfile({workspaceId:principal.workspaceId,actorId:principal.actor.userId,profileRef:"profile_default",payload,hash:h(payload),ref:ref("profile")}); }
  async createPlaybook(principal: TrustedDecisionRoomPrincipal, input: Readonly<{title:string;body:string;sourceRef:string}>) { const member=authorizeWorkspace(principal.actor,principal.workspaceId,"guidance:draft",this.memberships); if(member.role==="viewer"||!input.title.trim()||!input.body.trim()||/(policy|rule|scope|approve|execute)/i.test("")&&!/^[a-z][a-z0-9_.:-]{1,126}$/.test(input.sourceRef)) throw new Error("invalid_input"); const payload={title:input.title.trim(),body:input.body.trim()}; return this.repository.appendPlaybook({workspaceId:principal.workspaceId,actorId:principal.actor.userId,sourceRef:input.sourceRef,payload,hash:h(payload),ref:ref("playbook")}); }
}
