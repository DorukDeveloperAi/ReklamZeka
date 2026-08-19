# P07-C — Statik erişilebilirlik foundation

**Karar:** Kabul edildi; kod ve birim-test düzeyinde kısmi erişilebilirlik dilimi. Authenticated gerçek browser kabulü kapsam dışıdır.

## Sözleşme

- Dashboard ve rapor skip linkleri tekil, programatik odaklanabilir `main` hedeflerine gider.
- Operasyon ve Kapsam Raporu tabloları scoped column header kullanır; yatay alanlar isimli, klavye ile odaklanabilir region'lardır.
- Loading/error/empty/partial/ready ve kaynak durumları uygun live/status semantiğiyle duyurulur.
- Local session connector ID'leri aynı sayfadaki Operasyon/Kapsam yüzeyleri arasında çakışmaz.
- Reduced-motion tercihi korunur. 320 px görünümde kesintisiz uzun public ref, ad ve reason code mobile card veya rapor başlığını taşırmaz.

## Kanıt

- Bağımsız kritik final: ACCEPT.
- Focused 3 dosya / 14 test PASS; `git diff --check` PASS.
- Operation mobile card/container ve riskli text/dl descendants `min-width: 0` + `overflow-wrap: anywhere` hostile regression'ından geçti.
- ReportView ve ReportUnavailable `report-content` hedefleri `tabIndex={-1}` taşır.
- Scope: isimli/tabbable regionlar, 16 scoped column header, live states, unique connector IDs ve uzun-ref wrap doğrulandı.
- Operation: row/rowgroup/column semantiği ile loading/error/empty/partial/ready duyuruları doğrulandı.

## Açık işler

- Kullanıcının local-session capability'yi açık tarayıcı ekranına bağlaması sonrası gerçek klavye/screen-reader/browser matrisi
- P08 viewport, browser, rollout ve operasyon kabulü
