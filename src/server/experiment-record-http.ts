import { NextResponse } from "next/server";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { ExperimentRecordService, type ExperimentRecordCommand } from "@/application/experiment-record-service";
import { ExperimentRecordRepositoryError } from "@/connectors/decisions/experiment-record-drizzle-repository";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "experiment-record-mutate", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canRecordEvidence: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false });
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
function error(code: string, message: string, status: number) { return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS }); }
function exact(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_input");
  const candidate = value as Record<string, unknown>;
  const keys = candidate.operation === "plan"
    ? ["operation", "accountRef", "campaignRef", "cadenceProfileRevisionId", "plan"]
    : candidate.operation === "record_outcome" ? ["operation", "experimentRef", "expectedRecordHash", "observation"] : [];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) throw new Error("invalid_input");
}
function failure(reason: unknown) {
  if (reason instanceof AuthorizationError) return error("forbidden", reason.publicMessage, 403);
  if (reason instanceof ExperimentRecordRepositoryError) {
    if (reason.code === "forbidden") return error("forbidden", "Experiment kaydı yetkiniz yok.", 403);
    if (reason.code === "not_found") return error("not_found", "Experiment kapsamı bulunamadı.", 404);
    if (reason.code === "conflict") return error("conflict", "Experiment kaydı değişti; güncel sürümü yeniden alın.", 409);
    if (reason.code === "invalid_input") return error("invalid_input", "Experiment kaydı geçersiz.", 400);
  }
  if (reason instanceof SyntaxError || reason instanceof Error && reason.message === "invalid_input") return error("invalid_input", "Experiment isteği geçersiz.", 400);
  return error("unavailable", "Experiment kaydı şu anda kullanılamıyor.", 503);
}
export function experimentRecordNotConfiguredResponse() { return error("source_not_configured", "Experiment kaydı yerel çalışma alanına henüz bağlanmadı.", 503); }

export function createExperimentRecordHttpHandler(input: Readonly<{
  service: Pick<ExperimentRecordService, "mutate">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
}>) {
  return async function POST(request: Request) {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.search || request.headers.has("authorization") || !request.headers.get("cookie")
        || request.headers.get("origin") === null || request.headers.get("sec-fetch-site") !== "same-origin"
        || FORWARDED.some((header) => request.headers.has(header)) || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
        || request.headers.get("x-reklamzeka-intent") !== "experiment-record-mutate" || request.headers.get("content-type")?.toLowerCase() !== "application/json") throw new Error("invalid_input");
      const text = await request.text(); if (Buffer.byteLength(text) > 12_288) throw new Error("invalid_input");
      const command = JSON.parse(text) as unknown; exact(command);
      const principal = await input.resolvePrincipal(request); if (!principal) throw new AuthorizationError();
      return NextResponse.json(await input.service.mutate(principal, command as ExperimentRecordCommand), { status: 201, headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}
