# ReklamZeka v3 — Durum Defteri

| Paket | Durum | Dependency |
|---|---|---|
| + M00 | TAMAMLANDI — `evidence/M00-20260817.md`, `4fdb381` | — |
| P01 meta-veri-sagligi | DEVAM — ortak 6 saatlik automatic/manual fire ve scope lease kabulde | M00 |
| P02 kurum-kampanyasi-kunye | DEVAM — Kurum Kampanyası temeli hazır; canlı migration/DB acceptance açık | P01 |
| P03 slice-operasyon-rapor | DEVAM — `+ P03-A` resolver/registry/frozen replay kabul edildi; Operasyon read-model, saved view ve Kapsam Raporu açık | P02 |
| P04 kilavuz-butce | BEKLİYOR | P03 |
| P05 agent-analiz-kosum | DEVAM — Guide Run saf state/scheduler çekirdeği kabul edildi; persistence ve iki-Agent runtime açık | P04 |
| P06 karar-otonomi-uygulama | BEKLİYOR | P05 |
| P07 ui-ux | BEKLİYOR (paralel) | M00; P01–P06 ile birleşir |
| P08 kabul-rollout | BEKLİYOR (cross gate) | M00,P01–P07 |

`PASS` yalnız ilgili R3 evidence-pack, functional/browser test ve P08 gate kanıtıyla yazılır.

## 2026-08-17 — ilk uygulama zinciri

- P02 için tenant-bound Kurum Kampanyası ve temporal Meta campaign üyeliği temeli `7da9499` ile eklendi. Yerli/yabancı kanonik kategori kanıtına bağlıdır; canlı migration ve tam PostgreSQL kabulü tamamlanmadan paket kabul edilmez.
- P03 resolver temeli `e23efb1` ile eklendi: dimensionlar arası AND, dimension içi OR, `exclude > include > dynamic`, hard market boundary, exact frozen membership evidence ve sonradan değişmeyen replay. Bu yalnız domain temelidir; slice registry, persistence, Operasyon tablosu ve Kapsam Raporu henüz paket kabulü değildir.
- P07’nin beş-alan kabuk temeli `2c947a4` ile kuruldu; gerçek ekran konsolidasyonu ve bütün viewport/browser matrisi açık olduğu için P07 henüz kabul edilmedi.
- P01-A `c524e70`: automatic ve manual Meta read fire aynı server-owned scope lease’ine bağlandı; yeni schedule cadence 6 saattir, manual fire schedule cursor’ını ilerletmez, HTTP scope/account/token kabul etmez ve Meta write authority sıfırdır. Typecheck, DB/security ve 71 odak test yeşildir. Canlı migration/DNS acceptance ile unified health/finding/currency/budget-history alt paketleri açık olduğundan P01 henüz `+` değildir.
- 2026-08-17 canlı DB: P01-A migration ledger’a uygulandı ve schedule verifier `dueDerived/claimed/completed/cursorAdvanced/duplicateCompleted/rollbackClean=true`, Meta network/write `0` verdi. P02 Kurum Kampanyası verifier’ı canonical market, missing/conflicting/cross-market/cross-tenant retleri, overlap, close-once, reassign, sanal Atanmamış, RLS/FORCE/dark grants ve zero-residue ile geçti. P02’nin isim şablonu ve tam künye akışı açık olduğundan paket henüz `+` değildir.
- P04-A `17c839f` + `53bcfe5`: saf Kılavuz revision/schedule/budget-interpretation domain’i eklendi; eylem bazında limited-autonomy ile human-only rename ayrıldı. Persistence, activation, Agent transfer ve overlap çözümü açık olduğundan P04 henüz kabul edilmedi.
- P05-A: Guide Run exact state zinciri, immutable event hash'i, lease/head kontrolü, scheduled/manual idempotency, missed-slot coalescing ve mode/data-quality disposition eklendi. Rename limited autonomy altında da insan onayına gider; bütün authority alanları kapalıdır. Persistence, gerçek iki-Agent runtime, frozen member incelemesi, finding ve Development Log açık olduğundan P05 henüz `+` değildir.
- P01-B targeting evidence: Graph ad set hedeflemesi bounded ve public-safe kanonik özete dönüştürülerek mevcut mirror kolonlarına imzalı/idempotent yazılır. Eksik/null/unsupported alanlar `partial|missing|unsupported` olarak kalır; ham audience/geo kimlikleri yayımlanmaz. İsim şablonu ve künye inference bu kanıtı kullanabilir, fakat otomatik atama yetkisi yoktur. P01 unified health/finding/currency/budget-history işleri açık olduğundan P01 henüz `+` değildir.
- `+ P03-A slice-registry`: kanonik slice resolver, immutable registry/OCC publication ve exact frozen membership replay canlı PostgreSQL kabulünden geçti. Gerçek servis/repository publish+freeze, stale head, tamper, wrong-revision, cross-tenant/cross-market, append-only, RLS/FORCE/revoke ve zero-residue kanıtlandı. Alt task arşivlenebilir; P03 paketinin Operasyon read-model, saved views ve ayrı Kapsam Raporu işleri açık kalır.
- P01-C unified data-health domain: mirror/performance/trust, exact tarih/alan kapsamı ve workspace currency tek deterministic raporda birleşir. Analiz kaydı hiçbir veri eksikliğinde yok olmaz; stable `data_quality` finding ve proposed Development Log observation üretilir. Ready olmayan veya currency dışı kanıt action staging/dispatch data-health kapısını kapatır. Persistence ve production action-gate bağlantısı açık olduğundan P01 henüz `+` değildir.
