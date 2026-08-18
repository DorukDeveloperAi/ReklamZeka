# P08-A — Default-off rollout control foundation

**Karar:** Kod ve yerel tarayıcı düzeyinde kısmi foundation. Gerçek oturumlu browser, protected pilot ve Meta sandbox/live acceptance açık olduğu için P08 tamamlanmış değildir.

## Rollout sınırı

- Global feature flag zinciri exact `"true"` olmadan açılmaz: `META_READ_ENABLED`, `GUIDE_SCHEDULER_ENABLED`, `HUMAN_ACTION_EXECUTION_ENABLED`, `LIMITED_AUTONOMY_ENABLED`, `META_WRITE_ENABLED`.
- İnsan yazımı global Meta write + human execution; limited autonomy ise global write + Meta read + Guide scheduler + limited autonomy gerektirir.
- Status/budget runtime ayrıca ayrı write token, kill switch kapalı durumu ve bounded workspace/account/action allowlist ister.
- Status execution route (`human_approved`, `guide_budget_human_approved`, `limited_autonomy_status`) persisted kaynaktan okunur ve her gate/allowlist hash'ine bağlanır.
- Meta read bootstrap/schedule ve Guide scheduler, rollout kapalıyken DB/network öncesinde `rollout_disabled` ile durur.
- `.env.example` bütün write bayraklarını ve allowlistleri default-off bırakır.

## Oturumsuz browser kanıtı

- Yerel `/dashboard` beş alanı (Operasyon, Kılavuzlar, Analiz, Kararlar, Sistem) gerçek in-app browser ile açıldı.
- Oturum yokken bütün alanlar açıkça `Yerel oturum gerekli` gösterdi; örnek/demo veri render edilmedi.
- Operasyon/Kapsam yüzeyleri capability girilmeden kullanılamadı; capability mint edilmedi veya tarayıcıya aktarılmadı.
- 320, 390, 768, 1024 ve 1440 px viewportlarda document/body genişliği viewport ile exact eşleşti; yatay sayfa taşması yok.
- Dashboard skip target `dashboard-content` ve `tabIndex=-1`; browser console warning/error sayısı sıfır.

## Yerel gate kanıtı

- Full suite: 544 dosya / 2665 test PASS.
- Security audit: 0 vulnerability; Supabase 174/174 RLS, API grant/routine 0.
- Pilot readiness: 12 dosya / 43 test ve DB check PASS.
- TypeScript, experience, pilot-web, build ve diff-check PASS.
- Yerel env boolean denetiminde beş global rollout bayrağı, write token ve write allowlistleri kapalı/eksik; yalnız local-session altyapısı açıktır.

## Açık kalanlar

- Kullanıcı tarafından açıkça sağlanan local-session capability ile authenticated `ready/partial/empty/error` browser matrisi.
- Protected pilotta gerçek Meta budget/status human-approved write; preflight, RAW, idempotent retry, timeline, before/after verify ve ayrı onaylı rollback.
- Rename human-only ve create-deny canlı kanıtı; bounded autonomy canary; workspace/account genişletme.
- PRE-only P06 execution/ceiling/budget/gate/limited migrations için bağımsız kritik APPLY sınırı ve POST kabulü.
