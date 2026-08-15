import { NextResponse } from "next/server";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import type { DrizzleSliceRulePortfolioLinkReadRepository } from "@/connectors/campaigns/slice-rule-portfolio-link-drizzle-read-repository";

const HEADERS = Object.freeze({ "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "portfolio-linked-evidence-read-only", "X-ReklamZeka-Action-Authority": "none", "X-ReklamZeka-Meta-Write": "disabled" });
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canEnableAutomation: false as const });

function trusted(request: Request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.search || !request.headers.get("cookie") || request.headers.has("authorization")
    || request.headers.has("x-workspace-id") || request.headers.has("x-workspace-ref") || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== "slice-rule-portfolio-links-read") throw new Error("invalid_input");
}

/** Tenant scope comes solely from the trusted local session; no browser selector is accepted. */
export function createSliceRulePortfolioLinksHttpHandler(input: Readonly<{
  repository: Pick<DrizzleSliceRulePortfolioLinkReadRepository, "list">;
  resolvePrincipal(request: Request): Promise<TrustedDecisionRoomPrincipal>;
}>) {
  return async (request: Request) => {
    try {
      trusted(request); const principal = await input.resolvePrincipal(request);
      return NextResponse.json({ contractVersion: "slice-rule-portfolio-links/1.0.0", links: await input.repository.list(principal.workspaceId), authority: AUTHORITY }, { headers: HEADERS });
    } catch {
      return NextResponse.json({ error: { code: "unavailable", message: "Bağlı Slice kanıtı güvenli biçimde okunamadı." }, authority: AUTHORITY }, { status: 503, headers: HEADERS });
    }
  };
}
