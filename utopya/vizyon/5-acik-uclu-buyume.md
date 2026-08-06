# AÇIK UÇLU BÜYÜME — genişleme şartnamesi
### bölüm 5 · yeni strateji dünyaları kod değişmeden, konfigürasyonla eklenir

Amaç: motor hiçbir dikeye (boost, bilinirlik, satış…) bağlı değildir; kullanıcının
strateji evreni büyüdükçe sistem veriyle büyür.

<!-- uy:acik-uclu-buyume/dikey-agnostik-motor -->
## G5.1 — Dikey-agnostik taksonomi motoru

Gereksinimler:
1. İç Kampanya Ailesi → Kategori → Örnek üç katmanı açık uçludur; attribute, KPI
   hedefi, kural ve analiz mantığı herhangi bir katmanda tanımlanıp miras/override
   ile çözülür.
2. Motor kodu hiçbir aile adını bilmez; "Marka Doktor" ve "Satış" yalnız veridir.
3. Yeni aile/kategori tanımında AI, boyutların (mecra, sayfa türü, amaç kapsamı)
   mantığından şablon iskeleti önerir; kullanıcı düzenleyip aktive eder.

Kabul ölçütü: birbirine zıt iki ölçüm dünyası (boost/bilinirlik ↔ dönüşüm/ROAS) aynı
motorda, sıfır kod farkıyla değerlendirilir; üçüncü bir aile provası kod diff'i
olmadan tamamlanır.

▸ bugün nerede — `resolve_effective_config` yazıldı ve 5 birim testi yeşil; AI
iskelet akışı ve Sheets tanım döngüsü yok.

<!-- uy:acik-uclu-buyume/konfigle-genisleme -->
## G5.2 — Her genişleme ekseni konfigürasyondur

Gereksinimler:
1. Yeni amaç kapsamı, mecra, sayfa türü, digest sink'i ve rubrik yalnız veri/konfig
   satırıdır (Sheets ya da YAML).
2. Meta erişim katmanı tek geçiş noktasının (gateway) arkasındadır; sağlayıcı
   değişikliği (resmî MCP → alternatif) tek modül değişimidir.

Kabul ölçütü: "kod değişmeden yeni kategori + yeni sink" provası belgelenmiş ve
tekrarlanabilir durumdadır.

▸ bugün nerede — gateway iskeleti ve rubrik YAML düzeni var; sink kaydı ve Sheets
konfig döngüsü yok.

<!-- uy:acik-uclu-buyume/crm-kapisi -->
## G5.3 — CRM açık kapısı (v2)

Gereksinimler:
1. Satış dünyasının offline gerçeği (CRM'de kapanan satış) v2'de Conversions API +
   dataset + `lead_id` eşlemesiyle sisteme bağlanır; o güne dek CPA/ROAS "piksel-görünür
   alt sınır + ölçülemedi" olarak raporlanır.
2. Kendi tarafımızda paralel lead→satış eşleme defteri tutulur; Meta atribüsyonuna
   tek başına güvenilmez.

Kabul ölçütü: v2 kapısı açıldığında Satış rubriği gerçek kapanış verisiyle beslenir
ve digest'te "ölçülemedi" satırları kapanmış olur.

▸ bugün nerede — kapı kararı verildi (kullanıcı, 2026-08-06: "CRM var, v2'de");
hiçbir entegrasyon yok.
