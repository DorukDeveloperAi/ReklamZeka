import { createHash, randomUUID } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  authorizeWorkspace,
  type WorkspaceMembership,
} from "@/security/authorization";

const HEADERS = Object.freeze({
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
});
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND = /^manual_[a-z0-9][a-z0-9_-]{0,94}$/;
const RUN_REF = /^guide_run_[a-f0-9]{64}$/;

export class GuideRunManualHttpError extends Error {
  constructor(readonly code: "invalid_input" | "conflict" | "unavailable") {
    super(`manual Guide run rejected: ${code}`);
    this.name = "GuideRunManualHttpError";
  }
}

type Worker = Readonly<{
  run(
    input: Readonly<{
      workspaceId: string;
      guideId: string;
      revisionId: string;
      requestRef: string;
      now: string;
      leaseToken: string;
      leaseUntil: string;
    }>,
  ): Promise<Readonly<{ runRef: string; state: string; replay: boolean }>>;
}>;

function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new GuideRunManualHttpError("invalid_input");
  }
}

function response(code: string, message: string, status: number) {
  return Response.json(
    { error: { code, message } },
    { status, headers: HEADERS },
  );
}

export function guideRunManualNotConfiguredResponse() {
  return response(
    "source_not_configured",
    "Manuel Kılavuz koşusu etkin değil.",
    503,
  );
}

export function guideRunManualSessionRequiredResponse() {
  return response("local_session_required", "Yerel oturum gerekli.", 401);
}

export function createGuideRunManualHttpHandler(
  input: Readonly<{
    worker: Worker;
    resolvePrincipal(
      request: Request,
    ): Promise<
      Readonly<{
        principal: TrustedDecisionRoomPrincipal;
        membership: WorkspaceMembership;
      }>
    >;
    clock?: () => Date;
    leaseToken?: () => string;
  }>,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        request.method !== "POST" ||
        request.headers.get("x-reklamzeka-intent") !== "guide-run-manual" ||
        request.headers.get("origin") !== url.origin ||
        request.headers.get("sec-fetch-site") !== "same-origin" ||
        request.headers.get("content-type")?.toLowerCase() !==
          "application/json" ||
        request.headers.has("authorization") ||
        request.headers.has("x-workspace-id")
      ) {
        throw new GuideRunManualHttpError("invalid_input");
      }
      const raw = await request.text();
      if (Buffer.byteLength(raw, "utf8") > 4_096)
        throw new GuideRunManualHttpError("invalid_input");
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new GuideRunManualHttpError("invalid_input");
      }
      exact(body, ["guideId", "revisionId", "commandRef"]);
      if (
        typeof body.guideId !== "string" ||
        !UUID.test(body.guideId) ||
        typeof body.revisionId !== "string" ||
        !UUID.test(body.revisionId) ||
        typeof body.commandRef !== "string" ||
        !COMMAND.test(body.commandRef)
      ) {
        throw new GuideRunManualHttpError("invalid_input");
      }
      const bound = await input.resolvePrincipal(request);
      authorizeWorkspace(
        bound.principal.actor,
        bound.principal.workspaceId,
        "guide_run:manual",
        [bound.membership],
      );
      const nowDate = input.clock?.() ?? new Date();
      if (!Number.isFinite(nowDate.getTime()))
        throw new GuideRunManualHttpError("unavailable");
      const now = nowDate.toISOString();
      const requestRef = `request_${createHash("sha256")
        .update(
          JSON.stringify({
            workspaceId: bound.principal.workspaceId,
            guideId: body.guideId,
            revisionId: body.revisionId,
            commandRef: body.commandRef,
          }),
        )
        .digest("hex")}`;
      const leaseToken = input.leaseToken?.() ?? randomUUID();
      if (!UUID.test(leaseToken))
        throw new GuideRunManualHttpError("unavailable");
      const output = await input.worker.run({
        workspaceId: bound.principal.workspaceId,
        guideId: body.guideId,
        revisionId: body.revisionId,
        requestRef,
        now,
        leaseToken,
        leaseUntil: new Date(nowDate.getTime() + 5 * 60_000).toISOString(),
      });
      if (
        !RUN_REF.test(output.runRef) ||
        !["completed", "failed"].includes(output.state) ||
        typeof output.replay !== "boolean"
      )
        throw new GuideRunManualHttpError("unavailable");
      return Response.json(
        {
          contractVersion: "guide-run-manual-result/1.0.0",
          ...output,
          authority: {
            canApprove: false,
            canExecute: false,
            canWriteMeta: false,
          },
        },
        { headers: HEADERS },
      );
    } catch (reason) {
      if (
        reason instanceof Error &&
        (reason.name === "LocalDecisionRoomBoundaryError" ||
          reason.name === "LocalSessionCapabilityError")
      )
        return guideRunManualSessionRequiredResponse();
      if (reason instanceof GuideRunManualHttpError)
        return response(
          reason.code,
          reason.code === "invalid_input"
            ? "Manuel koşu isteği geçersiz."
            : reason.code === "conflict"
              ? "Manuel koşu başka bir işlemle çakıştı."
              : "Manuel koşu tamamlanamadı.",
          reason.code === "invalid_input"
            ? 400
            : reason.code === "conflict"
              ? 409
              : 503,
        );
      if (
        reason &&
        typeof reason === "object" &&
        "status" in reason &&
        reason.status === 403
      ) {
        return response(
          "forbidden",
          "Bu işlem için çalışma alanı yetkiniz yok.",
          403,
        );
      }
      return response("unavailable", "Manuel koşu tamamlanamadı.", 503);
    }
  };
}
