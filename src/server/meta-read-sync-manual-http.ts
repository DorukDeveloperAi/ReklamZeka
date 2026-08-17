import { NextResponse } from "next/server";

import type { MetaReadSyncScheduleWorkerResult } from "@/application/meta-read-sync-schedule-worker";
import { assertExactEmptyBody } from "@/server/local-session-bootstrap-http";

const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-ReklamZeka-Access-Mode": "read-only-sync",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message }, authority: { canWriteMeta: false } }, { status, headers: HEADERS });

export const metaReadSyncNotConfiguredResponse = () =>
  fail(503, "source_not_configured", "Meta salt-okunur yenileme kaynağı yerel çalışma alanına henüz bağlanmadı.");
export const metaReadSyncSessionRequiredResponse = () =>
  fail(401, "local_session_required", "Meta yenilemesi için yerel dashboard oturumunu bağlayın.");

async function trustedShape(request: Request): Promise<boolean> {
  let url: URL; try { url = new URL(request.url); } catch { return false; }
  const origin = request.headers.get("origin");
  const contentLength = request.headers.get("content-length");
  if (request.method !== "POST" || Boolean(url.search) || request.headers.has("authorization")
    || !request.headers.get("cookie") || request.headers.has("x-workspace-id")
    || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== "meta-read-sync-manual"
    || origin !== url.origin || (contentLength !== null && contentLength !== "0")) return false;
  try { await assertExactEmptyBody(request.body); return true; } catch { return false; }
}

/** HTTP has no workspace, connection, token, account or request body input. */
export function createManualMetaReadSyncHttpHandler(input: Readonly<{
  workspaceId(request: Request): Promise<string | null>;
  run(workspaceId: string): Promise<MetaReadSyncScheduleWorkerResult>;
}>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (!await trustedShape(request)) return fail(400, "invalid_input", "Meta yenileme isteği geçersiz.");
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return fail(403, "forbidden", "Doğrulanmış yerel oturum gerekir.");
      const result = await input.run(workspaceId);
      if (result.actionAuthority !== "none" || result.writeNetworkCalls !== 0) return metaReadSyncNotConfiguredResponse();
      return NextResponse.json(Object.freeze({ status: "accepted", dueCount: result.dueCount,
        completedCount: result.completedCount, partialCount: result.partialCount,
        failedCount: result.failedCount, duplicateCount: result.duplicateCount,
        actionAuthority: "none", metaWriteCalls: 0 }), { status: 202, headers: HEADERS });
    } catch {
      return metaReadSyncNotConfiguredResponse();
    }
  };
}
