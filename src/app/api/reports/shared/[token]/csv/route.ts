export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, _context: { params: Promise<{ token: string }> }) {
  return Response.json({
    code: "legacy_demo_retired",
    message: "Fixture tabanlı demo rapor CSV'i kullanımdan kaldırıldı.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
