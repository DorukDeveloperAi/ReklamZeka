import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  PromotionTemplateAuthoringError,
  type PromotionTemplateAuthoringSelection,
  type PromotionTemplateAuthoringService,
} from "@/application/promotion-template-authoring";
import { PromotionTemplateSelectorError } from "@/domain/meta/promotion/promotion-template-selector";
import { AuthorizationError } from "@/security/authorization";
import { hasTrustedFrameworkForwarding } from "@/server/local-decision-room-runtime";

const MAX_BODY = 2_048;
const CALLER_SCOPE_HEADERS = [
  "authorization", "x-workspace-id", "x-workspace-ref", "x-user-id", "x-account-id", "x-actor-id", "x-meta-account-id",
] as const;
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "promotion-template-dry-run",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const AUTHORITY = Object.freeze({ canPersistDraft: false, canPublish: false, canWriteMeta: false,
  canChangeTargeting: false, canGenerateCreative: false, canProposeAction: false, canGrantApproval: false });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}

function fail(): never {
  throw new PromotionTemplateAuthoringError("invalid_input");
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail();
}

function requestShape(request: Request, origin: string, method: "GET" | "POST", intent: string): void {
  let url: URL;
  let configured: URL;
  try { url = new URL(request.url); configured = new URL(origin); } catch { return fail(); }
  const requestOrigin = request.headers.get("origin");
  if (request.method !== method || url.origin !== configured.origin || url.pathname !== "/api/promotion-template-authoring"
    || url.search || url.hash || request.headers.get("host") !== configured.host
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || !hasTrustedFrameworkForwarding(request, configured.origin)
    || !request.headers.get("cookie") || CALLER_SCOPE_HEADERS.some((header) => request.headers.has(header))
    || request.headers.get("x-reklamzeka-intent") !== intent
    || method === "GET" && requestOrigin !== null && requestOrigin !== configured.origin
    || method === "POST" && (requestOrigin !== configured.origin
      || request.headers.get("content-type")?.toLowerCase() !== "application/json"
      || request.headers.has("transfer-encoding"))) fail();
}

async function body(request: Request): Promise<PromotionTemplateAuthoringSelection> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > MAX_BODY)) fail();
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return fail(); }
  exact(parsed, ["selection"]);
  exact(parsed.selection, ["scopeRef", "postType", "instruction"]);
  return parsed.selection as unknown as PromotionTemplateAuthoringSelection;
}

function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof PromotionTemplateAuthoringError) {
    if (reason.code === "catalog_integrity_rejected") {
      return error("unsafe_source", "Yayınlanmış şablon kataloğunun bütünlüğü doğrulanamadı.", 422);
    }
    return error("invalid_input", "PromotionTemplate authoring isteği geçersiz.", 400);
  }
  if (reason instanceof PromotionTemplateSelectorError) {
    return error(reason.code === "invalid_input" ? "invalid_input" : "unsafe_source",
      reason.code === "invalid_input" ? "PromotionTemplate dry-run isteği geçersiz."
        : "Yayınlanmış şablon kataloğunun bütünlüğü doğrulanamadı.", reason.code === "invalid_input" ? 400 : 422);
  }
  return error("unavailable", "PromotionTemplate authoring kataloğu şu anda kullanılamıyor.", 503);
}

export function promotionTemplateAuthoringNotConfiguredResponse() {
  return error("source_not_configured", "PromotionTemplate authoring yerel çalışma alanına henüz bağlanmadı.", 503);
}

export function createPromotionTemplateAuthoringHttpHandlers(input: Readonly<{
  service: Pick<PromotionTemplateAuthoringService, "inspect" | "dryRun">;
  origin: string;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
  now?(): string;
}>) {
  const now = input.now ?? (() => new Date().toISOString());
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        requestShape(request, input.origin, "GET", "promotion-template-authoring-read");
        const principal = await input.resolvePrincipal(request);
        if (!principal) throw new AuthorizationError();
        return NextResponse.json(await input.service.inspect(principal, now()), { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    POST: async (request: Request) => {
      try {
        requestShape(request, input.origin, "POST", "promotion-template-authoring-dry-run");
        const command = await body(request);
        const principal = await input.resolvePrincipal(request);
        if (!principal) throw new AuthorizationError();
        return NextResponse.json(await input.service.dryRun(principal, command, now()), { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
}
