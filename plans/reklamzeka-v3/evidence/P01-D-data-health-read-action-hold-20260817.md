# P01-D — Data-health read ve action hold

- `deliveryRef`: P01-D-data-health-read-action-hold-20260817
- Durum: alt görev ana sürücü tarafından kabul edildi; generic Finding/Development Log persistence P01-E olarak açık.
- Canonical read: server-derived workspace ve target account kapsamında, en fazla 250 hesap; canonical mirror alan kapsamı, son 7 tamamlanmış UTC gün, sync stream durumu ve 24 saat freshness.
- Exact coverage: targeting ve creative-content alanları tüm ilgili ad set/creative kayıtlarında mevcut olmadıkça partial; campaign-less hesap empty; eksik gün ve alan sıfır olarak yorumlanmaz.
- Currency: birden fazla canonical para birimi workspace currency'yi unresolved yapar ve tüm para aggregate/action kapsamını kapatır; hedef hesap ref'i tenant-scoped opaque ref'tir.
- Action boundary: selection/analiz sonucu korunur; ready olmayan sağlık materialization snapshot'ı sonrası typed `data_health_hold` verir. Execution admission sağlık kanıtını yeniden okur ve dispatch/Meta write yetkisini kapatır.
- Lifecycle: report hash/workspace doğrulamalı pure projector; stable fingerprint, immutable observed/resolved/reopened event chain, deterministic hash ve yalnız proposed Development Log portu.
- Authority/network: policy, approval, execution ve Meta write yetkisi eklenmedi; Graph mutation/network çağrısı `0`.
- Migration/RLS: yeni tablo veya migration yok. Mevcut tenant-bound canonical tablolar salt-okunur sorgulandı.
- Test: hedef regresyonlar 25/25; `npm run typecheck`, `npm run db:check`, `npm run check:security-boundaries`, `git diff --check` PASS.
- Bilinen sınır: generic Finding/Development Log için uygun mevcut ledger yoktur; semantik olarak yanlış bir ledger reuse edilmedi. Yeni tenant-bound, RLS FORCE, append-only şema P01-E'de teslim edilecek.
- Rollback: bu delivery'nin adapter/gate/projector değişikliklerini geri almak yeterlidir; schema/data rollback yoktur.
- Kabul: ana sürücü, 2026-08-17.
