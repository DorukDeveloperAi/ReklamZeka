import { NextResponse } from "next/server";

import {
  ApprovalDecisionError,
  type ApprovalDecisionKind,
  type ApprovalDecisionResult,
  type ApprovalDecisionService,
} from "@/application/approval-decision-service";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { cookieToken } from "@/security/local-session-capability";
import type { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";
import type { WorkspaceMembership } from "@/security/authorization";

const MAX_BODY_BYTES = 2_048;
const UNIT_REF = /^action_unit_[a-f0-9]{20}$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const PROOF = /^presence_[A-Za-z0-9_-]{32,160}$/;
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip"] as const;

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "decision-record-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});

type DecisionContext = Readonly<{
  principal: TrustedDecisionRoomPrincipal;
  membership: WorkspaceMembership;
}>;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message }, authority: { canExecute: false, canWriteMeta: false } }, {
    status,
    headers: HEADERS,
  });
}

function failure(reason: unknown) {
  if (reason instanceof ApprovalDecisionError) {
    if (reason.code === "invalid_input") return error("invalid_input", "Onay kararı isteği geçersiz.", 400);
    if (reason.code === "forbidden") return error("forbidden", "Bu onay kararı için yetkiniz yok.", 403);
    if (reason.code === "not_found") return error("not_found", "Onay birimi bulunamadı.", 404);
    if (reason.code === "human_presence_rejected") return error("human_presence_rejected", "İnsan onayı kanıtı geçersiz veya süresi dolmuş.", 403);
    if (reason.code === "stale" || reason.code === "conflict") return error(reason.code, "Onay birimi değişti; kuyruğu yenileyin.", 409);
  }
  return error("unavailable", "Onay kararı şu anda kaydedilemiyor.", 503);
}

function invalid(): never { throw new ApprovalDecisionError("invalid_input"); }

function kindForIntent(intent: string | null): ApprovalDecisionKind {
  if (intent === "approval-queue-approve") return "approve";
  if (intent === "approval-queue-reject") return "reject";
  if (intent === "approval-queue-request-changes") return "request_changes";
  return invalid();
}

function assertTransport(request: Request, configuredOrigin: string): void {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(request.url);
    origin = new URL(configuredOrigin);
  } catch {
    return invalid();
  }
  if (request.method !== "POST" || url.origin !== origin.origin || url.pathname.length === 0
    || url.search !== "" || url.hash !== "" || request.headers.get("host") !== origin.host
    || request.headers.get("origin") !== origin.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.has("authorization") || FORWARDED.some((header) => request.headers.has(header))
    || request.headers.has("transfer-encoding") || request.headers.get("content-type")?.toLowerCase() !== "application/json"
    || cookieToken(request) === null) invalid();
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(?:0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > MAX_BODY_BYTES)) invalid();
}

async function body(request: Request): Promise<Readonly<{
  unitRef: string;
  reasonCode: string;
  humanPresenceProof: string;
}>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { return invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || Object.keys(value).some((key) => !["unitRef", "reasonCode", "humanPresenceProof"].includes(key))) invalid();
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.unitRef !== "string" || !UNIT_REF.test(candidate.unitRef)
    || typeof candidate.reasonCode !== "string" || !CODE.test(candidate.reasonCode)
    || typeof candidate.humanPresenceProof !== "string" || !PROOF.test(candidate.humanPresenceProof)) invalid();
  return Object.freeze({
    unitRef: candidate.unitRef,
    reasonCode: candidate.reasonCode,
    humanPresenceProof: candidate.humanPresenceProof,
  });
}

async function challengeBody(request: Request): Promise<Readonly<{ unitRef: string; action: ApprovalDecisionKind }>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { return invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2 || Object.keys(value).some((key) => !["unitRef", "action"].includes(key))) invalid();
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.unitRef !== "string" || !UNIT_REF.test(candidate.unitRef)
    || typeof candidate.action !== "string" || !["approve", "reject", "request_changes"].includes(candidate.action)) invalid();
  return Object.freeze({ unitRef: candidate.unitRef, action: candidate.action as ApprovalDecisionKind });
}

export function approvalDecisionNotConfiguredResponse() {
  return error("decision_not_configured", "İnsan onayı karar katmanı henüz etkin değil.", 503);
}

/**
 * Local browser-only mutation boundary. The resolver must verify the HttpOnly
 * capability with `approval_queue:decide` and re-read membership on every call.
 */
export function createApprovalDecisionPostHandler(input: Readonly<{
  service: Pick<ApprovalDecisionService, "decide">;
  origin: string;
  resolveDecisionContext(request: Request, requiredScope: "approval_queue:decide"): Promise<DecisionContext | null>;
}>) {
  return async function POST(request: Request): Promise<NextResponse<ApprovalDecisionResult | unknown>> {
    try {
      assertTransport(request, input.origin);
      const kind = kindForIntent(request.headers.get("x-reklamzeka-intent"));
      const parsed = await body(request);
      const context = await input.resolveDecisionContext(request, "approval_queue:decide");
      if (!context) throw new ApprovalDecisionError("forbidden");
      const result = await input.service.decide({
        ...context,
        unitRef: parsed.unitRef,
        kind,
        reasonCode: parsed.reasonCode,
        humanPresenceProof: parsed.humanPresenceProof,
      });
      return NextResponse.json(result, { status: 200, headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  };
}

/**
 * Starts the short-lived proof only after an injected trusted ceremony (for
 * example WebAuthn, an OS prompt, or a CLI TTY confirmation) affirms this exact
 * actor + unit + decision. Same-origin JavaScript alone cannot mint a proof.
 */
export function createHumanPresenceChallengePostHandler(input: Readonly<{
  store: Pick<SingleUseHumanPresenceChallengeStore, "issue">;
  origin: string;
  clock?: () => string;
  resolveDecisionContext(request: Request, requiredScope: "approval_queue:decide"): Promise<DecisionContext | null>;
  confirmHumanPresence(binding: Readonly<{
    request: Request;
    workspaceId: string;
    actorRef: string;
    unitRef: string;
    action: ApprovalDecisionKind;
  }>): Promise<boolean>;
}>) {
  return async function POST(request: Request) {
    try {
      assertTransport(request, input.origin);
      if (request.headers.get("x-reklamzeka-intent") !== "approval-queue-confirm-human-presence") invalid();
      const parsed = await challengeBody(request);
      const context = await input.resolveDecisionContext(request, "approval_queue:decide");
      if (!context || context.membership.workspaceId !== context.principal.workspaceId
        || context.membership.userId !== context.principal.actor.userId
        || !["owner", "admin"].includes(context.membership.role)) throw new ApprovalDecisionError("forbidden");
      const binding = Object.freeze({
        request,
        workspaceId: context.principal.workspaceId,
        actorRef: context.principal.readerRef,
        unitRef: parsed.unitRef,
        action: parsed.action,
      });
      if (!await input.confirmHumanPresence(binding)) throw new ApprovalDecisionError("human_presence_rejected");
      const challenge = input.store.issue({
        workspaceId: binding.workspaceId,
        actorRef: binding.actorRef,
        unitRef: binding.unitRef,
        action: binding.action,
        now: input.clock?.() ?? new Date().toISOString(),
      });
      return NextResponse.json({
        challenge: { unitRef: binding.unitRef, action: binding.action, proof: challenge.proof, expiresAt: challenge.expiresAt },
        authority: { canGrant: false, canExecute: false, canWriteMeta: false },
      }, { status: 200, headers: HEADERS });
    } catch (reason) {
      return failure(reason);
    }
  };
}
