import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { OrganizationCampaignService } from "@/application/organization-campaign-service";
import { OrganizationCampaignError } from "@/domain/campaigns/organization-campaign";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "organization-campaign-guarded", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canAuthorizeAction: false, canWriteMeta: false });
const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
export const organizationCampaignNotConfiguredResponse = () => fail(503, "source_not_configured", "Kurum Kampanyası kaynağı yerel çalışma alanına henüz bağlanmadı.");
export const organizationCampaignSessionRequiredResponse = () => fail(401, "local_session_required", "Kurum Kampanyası için yerel dashboard oturumunu bağlayın.");

function validShape(request: Request, method: "GET" | "POST") {
  const url = new URL(request.url); const origin = request.headers.get("origin");
  const originMatches = origin !== null && (() => { try { return new URL(origin).origin === url.origin; } catch { return false; } })();
  return request.method === method && (method === "GET" || !url.search) && [...url.searchParams.keys()].every((key) => key === "limit" || key === "cursor") && !request.headers.has("authorization") && Boolean(request.headers.get("cookie"))
    && !request.headers.has("x-workspace-id") && !request.headers.has("x-workspace-ref") && request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("x-reklamzeka-intent") === (method === "GET" ? "organization-campaign-read" : "organization-campaign-mutate")
    && (origin === null || originMatches) && (method === "GET" || originMatches && request.headers.get("content-type")?.toLowerCase() === "application/json");
}
async function command(request: Request) {
  const raw = await request.text(); if (Buffer.byteLength(raw) > 4096) throw new OrganizationCampaignError("invalid_input");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !("command" in parsed)) throw new OrganizationCampaignError("invalid_input");
  const value = (parsed as { command: unknown }).command;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OrganizationCampaignError("invalid_input");
  const record = value as Record<string, unknown>;
  const create = ["operation", "label", "marketDefinitionRef"]; const assign = ["operation", "organizationCampaignRef", "campaignRef", "effectiveFrom", "effectiveTo"]; const assignOptional = ["operation", "organizationCampaignRef", "campaignRef", "effectiveFrom"]; const close = ["operation", "membershipRef", "closeAt"];
  const allowed = record.operation === "create" ? create : record.operation === "assign" ? assign : record.operation === "close" ? close : null;
  const shape = record.operation === "assign" && Object.keys(record).length === assignOptional.length ? assignOptional : allowed;
  if (!shape || Object.keys(record).length !== shape.length || Object.keys(record).some((key) => !shape.includes(key))) throw new OrganizationCampaignError("invalid_input");
  return record;
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return fail(403, "forbidden", reason.publicMessage);
  if (reason instanceof OrganizationCampaignError) {
    if (reason.code === "not_found") return fail(404, "not_found", "Kurum Kampanyası bulunamadı.");
    if (reason.code === "market_mismatch") return fail(409, "market_mismatch", "Yerli ve yabancı kampanyalar aynı Kurum Kampanyasında birleştirilemez.");
    if (reason.code === "temporal_conflict") return fail(409, "temporal_conflict", "Kampanya bu zaman aralığında zaten başka bir Kurum Kampanyasına bağlı.");
    return fail(400, "invalid_input", "Kurum Kampanyası isteği geçersiz.");
  }
  if (reason instanceof SyntaxError) return fail(400, "invalid_input", "Kurum Kampanyası isteği geçersiz.");
  return organizationCampaignNotConfiguredResponse();
}
export function createOrganizationCampaignHttpHandlers(input: Readonly<{ service: Pick<OrganizationCampaignService, "inspect" | "create" | "assign" | "close">; resolvePrincipal(request: Request, operation: "read" | "publish"): Promise<TrustedDecisionRoomPrincipal | null> }>) {
  return Object.freeze({
    GET: async (request: Request) => { try { if (!validShape(request, "GET")) throw new OrganizationCampaignError("invalid_input"); const url = new URL(request.url); const principal = await input.resolvePrincipal(request, "read"); if (!principal) throw new AuthorizationError(); return NextResponse.json(await input.service.inspect(principal, { limit: url.searchParams.get("limit") ?? undefined, cursor: url.searchParams.get("cursor") ?? undefined }), { headers: HEADERS }); } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try { if (!validShape(request, "POST")) throw new OrganizationCampaignError("invalid_input"); const parsed = await command(request); const principal = await input.resolvePrincipal(request, "publish"); if (!principal) throw new AuthorizationError(); const response = parsed.operation === "create" ? await input.service.create(principal, parsed as never) : parsed.operation === "assign" ? await input.service.assign(principal, parsed as never) : await input.service.close(principal, parsed as never); return NextResponse.json(response, { headers: HEADERS }); } catch (reason) { return failure(reason); } },
  });
}
