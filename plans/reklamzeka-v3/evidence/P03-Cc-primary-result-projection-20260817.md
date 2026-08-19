# P03-Cc — Primary result Operasyon projection kanıtı

## Kabul edilen kapsam

- `operation-read/2.0.0` bounded decimal-string projection ve strict UI parser.
- Görünür sayfa için ayrı, bounded binding/metric okuması; campaign ve ad-set grain'leri karışmaz.
- Slice binding → Kurum Kampanyası fallback → unbound önceliği, aynı RR/read-only transaction içindeki trusted action catalog ve canonical revision doğrulamasıyla çözülür.
- Bilinen `0` sonuç gösterilir; payda sıfırken maliyet `null` kalır. Eksik/unsupported gün, currency veya attribution tutarsızlığı sıfır sayılmaz.
- Cursor v3 yalnız stable public campaign/ad-set refs kullanır ve workspace+dönem+slice bağlam hash'ine bağlıdır.
- Desktop/mobile kaynak etiketi yalnız `slice_binding | organization_campaign_fallback | unbound | unavailable` kanonik durumlarını gösterir; hiçbir Guide/karar kaynağı uydurulmaz.

## Fail-closed bütünlük

- Decimal değerler non-negative, canonical, toplam 38 digit/18 scale sınırındadır; padded/trailing-zero ve state/source/value/cost uyumsuzlukları reddedilir.
- Head ve latest revision binding/subject/market/version envelope'u exact doğrulanır. Görünür subject'in immutable revision geçmişi varsa tam bir doğrulanmış head zorunludur; replica head update/delete ve revision tamperi `503` sınırına normalize edilir.
- Revision geçmişi materialize edilmez: current subject kimlikleri `DISTINCT ON`, `LIMIT expectedSubjects+1` ve explicit cardinality guard ile bounded kalır.
- Spend yalnız her beklenen gün için tam bir available, exact-currency metric olduğunda yayımlanır. Duplicate gün/attribution, action-spend disjoint attribution, unavailable gün, currency ve partial coverage `null` + typed reason/non-ready üretir.

## Canlı ve test kanıtı

- Bağımsız kritik karar: `ACCEPT`.
- Focused: 7 dosya / 31 test geçti; ek bounded-history regresyonuyla yerel focused toplamı 22/22 geçti.
- `npm run typecheck` ve `git diff --check` geçti.
- `npm run verify:operation-read-live`: gerçek outer-rollback fixture; global org fallback, scoped slice override, slice-unbound fallback, campaign/ad-set exact grain, known-zero cost null, missing/non-ready/partial/currency/duplicate/disjoint attribution, unavailable spend no-inflation, revision/head update+delete tamperi, cursor context, `writeOperations=0`, zero residue geçti.

## Açık kalan kapsam

P03'ün saved view, ayrı Kapsam Raporu/export ve P07 gerçek oturumlu browser satır kabulü bu alt paketin dışındadır.
