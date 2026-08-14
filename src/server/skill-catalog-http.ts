import { NextResponse } from "next/server";

import { SkillCatalogService } from "@/application/skill-catalog-service";

const headers = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const closed = Object.freeze({ canWriteMeta: false, canApprove: false, canExecute: false });
const fail = (status: number, code: string) => NextResponse.json({ error: { code }, authority: closed }, { status, headers });
const intents = ["skill-profile-select", "skill-playbook-create", "skill-playbook-revise", "skill-playbook-tombstone"] as const;
const readIntents = ["skill-catalog-read", "skill-catalog-agent-read"] as const;

function valid(request: Request, method: "GET" | "POST", intent: string) {
  if (request.method !== method || request.headers.get("x-reklamzeka-intent") !== intent || !request.headers.get("cookie")
    || request.headers.get("authorization") !== null || request.headers.get("sec-fetch-site") !== "same-origin") return false;
  if (method === "POST") {
    if (request.headers.get("content-type")?.toLowerCase() !== "application/json") return false;
    const origin = request.headers.get("origin");
    try { return !!origin && new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
  }
  return true;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function conflict(error: unknown): string | null {
  const code = error instanceof Error ? error.message : "";
  return ["source_not_found", "source_mismatch", "playbook_not_found", "stale_head", "duplicate_revision", "write_conflict"].includes(code) ? code : null;
}

export function createSkillCatalogHttpHandlers(input: Readonly<{
  service: SkillCatalogService;
  resolve(request: Request, operation: "read" | "draft"): Promise<unknown>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        const intent = request.headers.get("x-reklamzeka-intent");
        if (!readIntents.includes(intent as typeof readIntents[number]) || !valid(request, "GET", intent!)) return fail(400, "invalid_input");
        const catalog = await input.service.list(await input.resolve(request, "read") as never);
        const projection = intent === "skill-catalog-agent-read" ? { ...catalog,
          playbooks: catalog.playbooks.map(({ kind, ref, revision, state, title, url, freshness }) => ({ kind, ref, revision, state, title, url, freshness })) } : catalog;
        return NextResponse.json(projection, { headers });
      } catch { return fail(401, "local_session_required"); }
    },
    POST: async (request: Request) => {
      try {
        const intent = request.headers.get("x-reklamzeka-intent");
        if (!intents.includes(intent as typeof intents[number]) || !valid(request, "POST", intent!)) return fail(400, "invalid_input");
        const principal = await input.resolve(request, "draft") as never;
        const body = await request.json() as unknown;
        const result = intent === "skill-profile-select" && exact(body, ["corePack"])
          ? await input.service.select(principal, body.corePack as never)
          : intent === "skill-playbook-create" && exact(body, ["title", "body", "sourceRef"])
            ? await input.service.create(principal, body as never)
            : intent === "skill-playbook-revise" && exact(body, ["playbookRef", "expectedRevision", "title", "body", "sourceRef", "confirmed"]) && body.confirmed === true
              ? await input.service.revise(principal, body as never)
              : intent === "skill-playbook-tombstone" && exact(body, ["playbookRef"])
                ? await input.service.tombstone(principal, body.playbookRef as string)
                : null;
        return result === null ? fail(400, "invalid_input") : NextResponse.json({ result, authority: closed }, { status: 201, headers });
      } catch (error) { return fail(conflict(error) ? 409 : 403, conflict(error) ?? "forbidden"); }
    },
  });
}
