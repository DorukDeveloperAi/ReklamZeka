export function GET() {
  return Response.json({
    status: "ok",
    service: "reklamzeka-web",
    version: "0.1.0",
  });
}
