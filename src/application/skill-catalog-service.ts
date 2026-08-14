import { createHash, randomBytes } from "node:crypto";

import { CORE_SKILL_MANIFESTS, CLOSED_SKILL_AUTHORITY } from "@/domain/orchestrator/skill-catalog";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

export type CatalogItem = Readonly<{
  kind: "profile" | "playbook";
  ref: string;
  revision: number;
  state: string;
  title?: string;
  body?: string;
  sourceRef?: string;
  url?: string | null;
  freshness?: string;
}>;
export type PlaybookInput = Readonly<{ title: string; body: string; sourceRef: string }>;
export type SkillCatalogRepository = Readonly<{
  list(workspaceId: string): Promise<readonly CatalogItem[]>;
  appendProfile(input: Readonly<{ workspaceId: string; actorId: string; pack: unknown }>): Promise<CatalogItem>;
  appendPlaybook(input: Readonly<{ workspaceId: string; actorId: string } & PlaybookInput>): Promise<CatalogItem>;
  appendPlaybookRevision(input: Readonly<{ workspaceId: string; actorId: string; playbookRef: string; expectedRevision: number } & PlaybookInput>): Promise<CatalogItem>;
  tombstone(input: Readonly<{ workspaceId: string; actorId: string; ref: string }>): Promise<CatalogItem>;
}>;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const SOURCE_REF = /^source_[a-z0-9_.:-]{1,127}$/;
const PLAYBOOK_REF = /^playbook_[a-z0-9][a-z0-9_-]{0,86}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PRIVATE_IDENTIFIER = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})\b/i;

function playbookInput(value: PlaybookInput): PlaybookInput {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const body = typeof value?.body === "string" ? value.body.trim() : "";
  const sourceRef = typeof value?.sourceRef === "string" ? value.sourceRef.trim() : "";
  if (!title || title.length > 240 || CONTROL.test(title) || PRIVATE_IDENTIFIER.test(title) || !body || body.length > 16_000 || CONTROL.test(body) || PRIVATE_IDENTIFIER.test(body)
    || !SOURCE_REF.test(sourceRef)) throw new Error("invalid_input");
  return Object.freeze({ title, body, sourceRef });
}

/** User-owned catalog authoring only. It never derives policy, rule, approval, action, or Meta authority from text. */
export class SkillCatalogService {
  constructor(private readonly repo: SkillCatalogRepository, private readonly memberships: readonly WorkspaceMembership[]) {}

  async list(principal: TrustedDecisionRoomPrincipal) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:read", this.memberships);
    const items = await this.repo.list(principal.workspaceId);
    return Object.freeze({ contractVersion: "skill-catalog-ui/1.0.0", activeProfile: items.find((item) => item.kind === "profile") ?? null,
      playbooks: items.filter((item) => item.kind === "playbook"),
      skills: CORE_SKILL_MANIFESTS.map(({ ref, name, version, lifecycle, citationRequired, negativeCapabilities }) => ({ ref, name, version, lifecycle, citationRequired, negativeCapabilities })),
      authority: { canSelectProfile: membership.role !== "viewer", canCreatePlaybookRevision: membership.role !== "viewer",
        canTombstonePlaybook: membership.role !== "viewer", ...CLOSED_SKILL_AUTHORITY },
    });
  }

  async select(principal: TrustedDecisionRoomPrincipal, pack: readonly unknown[]) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    if (pack.length !== 9) throw new Error("invalid_input");
    return this.repo.appendProfile({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, pack });
  }

  async create(principal: TrustedDecisionRoomPrincipal, input: PlaybookInput) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    return this.repo.appendPlaybook({ ...playbookInput(input), workspaceId: principal.workspaceId, actorId: principal.actor.userId });
  }

  async revise(principal: TrustedDecisionRoomPrincipal, input: Readonly<{ playbookRef: string; expectedRevision: number } & PlaybookInput>) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    if (!PLAYBOOK_REF.test(input.playbookRef) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new Error("invalid_input");
    }
    return this.repo.appendPlaybookRevision({ ...playbookInput(input), playbookRef: input.playbookRef,
      expectedRevision: input.expectedRevision, workspaceId: principal.workspaceId, actorId: principal.actor.userId });
  }

  async tombstone(principal: TrustedDecisionRoomPrincipal, ref: string) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships);
    if (!PLAYBOOK_REF.test(ref)) throw new Error("invalid_input");
    return this.repo.tombstone({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, ref });
  }
}

export const catalogHash = hash;
export const newRef = () => `playbook_${randomBytes(12).toString("hex")}`;
