import { NextResponse } from "next/server";
import type { TemporalRecommendationResult } from "@/application/temporal-recommendation-service";
import { AuthorizationError } from "@/security/authorization";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "advisory-evaluation", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export type TemporalRecommendationExactCommand = Readonly<{ frozenContextRef: string; ruleSeriesRef: string; windowRef: string }>;
/** The browser normally submits only this opaque, server-derived candidate ref. */
export type TemporalRecommendationCandidateCommand = Readonly<{ candidateRef: string }>;
export type TemporalRecommendationCommand = TemporalRecommendationExactCommand | TemporalRecommendationCandidateCommand;
export type TemporalRecommendationCandidate = Readonly<{ candidateRef: string; ruleSeriesRef: string; reviewCadence: "daily" | "weekly" | "monthly"; windowRef: string; capturedAt: string }>;
export type TemporalRecommendationReadItem = Readonly<{ evaluationRef: string; ruleSeriesRef: string; occurredAt: string; outcome: "recommendation" | "no_change"; reason: string; windowRef: string }>;
export type TemporalRecommendationHttpService = Readonly<{
  list(): Promise<readonly TemporalRecommendationReadItem[]>;
  listCandidates?(): Promise<readonly TemporalRecommendationCandidate[]>;
  evaluate(command: TemporalRecommendationCommand): Promise<TemporalRecommendationResult>;
}>;

function failure(reason: unknown) {
  const status = reason instanceof AuthorizationError ? 403 : reason instanceof Error && reason.message === "invalid_input" ? 400 : 503;
  return NextResponse.json({ error: { code: status === 403 ? "forbidden" : status === 400 ? "invalid_input" : "unavailable",
    message: status === 503 ? "Zamansal öneri kaydı şu anda kullanılamıyor." : "Zamansal öneri isteği reddedildi." } }, { status, headers: HEADERS });
}
function command(value: unknown): TemporalRecommendationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_input");
  const x = value as Record<string, unknown>;
  if (Object.keys(x).length === 1 && typeof x.candidateRef === "string" && /^temporal_candidate_[a-f0-9]{24}$/.test(x.candidateRef)) return Object.freeze({ candidateRef: x.candidateRef });
  if (Object.keys(x).length !== 3 || Object.keys(x).some((key) => !["frozenContextRef", "ruleSeriesRef", "windowRef"].includes(key))
    || !HASH.test(String(x.frozenContextRef)) || !REF.test(String(x.ruleSeriesRef)) || !REF.test(String(x.windowRef))) throw new Error("invalid_input");
  return Object.freeze({ frozenContextRef: x.frozenContextRef as string, ruleSeriesRef: x.ruleSeriesRef as string, windowRef: x.windowRef as string });
}
function trusted(request: Request, method: "GET" | "POST") {
  const url = new URL(request.url);
  if (request.method !== method || url.search || !request.headers.get("cookie") || request.headers.has("authorization") || request.headers.has("x-workspace-id")
    || request.headers.get("sec-fetch-site") !== "same-origin") throw new Error("invalid_input");
}
export function temporalRecommendationNotConfiguredResponse() { return failure(new Error("unavailable")); }
export function createTemporalRecommendationHttpHandler(input: Readonly<{ service: TemporalRecommendationHttpService; resolvePrincipal(request: Request): Promise<unknown> }>) {
  return Object.freeze({
  GET: async (request: Request) => { try { trusted(request, "GET"); await input.resolvePrincipal(request); return NextResponse.json({ contractVersion: "temporal-recommendation-read/1.0.0", items: await input.service.list(), candidates: await input.service.listCandidates?.() ?? [], authority: { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } }, { headers: HEADERS }); } catch (reason) { return failure(reason); } },
    POST: async (request: Request) => { try { trusted(request, "POST"); if (request.headers.get("content-type") !== "application/json" || request.headers.get("x-reklamzeka-intent") !== "temporal-recommendation-evaluate") throw new Error("invalid_input"); await input.resolvePrincipal(request); return NextResponse.json(await input.service.evaluate(command(await request.json())), { headers: HEADERS }); } catch (reason) { return failure(reason); } },
  });
}
