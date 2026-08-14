import { NextResponse } from "next/server";
import type { MetaInventoryApiError } from "@/connectors/meta/types";
import { metaTokenSecurityBlocksDoctor } from "@/connectors/meta/bootstrap-preflight";

export const dynamic = "force-dynamic";

function publicError(code: MetaInventoryApiError["error"]["code"], message: string, status: number) {
  return NextResponse.json<MetaInventoryApiError>({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  const securityBlocked = metaTokenSecurityBlocksDoctor(process.env.META_TOKEN_SECURITY_STATUS);
  return publicError(
    "not_configured",
    securityBlocked
      ? "Meta read mirror geçici olarak kapalı: mevcut token güvenlik incelemesinde. Tokenı döndürün; ardından normal salt-okunur sync çalıştırın."
      : "Meta portföyü güvenli oturum bağlantısı kurulana kadar kullanılamıyor",
    503,
  );
}
