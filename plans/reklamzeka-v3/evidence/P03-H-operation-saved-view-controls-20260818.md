# P03-H — Operasyon saved-view ve table controls kabulü

**Karar:** ACCEPT — schema-free, salt-okunur Operasyon ürün yüzeyi. Bu alt paket gerçek oturumlu browser kabulünü kapsamaz.

## Uygulanan sözleşme

- `operation-saved-view/1.0.0` yalnız exact-key, bounded arama ve kapalı pazar/source-state/seviye/sort/direction değerlerini kabul eder.
- Görünüm Meta veya action girdisi değildir; yalnız aynı cihazda filtre tanımı olarak saklanır, sıfırlanabilir ve bozuk storage girdisi sessizce yok sayılır.
- Tablo pazar, source-state, campaign/ad-set seviyesi ve public ref/ad aramasıyla filtrelenir; hiyerarşi, ad ve source-state sıraları deterministic ikincil kimlik sırasına sahiptir.
- Subtotal yüzeyi satır, ready ve incomplete sayımı ile kanonik `primaryResultCostMinor` mevcudiyet sayısını gösterir. `operation-read/2.0.0` workspace currency taşımadığından bütçe/harcama toplamı veya para etiketi üretilmez.
- Kampanya aç/kapat hiyerarşisi ve mobil `Satır kanıtını incele` ayrıntısı gerçek kaynak-state/missing-day/reason kanıtına drill eder. Yüzey salt okunurdur; approve/execute/Meta write aksiyonu yoktur.

## Doğrulama

- Odak: `tests/operation-table-panel.test.ts`, `tests/operation-read-model.test.ts`, `tests/operation-read-service.test.ts` — 15/15.
- Tam suite: 559 dosya / 2707 test PASS.
- Global TypeScript ve `git diff --check` PASS.
- Responsive/browser oturum matrisi R3-20/R3-22 kapsamında ayrıca açık tutulur.
