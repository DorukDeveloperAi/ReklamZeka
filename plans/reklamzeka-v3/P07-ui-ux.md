# P07 — ui-ux

**Bağımlılık:** M00 paralel; P01–P06 ile birleşir. **DoD:** R3-20.

## Beş alan ve davranış

- **Operasyon:** portföy, source-health, Kurum Kampanyası/künye, Operasyon tablosu ve Kapsam Raporu.
- **Kılavuzlar:** revision, free-text/strict diff, frequency/mode/closed actions, budget ve transfer.
- **Analiz:** run states, frozen context, findings, recommendations, evidence/uncertainty ve staged adaylar.
- **Kararlar:** candidate, human approval/reject/defer, preflight, action/verify/rollback timeline.
- **Sistem:** connector/source-state, schedules, permissions, flags, DevLog/audit/health.

## Görsel, ortak davranış ve legacy consolidation

- Görsel dil soft Meta, neutral yüzeyler ve **gradient yok**; gerçek light/dark temadır. Normal metin 14px, yardımcı metin 12px; heading 28–32px, hero yoktur. Liste satırları bağlama göre 40/48/56px'tir.
- Hash, DSL ve teknik revision ayrıntıları varsayılan yüzeyden gizlenir. Durum yalnız renkle anlatılmaz; metin/ikon da taşır.
- Global workspace, date, compare ve source kontrolleri vardır; sayfa/kapsam bağlamı geçişte korunur.
- Right-click ve Shift+F10 aynı context menu'yu açar; mobilde eşdeğer action sheet vardır. Hover, focus ve touch durumları eşdeğer bilgi/eylem sunar.
- 320px genişlikte yatay page scroll yoktur; mobil tablo yerine kartlar kullanılır. Kapsam Raporu ayrı route'tur.
- Duplicate record yaratılmaz: legacy **Dashboard/Portföy → Operasyon**, **Kampanyalar/Künye → Operasyon**, **Rutinler/Kılavuz editörü → Kılavuzlar**, **Koşumlar/Analiz Kutusu/Bulgular → Analiz**, **Öneriler/Onay Kuyruğu/Action planları → Kararlar**, **Bağlantılar/Kaynak Sağlığı/Ayarlar/Yetki/Loglar → Sistem** eşlemesiyle eski girişler aynı kanonik kayda deep-link verir.

## Test ve rollback

Her alanın gerçek local session route’u; 320/mobile cards, 14/12/28–32 ölçüleri, 40/48/56 rows, light/dark, no-gradient, state-not-color-only, global context persistence, right-click/Shift+F10/action-sheet equivalence, hover/focus/touch, ayrı report route ve legacy deep-link/no-duplicate kabulü içerir. Klavye, AA contrast ve screen-reader açıklamaları browser matrisindedir. Kabuk flag ile geri alınır; kayıt/deep-link korunur.
