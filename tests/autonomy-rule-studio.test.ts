import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AutonomyRuleStudioService } from "@/application/autonomy-rule-studio-service";
import { AutonomyStudioPanel } from "@/app/dashboard/autonomy-studio-panel";
import { createAutonomyRuleDraft, publishAutonomyRule } from "@/domain/actions/autonomy-rule-registry";
import { createAutonomyRuleStudioHttpHandlers } from "@/server/autonomy-rule-studio-http";

const workspaceId = "11111111-1111-4111-a111-111111111111"; const workspaceRef = "workspace_alpha";
const principal = { actor: { userId: "user_one" }, workspaceId, workspaceRef, readerRef: "actor_local_user" } as const;
const input = { ruleRef: "autonomy_campaign_default", scope: { level: "campaign", ref: "campaign_public" } as const,
  mode: "approval_only" as const, effective: "2026-08-08T00:00:00.000Z", expires: null, killSwitch: false,
  maxActions: 2, sourceGuidanceRefs: ["guidance_safety"] };
function firstDraft() { return createAutonomyRuleDraft({ ruleRef: input.ruleRef, revision: 1, workspaceRef, scope: input.scope,
  mode: input.mode, effectiveFrom: input.effective, expiresAt: null, killSwitch: false, maximumActionsPerRun: 2,
  normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: input.sourceGuidanceRefs }); }

describe("Autonomy Rule Studio read + normalized draft", () => {
  it("projects every state without canonical hashes, actor refs or raw material", async () => {
    const draft = firstDraft(); const published = publishAutonomyRule({ draft, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_review", reasonRef: "reason_safe", publishedAt: "2026-08-07T12:00:00.000Z" });
    const service = new AutonomyRuleStudioService({ listArtifacts: async () => [draft, published], latestArtifact: async () => null, append: vi.fn() },
      [{ userId: principal.actor.userId, workspaceId, role: "viewer" }]);
    const result = await service.list(principal);
    expect(result.items.map((item) => item.state)).toEqual(["draft", "published"]);
    expect(JSON.stringify(result)).not.toMatch(/canonicalHash|actor_owner|decision_review|reason_safe|raw/i);
    expect(result.authority).toEqual({ canPublish: false, canDisable: false, canApprove: false, canExecute: false, canWriteMeta: false, canGrantApproval: false });
  });

  it("allocates the next revision from a multi-revision published rule and appends only a draft", async () => {
    const published = publishAutonomyRule({ draft: firstDraft(), actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_review", reasonRef: "reason_safe", publishedAt: "2026-08-07T12:00:00.000Z" });
    const append = vi.fn(); const service = new AutonomyRuleStudioService({ listArtifacts: async () => [], latestArtifact: async () => published, append },
      [{ userId: principal.actor.userId, workspaceId, role: "analyst" }]);
    const result = await service.createDraft(principal, { ...input, mode: "denied", killSwitch: true });
    expect(result.item).toMatchObject({ revision: 3, state: "draft", mode: "denied", killSwitch: true });
    expect(append.mock.calls[0]![0]).toMatchObject({ revision: 3, state: "draft", provenance: { normalizedByActorRef: principal.readerRef, normalizedByRole: "analyst" } });
  });

  it("injects workspace scope from the trusted principal rather than accepting it from the caller", async () => {
    const append = vi.fn(); const service = new AutonomyRuleStudioService({ listArtifacts: async () => [], latestArtifact: async () => null, append },
      [{ userId: principal.actor.userId, workspaceId, role: "owner" }]);
    await service.createDraft(principal, { ...input, scope: { level: "workspace" } });
    expect(append.mock.calls[0]![0]).toMatchObject({ workspaceRef, scope: { level: "workspace", ref: workspaceRef }, revision: 1 });
  });

  it("allows viewers to read but denies normalized draft creation", async () => {
    const service = new AutonomyRuleStudioService({ listArtifacts: async () => [], latestArtifact: vi.fn(), append: vi.fn() },
      [{ userId: principal.actor.userId, workspaceId, role: "viewer" }]);
    await expect(service.list(principal)).resolves.toMatchObject({ items: [] });
    await expect(service.createDraft(principal, input)).rejects.toMatchObject({ status: 403 });
  });

  it("accepts exact cookie-only intents and rejects client authority fields before service", async () => {
    const service = { list: vi.fn(async () => ({ contractVersion: "autonomy-rule-studio/1.0.0", items: [], authority: {} })), createDraft: vi.fn(async () => ({ item: {}, authority: {} })) };
    const handlers = createAutonomyRuleStudioHttpHandlers({ service: service as never, resolvePrincipal: async () => principal });
    const headers = { Host: "localhost:3000", Cookie: "__Host-rzka_local_session=opaque", Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "X-ReklamZeka-Intent": "autonomy-rule-create-draft" };
    const good = await handlers.POST(new Request("http://localhost:3000/api/autonomy-rules", { method: "POST", headers, body: JSON.stringify(input) }));
    expect(good.status).toBe(201);
    for (const body of [{ ...input, workspaceId }, { ...input, revision: 9 }, { ...input, role: "owner" }, { ...input, rawText: "publish this" }]) {
      expect((await handlers.POST(new Request("http://localhost:3000/api/autonomy-rules", { method: "POST", headers, body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect(service.createDraft).toHaveBeenCalledTimes(1);
    const headerPatches: Record<string, string>[] = [{ Authorization: "Bearer unsafe" }, { Cookie: "" }, { "X-Forwarded-For": "127.0.0.1" }, { "X-Workspace-Ref": workspaceRef }];
    for (const headersPatch of headerPatches) {
      const response = await handlers.POST(new Request("http://localhost:3000/api/autonomy-rules", { method: "POST", headers: { ...headers, ...headersPatch }, body: JSON.stringify(input) }));
      expect(response.status).toBe(400);
    }
  });

  it("renders no publish, disable, approval, execution or Meta action control", () => {
    const html = renderToStaticMarkup(createElement(AutonomyStudioPanel));
    expect(html).toContain("NO PUBLISH · NO META WRITE");
    expect(html).toContain("Serbest metin talimat ve guidance ayrı Guidance Registry");
    expect(html).not.toContain(">Yayınla<"); expect(html).not.toContain(">Disable<"); expect(html).not.toContain(">Onayla<");
  });
});
