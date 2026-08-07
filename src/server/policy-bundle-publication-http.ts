import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { PolicyBundlePublicationError, type PolicyPublicationKind } from
  "@/application/policy-bundle-publication-service";
import type { PolicyBundlePublicationService } from "@/application/policy-bundle-publication-service";
import { ActionGuardrailPolicyRepositoryError } from
  "@/connectors/actions/action-guardrail-policy-drizzle-repository";
import { ApprovalPolicyRegistryRepositoryError } from
  "@/connectors/actions/approval-policy-registry-drizzle-repository";
import { cookieToken } from "@/security/local-session-capability";
import type { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import type { HumanPresenceConfirmationInput } from "@/security/macos-human-presence-ceremony";

const MAX_BODY_BYTES = 2_048;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;
const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "policy-publication-ceremony-only", "X-ReklamZeka-Action-Authority": "none" });
const AUTHORITY = Object.freeze({ canPublish: false, canDisable: false, canApproveAction: false,
  canGrant: false, canExecute: false, canWriteMeta: false });

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: AUTHORITY }, { status, headers: HEADERS });
}
function failure(reason: unknown) {
  if (reason instanceof PolicyBundlePublicationError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Policy yayın isteği geçersiz.", 400);
    if (reason.code === "forbidden") return error("forbidden", "Bu policy yayın töreni için owner/admin yetkisi gerekli.", 403);
    if (reason.code === "not_found") return error("not_found", "Yayınlanacak policy taslağı bulunamadı.", 404);
    if (reason.code === "stale") return error("stale", "Policy taslağı değişti veya artık yayınlanabilir değil.", 409);
    if (reason.code === "human_presence_rejected") return error("human_presence_rejected", "İnsan varlığı kanıtı geçersiz veya süresi dolmuş.", 403);
  }
  if (reason instanceof ApprovalPolicyRegistryRepositoryError
    && ["revision_conflict", "transition_conflict"].includes(reason.code)
    || reason instanceof ActionGuardrailPolicyRepositoryError
      && ["revision_conflict", "transition_conflict"].includes(reason.code)) {
    return error("stale", "Policy taslağı eşzamanlı olarak değişti; kaydı yenileyin.", 409);
  }
  return error("unavailable", "Policy yayın töreni şu anda tamamlanamıyor.", 503);
}
function invalid(): never { throw new PolicyBundlePublicationError("invalid_input"); }
function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1_000_000;
}
function assertTransport(request: Request, origin: string): void {
  let url: URL; let configured: URL;
  try { url = new URL(request.url); configured = new URL(origin); } catch { return invalid(); }
  if (request.method !== "POST" || url.origin !== configured.origin || url.pathname !== "/api/policy-bundles"
    || url.search !== "" || url.hash !== "" || request.headers.get("host") !== configured.host
    || request.headers.get("origin") !== configured.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.has("authorization") || FORWARDED.some((header) => request.headers.has(header))
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref")
    || request.headers.has("x-policy-revision") || request.headers.has("transfer-encoding")
    || request.headers.get("content-type")?.toLowerCase() !== "application/json" || cookieToken(request) === null) invalid();
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > MAX_BODY_BYTES)) invalid();
}
async function json(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { return invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
async function challengeBody(request: Request) {
  const value = await json(request);
  if (Object.keys(value).length !== 3 || Object.keys(value).some((key) => !["kind", "policyRef", "revision"].includes(key))
    || value.kind !== "approval_policy" && value.kind !== "guardrail_policy"
    || typeof value.policyRef !== "string" || !REF.test(value.policyRef) || !validRevision(value.revision)) invalid();
  return Object.freeze({ kind: value.kind as PolicyPublicationKind,
    policyRef: value.policyRef as string, revision: value.revision as number });
}
async function publicationBody(request: Request) {
  const value = await json(request);
  if (Object.keys(value).length !== 4
    || Object.keys(value).some((key) => !["policyRef", "revision", "reasonRef", "humanPresenceProof"].includes(key))
    || typeof value.policyRef !== "string" || !REF.test(value.policyRef) || !validRevision(value.revision)
    || typeof value.reasonRef !== "string" || !REF.test(value.reasonRef)
    || typeof value.humanPresenceProof !== "string" || !PROOF.test(value.humanPresenceProof)) invalid();
  return Object.freeze({ policyRef: value.policyRef as string, revision: value.revision as number,
    reasonRef: value.reasonRef as string, humanPresenceProof: value.humanPresenceProof as string });
}
function kindForIntent(intent: string | null): PolicyPublicationKind {
  if (intent === "policy-bundle-publish-approval-policy") return "approval_policy";
  if (intent === "policy-bundle-publish-guardrail-policy") return "guardrail_policy";
  return invalid();
}

export function createPolicyBundlePublicationHttpHandler(input: Readonly<{
  service: Pick<PolicyBundlePublicationService, "prepare" | "publish">;
  store: Pick<SingleUseHumanPresenceChallengeStore, "issue">;
  origin: string;
  clock?: () => string;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal | null>;
  confirmHumanPresence(input: HumanPresenceConfirmationInput): Promise<boolean>;
}>) {
  return async function POST(request: Request) {
    try {
      assertTransport(request, input.origin);
      const intent = request.headers.get("x-reklamzeka-intent");
      const principal = await input.resolvePrincipal(request);
      if (!principal) throw new PolicyBundlePublicationError("forbidden");
      if (intent === "policy-bundle-confirm-human-presence") {
        const body = await challengeBody(request);
        const prepared = await input.service.prepare(principal, body);
        const binding = Object.freeze({ request, workspaceId: principal.workspaceId, actorRef: principal.readerRef,
          unitRef: prepared.unitRef, action: prepared.action });
        if (!await input.confirmHumanPresence(binding)) throw new PolicyBundlePublicationError("human_presence_rejected");
        const challenge = input.store.issue({ workspaceId: binding.workspaceId, actorRef: binding.actorRef,
          unitRef: binding.unitRef, action: binding.action, now: input.clock?.() ?? new Date().toISOString() });
        return NextResponse.json({ challenge: { kind: prepared.kind, policyRef: prepared.policyRef,
          revision: prepared.revision, unitRef: prepared.unitRef, proof: challenge.proof, expiresAt: challenge.expiresAt },
        authority: AUTHORITY }, { status: 200, headers: HEADERS });
      }
      const kind = kindForIntent(intent); const body = await publicationBody(request);
      return NextResponse.json(await input.service.publish(principal, { kind, ...body }), { status: 200, headers: HEADERS });
    } catch (reason) { return failure(reason); }
  };
}
