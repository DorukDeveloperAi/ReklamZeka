import { NextResponse } from "next/server";
import { inspectMetaBootstrapPreflight } from "@/connectors/meta/bootstrap-preflight";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(inspectMetaBootstrapPreflight(), {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
