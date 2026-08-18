import { NextResponse } from "next/server";
import type {
  DrizzleScopeReportSavedRepository,
  SaveScopeReportInput,
} from "@/connectors/slices/scope-report-saved-drizzle-repository";
import {
  normalizeSavedScopeReportQuery,
  SavedScopeReportError,
} from "@/domain/slices/scope-report-saved";

const headers = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "saved-report-evidence",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const error = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
export const scopeReportSavedUnavailable = () =>
  error(503, "source_unavailable");
export const scopeReportSavedSessionRequired = () =>
  error(401, "local_session_required");
export const scopeReportSavedForbidden = () => error(403, "forbidden");
export const scopeReportSavedInvalidInput = () => error(400, "invalid_input");

function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === keys.length &&
    Object.keys(value as Record<string, unknown>).every((key) =>
      keys.includes(key),
    )
  );
}

export function scopeReportSavedRequestKind(
  request: Request,
): "list" | "save" | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (
    url.search !== "" ||
    request.headers.has("authorization") ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  )
    return null;
  return request.method === "GET" &&
    request.headers.get("x-reklamzeka-intent") === "scope-report-saved-list"
    ? "list"
    : request.method === "POST" &&
        request.headers.get("x-reklamzeka-intent") === "scope-report-saved-save"
      ? "save"
      : null;
}

async function saveInput(
  request: Request,
  identity: Readonly<{ workspaceId: string; actorId: string }>,
): Promise<SaveScopeReportInput | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 8192 ||
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return null;
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (
    !exact(value, [
      "commandRef",
      "reportRef",
      "expectedVersion",
      "label",
      "query",
      "state",
    ])
  )
    return null;
  if (value.state !== "active" && value.state !== "archived") return null;
  try {
    return Object.freeze({
      workspaceId: identity.workspaceId,
      actorId: identity.actorId,
      commandRef: typeof value.commandRef === "string" ? value.commandRef : "",
      reportRef:
        value.reportRef === null || typeof value.reportRef === "string"
          ? value.reportRef
          : "",
      expectedVersion:
        value.expectedVersion === null ||
        Number.isSafeInteger(value.expectedVersion)
          ? (value.expectedVersion as number | null)
          : -1,
      label: typeof value.label === "string" ? value.label : "",
      query: normalizeSavedScopeReportQuery(value.query),
      state: value.state,
    });
  } catch {
    return null;
  }
}

export function createScopeReportSavedHttpHandlers(
  input: Readonly<{
    repository: Pick<DrizzleScopeReportSavedRepository, "save" | "list">;
    identity(
      request: Request,
      operation: "list" | "save",
    ): Promise<Readonly<{ workspaceId: string; actorId: string }> | null>;
  }>,
) {
  const invoke = async (request: Request) => {
    const operation = scopeReportSavedRequestKind(request);
    if (!operation) return scopeReportSavedInvalidInput();
    if (!request.headers.get("cookie"))
      return scopeReportSavedSessionRequired();
    try {
      const identity = await input.identity(request, operation);
      if (!identity) return scopeReportSavedForbidden();
      if (operation === "list")
        return NextResponse.json(
          { items: await input.repository.list(identity.workspaceId) },
          { headers },
        );
      const parsed = await saveInput(request, identity);
      if (!parsed) return scopeReportSavedInvalidInput();
      const result = await input.repository.save(parsed);
      return NextResponse.json(result, {
        status: result.replay ? 200 : 201,
        headers,
      });
    } catch (reason) {
      if (reason instanceof SavedScopeReportError)
        return reason.code === "invalid_input"
          ? scopeReportSavedInvalidInput()
          : reason.code === "conflict"
            ? error(409, "conflict")
            : scopeReportSavedUnavailable();
      return scopeReportSavedUnavailable();
    }
  };
  return Object.freeze({ GET: invoke, POST: invoke });
}
