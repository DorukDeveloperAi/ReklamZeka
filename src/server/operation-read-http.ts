import { NextResponse } from "next/server";
import type { OperationReadService } from "@/application/operation-read-service";

const headers = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});

type OperationReadInput = Parameters<OperationReadService["read"]>[1];
const error = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers });

export const operationReadUnavailable = () => NextResponse.json(
  { error: { code: "source_unavailable", message: "Operasyon kaynağı kullanılamıyor." } },
  { status: 503, headers },
);
export const operationReadSessionRequired = () => error(401, "local_session_required");
export const operationReadForbidden = () => error(403, "forbidden");
export const operationReadInvalidInput = () => error(400, "invalid_input");

/** Validates only public request shape; identity remains in the local runtime. */
export function operationReadRequestInput(request: Request): OperationReadInput | null {
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (request.method !== "GET"
    || request.headers.has("authorization")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== "operation-read"
    || [...url.searchParams.keys()].some((key) => !["period", "start", "end", "slice", "limit", "cursor"].includes(key))) return null;
  return Object.fromEntries(url.searchParams) as OperationReadInput;
}

function isRejectedInput(reason: unknown): boolean {
  return reason instanceof Error
    && reason.message.startsWith("operation read rejected:")
    && reason.message !== "operation read rejected: primary_result_binding";
}

export function createOperationReadHttpHandler(input: Readonly<{
  service: OperationReadService;
  workspaceId(request: Request): Promise<string | null>;
}>) {
  return async (request: Request) => {
    const requestInput = operationReadRequestInput(request);
    if (!requestInput) return operationReadInvalidInput();
    if (!request.headers.get("cookie")) return operationReadSessionRequired();
    try {
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return operationReadForbidden();
      return NextResponse.json(await input.service.read(workspaceId, requestInput), { headers });
    } catch (reason) {
      return isRejectedInput(reason) ? operationReadInvalidInput() : operationReadUnavailable();
    }
  };
}
