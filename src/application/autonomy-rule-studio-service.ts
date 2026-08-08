import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { createAutonomyRuleDraft, type AutonomyRuleArtifact, type AutonomyRuleDraftInput } from "@/domain/actions/autonomy-rule-registry";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const AUTONOMY_RULE_STUDIO_VERSION = "autonomy-rule-studio/1.0.0" as const;
export type AutonomyRuleDraftScope = Readonly<{ level: "workspace" }>
  | Exclude<AutonomyRuleDraftInput["scope"], Readonly<{ level: "workspace"; ref: string }>>;
export type AutonomyRuleDraftRequest = Readonly<{
  ruleRef: string; scope: AutonomyRuleDraftScope; mode: AutonomyRuleDraftInput["mode"];
  effective: string; expires: string | null; killSwitch: boolean; maxActions: number | null;
  sourceGuidanceRefs: readonly string[];
}>;
export type PublicAutonomyRuleRevision = Readonly<{
  ruleRef: string; revision: number; scope: AutonomyRuleArtifact["scope"]; mode: AutonomyRuleArtifact["mode"];
  state: AutonomyRuleArtifact["state"]; effective: string; expires: string | null; killSwitch: boolean;
  maxActions: number | null; provenance: Readonly<{ normalizedByRole: string; sourceGuidanceRefs: readonly string[]; publishedByRole: string | null }>;
}>;
const AUTHORITY = Object.freeze({ canPublish: false as const, canDisable: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const });
export type AutonomyRuleStudioResult = Readonly<{ contractVersion: typeof AUTONOMY_RULE_STUDIO_VERSION;
  items: readonly PublicAutonomyRuleRevision[]; authority: typeof AUTHORITY }>;
export type AutonomyRuleStudioRepository = Readonly<{
  listArtifacts(): Promise<readonly AutonomyRuleArtifact[]>;
  latestArtifact(ruleRef: string): Promise<AutonomyRuleArtifact | null>;
  append(artifact: AutonomyRuleArtifact): Promise<unknown>;
}>;

function project(artifact: AutonomyRuleArtifact): PublicAutonomyRuleRevision {
  return Object.freeze({ ruleRef: artifact.ruleRef, revision: artifact.revision, scope: Object.freeze({ ...artifact.scope }),
    mode: artifact.mode, state: artifact.state, effective: artifact.effectiveFrom, expires: artifact.expiresAt,
    killSwitch: artifact.killSwitch, maxActions: artifact.maximumActionsPerRun,
    provenance: Object.freeze({ normalizedByRole: artifact.provenance.normalizedByRole,
      sourceGuidanceRefs: Object.freeze([...artifact.provenance.sourceGuidanceRefs]), publishedByRole: artifact.provenance.publishedByRole }) });
}
export class AutonomyRuleStudioService {
  constructor(private readonly repository: AutonomyRuleStudioRepository, private readonly memberships: readonly WorkspaceMembership[]) {}
  async list(principal: TrustedDecisionRoomPrincipal): Promise<AutonomyRuleStudioResult> {
    authorizeWorkspace(principal.actor, principal.workspaceId, "autonomy_rules:read", this.memberships);
    const artifacts = await this.repository.listArtifacts();
    return Object.freeze({ contractVersion: AUTONOMY_RULE_STUDIO_VERSION,
      items: Object.freeze(artifacts.map(project)), authority: AUTHORITY });
  }
  async createDraft(principal: TrustedDecisionRoomPrincipal, request: AutonomyRuleDraftRequest): Promise<Readonly<{
    contractVersion: typeof AUTONOMY_RULE_STUDIO_VERSION; item: PublicAutonomyRuleRevision; authority: typeof AUTHORITY;
  }>> {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "autonomy_rules:draft", this.memberships);
    const latest = await this.repository.latestArtifact(request.ruleRef);
    const artifact = createAutonomyRuleDraft({ ruleRef: request.ruleRef, revision: (latest?.revision ?? 0) + 1,
      workspaceRef: principal.workspaceRef, scope: request.scope.level === "workspace"
        ? { level: "workspace", ref: principal.workspaceRef } : request.scope, mode: request.mode,
      effectiveFrom: request.effective, expiresAt: request.expires, killSwitch: request.killSwitch,
      maximumActionsPerRun: request.maxActions, normalizedBy: { actorRef: principal.readerRef, role: membership.role as "owner" | "admin" | "analyst" },
      sourceGuidanceRefs: request.sourceGuidanceRefs });
    await this.repository.append(artifact);
    return Object.freeze({ contractVersion: AUTONOMY_RULE_STUDIO_VERSION, item: project(artifact), authority: AUTHORITY });
  }
}
