# P04-E — Kılavuz yaşam döngüsü ürün yüzeyi

**Durum:** Uygulandı ve ana kapılar yeşil; bağımsız kritik inceleme adayı. P04 paketinin bütçe happy-path / Meta execution kabulü değildir.

## Teslim

- `/api/guides` cookie-only ve same-origin sınırında ayrı `guide_lifecycle:read|draft|activate` capability kapsamları kullanır; Authorization veya workspace override kabul etmez.
- Workspace, aktör, iç slice/revision/market UUID’leri yalnız sunucu oturumundan ve current published Slice bağından çözülür. Tarayıcı yalnız public `sliceRef` ve Kılavuz içeriği gönderir.
- Kılavuzlar paneli immutable `draft → interpretation acceptance → activation` zincirini korur; pause ayrı OCC işlemidir. Taslak üretimi activation yapmaz.
- Mevcut latest revision public contracttan kapalı doğrulanır; kullanıcı aynı Guide kimliği altında OCC-bound yeni immutable revision taslağı üretir. Eski active revision, yeni taslak kabul edilip ayrıca aktive edilene kadar değişmez.
- Owner/admin taslak ve aktivasyon yapabilir; analyst/viewer yalnız okuyabilir. API ve UI authority sözleşmesi `canWriteMeta=false`, `canExecute=false` döndürür.
- Guide Agent boundary eski 24-hex varsayımı yerine `canonicalGuideWorkspaceRef` 16-hex kimliğini doğrular; öneri/explicit form-preview transferi gerçek persisted Guide workspace kimliğiyle çalışabilir, save/activate/approve/execute/Meta yetkileri kapalı kalır.
- P04 bütçe evidence okuyucusu PRE-only ceiling migration uygulanmadan önce `to_regclass` ile tabloyu yoklar; eksik tablo SQL hatası yerine `parent_ceiling_unavailable` fail-closed yolunu korur.

## Kanıt

- `npm run verify:guide-lifecycle-postgres`: `serverOwnedLifecycle`, canonical reload, analyst denial, missing acceptance denial, activation idempotency/stale rejection, pause/reactivation, cross-workspace/market/FK, revokes, archive ve `zeroResidue` dahil tüm bayraklar `true`.
- `npm test`: 557 dosya / 2699 test PASS.
- `npm run build`: `/api/guides` dynamic route dahil production build PASS; secret artifact sayıları sıfır.
- `npm run db:check`, `npm run verify:supabase-security`, `git diff --check`: PASS.
- Yeni hedef testler: HTTP hostile boundary, kapalı UI parser/authority ve PRE ceiling-table compatibility.

## Açık sınır

- 004 ceiling policy migration’ı bağımsız PRE kabul + apply/journal/POST beklediği için gerçek budget action staging hâlâ fail-closed’dur.
- Bu tranche hiçbir local-session capability üretmedi, hiçbir feature flag açmadı ve hiçbir Meta çağrısı yapmadı.
