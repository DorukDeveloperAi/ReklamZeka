# P03-F — Kapsam Raporu UI foundation

**Karar:** Kabul edildi; şemasız ve salt-okunur kısmi UI dilimi. Gerçek oturumlu browser kabulü ile saved-report lifecycle kapsam dışıdır.

## Sözleşme

- Operasyon yüzeyinin altında aynı-origin `/api/scope-report` kaynağını kullanır; workspace/auth header override yoktur ve session/intent sınırı korunur.
- Slice, dönem, granularity, level, metric, action ve sıralama girdileri tek submitted snapshot'a bağlanır. Yanıtın slice ve bütün applied filter alanları bu snapshot ile exact eşleşmeden gösterilmez veya export edilmez.
- JSON görünüm; üyelik, raw metric, coverage ve pivot/drill kanıtını kapalı runtime parser üzerinden gösterir. Public-ref alanları raw UUID veya biçimsiz alias kabul etmez.
- CSV/XLSX export yalnız gösterilen snapshot'ı kullanır; MIME doğrulanır. Load/export sequence ve AbortController sınırı stale success/error/download'ın yeni görünümü bozmasını engeller.
- Yatay tablolar isimli, klavye ile odaklanabilir region'lardır; header scope, loading live status, benzersiz session connector ID'leri ve 320 px uzun-ref wrap sağlanır.

## Kanıt

- Bağımsız kritik final: ACCEPT.
- Focused 7 dosya / 31 test PASS.
- Global TypeScript typecheck PASS; scoped `git diff --check` PASS.
- Hostile parser testleri: malformed nested response, raw UUID/evidence listesi, request-response context mismatch, organization campaign ve coverage calendar ayrımı.
- Race/binder testleri: stale load/export invalidation, displayed-query export, MIME/error ayrımı, unique raw row key ve exact entity+bucket drill target.
- A11y/320 statik kanıtı: scoped headers, focusable named regions, live state, unique IDs ve unbroken public-ref wrapping.

## Açık işler

- Kullanıcının local-session capability'yi tarayıcıya bağlaması sonrası gerçek authenticated browser ready/partial/download kabulü
- Saved report persistence, paylaşım/version lifecycle ve tam ürün browser matrisi
- Guide/decision/audit contextual linkleri için rapor sözleşmesine güvenilir public ref eklenmesi
