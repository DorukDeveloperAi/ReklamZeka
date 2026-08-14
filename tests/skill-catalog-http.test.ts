import { describe, expect, it, vi } from "vitest";

import { createSkillCatalogHttpHandlers } from "@/server/skill-catalog-http";

const principal = { actor: { userId: "u" }, workspaceId: "w", workspaceRef: "workspace_x", readerRef: "reader_x" };
const service = { list: vi.fn(async () => ({ contractVersion: "skill-catalog-ui/1.0.0", playbooks: [{ kind: "playbook", ref: "playbook_alpha", revision: 1, state: "active", title: "T", body: "private snippet", sourceRef: "source_x" }] })),
  select: vi.fn(async () => ({ ok: true })), create: vi.fn(async () => ({ ok: true })), revise: vi.fn(async () => ({ ok: true })), tombstone: vi.fn(async () => ({ ok: true })) } as never;
const request = (method: "GET" | "POST", intent: string, body?: unknown) => new Request("https://local.test/api/skill-catalog", { method,
  headers: { cookie: "x", origin: "https://local.test", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent,
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("skill catalog http boundary", () => {
  it("reads only through same-origin cookie session and strips snippet bodies from the Agent projection", async () => {
    const handlers = createSkillCatalogHttpHandlers({ service, resolve: async () => principal });
    expect((await handlers.GET(request("GET", "skill-catalog-read"))).status).toBe(200);
    const agent = await (await handlers.GET(request("GET", "skill-catalog-agent-read"))).json();
    expect(JSON.stringify(agent)).not.toContain("private snippet");
    expect((await handlers.GET(new Request("https://local.test"))).status).toBe(400);
  });

  it("allows only explicit user create/revise intents and requires revision confirmation without opening action authority", async () => {
    const handlers = createSkillCatalogHttpHandlers({ service, resolve: async () => principal });
    const create = await handlers.POST(request("POST", "skill-playbook-create", { title: "t", body: "b", sourceRef: "source_x" }));
    expect(create.status).toBe(201); expect(await create.json()).toMatchObject({ authority: { canWriteMeta: false, canApprove: false, canExecute: false } });
    expect((await handlers.POST(request("POST", "skill-playbook-revise", { playbookRef: "playbook_alpha", expectedRevision: 1, title: "t", body: "b", sourceRef: "source_x" }))).status).toBe(400);
    expect((await handlers.POST(request("POST", "skill-playbook-revise", { playbookRef: "playbook_alpha", expectedRevision: 1, title: "t", body: "b", sourceRef: "source_x", confirmed: true }))).status).toBe(201);
    expect((await handlers.POST(request("POST", "agent-write", {}))).status).toBe(400);
  });
});
