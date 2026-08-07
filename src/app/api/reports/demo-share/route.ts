import { demoReportRuntime, isReportRuntimeConfigurationError } from "@/reports/demo-share";
import { isShareLinkError } from "@/reports/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (isReportRuntimeConfigurationError(error)) {
    return Response.json({ code: "configuration_missing", message: "Rapor imzalama anahtarı yapılandırılmadı." }, { status: 503 });
  }
  if (isShareLinkError(error)) {
    const status = error.code === "expired" || error.code === "revoked" ? 410 : 400;
    return Response.json({ code: error.code, message: error.message }, { status });
  }
  return Response.json({ code: "internal_error", message: "Rapor paylaşımı oluşturulamadı." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const created = demoReportRuntime().create(new Date().toISOString());
    const reportUrl = new URL(`/reports/shared/${encodeURIComponent(created.token)}`, request.url).toString();
    const csvUrl = new URL(`/api/reports/shared/${encodeURIComponent(created.token)}/csv`, request.url).toString();
    return Response.json({ ...created, reportUrl, csvUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { token?: unknown };
    if (typeof body.token !== "string" || body.token.length === 0) {
      return Response.json({ code: "invalid", message: "Paylaşım tokenı zorunludur." }, { status: 400 });
    }
    const shareId = demoReportRuntime().revoke(body.token, new Date().toISOString());
    return Response.json({ shareId, status: "revoked" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
