import { demoReportRuntime, isReportRuntimeConfigurationError } from "@/reports/demo-share";
import { isShareLinkError } from "@/reports/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const csv = demoReportRuntime().csv(token, new Date().toISOString());
    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment; filename=demo-marka-7-gun.csv",
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isReportRuntimeConfigurationError(error)) return Response.json({ code: "configuration_missing" }, { status: 503 });
    if (isShareLinkError(error)) {
      return Response.json({ code: error.code }, { status: error.code === "expired" || error.code === "revoked" ? 410 : 404 });
    }
    return Response.json({ code: "internal_error" }, { status: 500 });
  }
}
