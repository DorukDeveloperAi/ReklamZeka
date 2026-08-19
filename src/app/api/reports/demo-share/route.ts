export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function retiredResponse() {
  return Response.json({
    code: "legacy_demo_retired",
    message: "Fixture tabanlı demo rapor paylaşımı kullanımdan kaldırıldı.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request) {
  return retiredResponse();
}

export async function DELETE(_request: Request) {
  return retiredResponse();
}
