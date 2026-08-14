import { NextResponse } from "next/server";
import { graphCapabilityPreflightPublicSource } from "@/application/meta-public-source-adapters";
import { inspectMetaBootstrapPreflight } from "@/connectors/meta/bootstrap-preflight";
import { withPublicSource } from "@/domain/source/public-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const preflight = inspectMetaBootstrapPreflight();
  return NextResponse.json(withPublicSource(preflight, graphCapabilityPreflightPublicSource(preflight)), {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
