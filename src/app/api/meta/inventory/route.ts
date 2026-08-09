import { NextResponse } from "next/server";
import type { MetaInventoryApiError } from "@/connectors/meta/types";

export const dynamic = "force-dynamic";

function publicError(code: MetaInventoryApiError["error"]["code"], message: string, status: number) {
  return NextResponse.json<MetaInventoryApiError>({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  return publicError(
    "not_configured",
    "Meta portföyü güvenli oturum bağlantısı kurulana kadar kullanılamıyor",
    503,
  );
}
