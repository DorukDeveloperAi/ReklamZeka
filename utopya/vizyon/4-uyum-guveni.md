# UYUM GÜVENİ — metin kuralları ve veri sınırı şartnamesi
### bölüm 4 · metin yazarlığı kısıtlarını kullanıcı koyar; sistem mekanizmayı ve denetim izini sağlar

Amaç: sağlık sektörü + KVKK bağlamında sistem hiçbir hukuki hükmü kendisi vermez;
kullanıcının koyduğu kuralları mekanik ve izlenebilir biçimde uygular.

<!-- uy:uyum-guveni/kural-motoru -->
## G4.1 — Kullanıcı-tanımlı metin kural motoru

Gereksinimler:
1. Metin kural setleri (`copy_rule_set`) üç kapsamda tanımlanır — global → İç Kampanya
   Ailesi → İç Kampanya Kategorisi — ve taksonomi mirasıyla çözülür (alt kapsam
   override eder).
2. Kural içeriğini YALNIZ kullanıcı yazar/aktive eder; `severity: block` metin
   önerisini kuyruğa girmeden düşürür, `warn` bulguyu diff'e iliştirir.
3. Kurallar üç noktada uygulanır: metin/creative önerisi üretimi · AI şablon iskeleti
   çıktısı · mevcut reklam metinlerinin periyodik taraması (rapor).

Kabul ölçütü: block kurallı bir metin önerisi kuyruğa hiç düşmez ve düşmeme nedeni
kural referansıyla loglanır; kural değişiklikleri kim-ne-zaman iziyle durur.

▸ bugün nerede — şema (`copy_rule_set`) var; motor (`copy_rules.py`) ve uygulama
noktaları yazılmadı.

<!-- uy:uyum-guveni/baslangic-paketi-pasif -->
## G4.2 — Başlangıç paketi pasif gelir

Gereksinimler:
1. Araştırmadan derlenen riskli-ifade/pratik listesi (fiyat-indirim, üstünlük, garanti,
   testimonial, önce/sonra koşulları, yönlendirme kalıpları; yapısal bayraklar: yurt içi
   hedefli sponsorluk, hasta görselli boost) sisteme `aktif=0` ve `kaynak_notu` ile
   yüklenir.
2. Aktivasyon ve düzenleme tamamen kullanıcıdadır; "sistem izin verdi/yasakladı"
   durumu tanım gereği yoktur.

Kabul ölçütü: kurulumdan hemen sonra hiçbir kural aktif değildir; her aktif kuralın
aktivasyon kaydı kullanıcı eylemine bağlıdır.

▸ bugün nerede — liste araştırma çıktısı olarak planda; veri olarak yüklenmedi.

<!-- uy:uyum-guveni/kvkk-siniri -->
## G4.3 — Kişisel veri sınırı

Gereksinimler:
1. Sistem yalnız reklam metrik/nesne verisi işler; hasta/lead kişisel verisi MVP
   yüzeyine girmez (lead kalite notu anonim/özet düzeydedir).
2. CRM kapısı (v2) açılırken eşleme hash'li alanlar + amaç sınırlaması notuyla
   tasarlanır; bu tasarım kapı açılmadan şartnameye işlenmeden kod yazılmaz.

Kabul ölçütü: ambar ve Sheets şemalarında kişisel veri alanı yoktur (şema denetimi);
v2 kapısı öncesi bu bölüm revize edilmiş olmalıdır.

▸ bugün nerede — mevcut şemalar kişisel veri içermiyor; v2 tasarım notu yazılmadı.
