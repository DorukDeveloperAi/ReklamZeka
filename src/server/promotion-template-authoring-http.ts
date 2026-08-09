import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { PromotionTemplateLifecycleError } from "@/domain/meta/promotion/promotion-template-lifecycle";
import type { PromotionTemplateLifecycleCommand, PromotionTemplateLifecycleService } from
  "@/application/promotion-template-lifecycle-service";
import {
  PromotionTemplateAuthoringError,
  type PromotionTemplateAuthoringSelection,
  type PromotionTemplateAuthoringService,
} from "@/application/promotion-template-authoring";
import { PromotionTemplateSelectorError } from "@/domain/meta/promotion/promotion-template-selector";
import { AuthorizationError } from "@/security/authorization";
import { hasTrustedFrameworkForwarding } from "@/server/local-decision-room-runtime";

const MAX_BODY = 4_096;
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
  if (reason instanceof PromotionTemplateLifecycleError) {
    if (reason.code === "forbidden") return error("forbidden", "Lifecycle işlemi rol sınırı nedeniyle reddedildi.", 403);
    if (reason.code === "conflict") return error("conflict", "PromotionTemplate kaydı başka bir oturumda değişti.", 409);
    if (reason.code === "not_found") return error("not_found", "PromotionTemplate lifecycle kaydı bulunamadı.", 404);
    if (reason.code === "invalid_transition") return error("invalid_transition", "Lifecycle geçişi rol veya durum nedeniyle reddedildi.", 422);
    if (reason.code === "integrity_rejected") return error("unsafe_source", "PromotionTemplate lifecycle bütünlüğü doğrulanamadı.", 422);
    return error("invalid_input", "PromotionTemplate lifecycle isteği geçersiz.", 400);
  }
  return error("unavailable", "PromotionTemplate authoring kataloğu şu anda kullanılamıyor.", 503);
}

async function lifecycleBody(request: Request): Promise<PromotionTemplateLifecycleCommand> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]{0,4})$/.test(length) || Number(length) > MAX_BODY)) fail();
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return fail(); }
  exact(parsed, ["command"]);
  if (!parsed.command || typeof parsed.command !== "object" || Array.isArray(parsed.command)
    || typeof (parsed.command as { operation?: unknown }).operation !== "string") fail();
  const command = parsed.command as Record<string, unknown>;
  const operation = command.operation;
  const registry = ["operation", "expectedRegistryHash"];
  const presetOcc = [...registry, "presetRef", "expectedLifecycleVersion", "expectedRecordHash",
    "expectedPresetRevision", "expectedPresetHash"];
  const templateOcc = [...registry, "templateRef", "expectedLifecycleVersion", "expectedRecordHash",
    "expectedPresetRevision", "expectedPresetHash", "expectedTemplateRevision", "expectedTemplateHash"];
  if (operation === "create_preset_draft") exact(command, [...registry, "selection", "alias"]);
  else if (operation === "create_template_draft") exact(command, [...registry, "selection", "audiencePreset", "alias"]);
  else if (operation === "revise_preset_draft") exact(command, [...presetOcc, "alias"]);
  else if (operation === "revise_template_draft") exact(command, [...templateOcc, "audiencePreset", "alias"]);
  else if (operation === "publish_preset" || operation === "archive_preset") exact(command, [...presetOcc, "reasonCode"]);
  else if (operation === "publish_template" || operation === "archive_template") exact(command, [...templateOcc, "reasonCode"]);
  else fail();
  return command as unknown as PromotionTemplateLifecycleCommand;
}

export function createPromotionTemplateLifecycleHttpHandlers(input: Readonly<{
  service: Pick<PromotionTemplateLifecycleService, "inspect" | "mutate">;
  origin: string;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return Object.freeze({
    GET: async (request: Request) => {
      try {
        requestShape(request, input.origin, "GET", "promotion-template-lifecycle-read");
        const principal = await input.resolvePrincipal(request);
        if (!principal) throw new AuthorizationError();
        return NextResponse.json(await input.service.inspect(principal), { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
    POST: async (request: Request) => {
      try {
        const intent = request.headers.get("x-reklamzeka-intent");
        if (intent !== "promotion-template-lifecycle-draft" && intent !== "promotion-template-lifecycle-publish") fail();
        requestShape(request, input.origin, "POST", intent);
        const command = await lifecycleBody(request);
        const publication = command.operation.startsWith("publish_") || command.operation.startsWith("archive_");
        if (publication !== (intent === "promotion-template-lifecycle-publish")) fail();
        const principal = await input.resolvePrincipal(request);
        if (!principal) throw new AuthorizationError();
        return NextResponse.json(await input.service.mutate(principal, command), { headers: HEADERS });
      } catch (reason) { return failure(reason); }
    },
  });
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
