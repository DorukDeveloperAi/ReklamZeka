# KURALLAR
### yıldızdan hedefe iniş — kim çevirir, kim sorar

> Utopya'nın **tek makine-tüketilen dosyası** budur. Bir vizyon chunk'ı (`/vizyon-damit`
> çıktısı) hedefe dönüşürken kim karar verir — PM otomatik mi çevirir, insana mı sorar?
> Cevap buradaki makine bloğudur. Uyanlar: **PM (P0.75, `kurallar.mjs` ile)**. Damıtma bu
> dosyayı yorumlamaz; vizyoner yalnız kullanıcı onayıyla değiştirir.
>
> **Fail-closed:** blok yoksa, parse edilemiyorsa, tipin profili yoksa ya da chunk hiçbir
> koşula net oturmuyorsa cevap HER ZAMAN "insana sor"dur. **Tavan:** 🔴 sınıf (geri-alınamaz
> yüzeyler) hiçbir tipte otomatikleşemez.

## Yetki bloğu (makine-okunur, surum 2 — tip-profilli)

```json
{
  "surum": 2,
  "tipler": {
    "hedef":     {"otomatik": []},
    "yetenek":   {"otomatik": []},
    "nitelik":   {"otomatik": []},
    "alt-proje": {"otomatik": []},
    "vizyon":    {"otomatik": []}
  },
  "insana-sor": {"kosullar": ["yeni-yetenek-sinifi", "capraz-proje", "geri-alinamaz-yuzey", "belirsiz-kapsam"]},
  "varsayilan": "insana-sor"
}
```

Not: başlangıçta TÜM otomatik listeleri boştur = her dönüşüm insana sorulur. Otomatik-koşullar
(`tek-proje`, `kirmizi-degil`, `mevcut-yetenek-genislemesi`, `olculebilir-esik-var` …)
`/vizyoner` KURALLAR turunda kullanıcıyla birlikte açılır. Boş liste "koşulsuz otomatik"
DEĞİL "asla otomatik"tir (kurallar.mjs mekanik garantisi). `ilke` blokta yoktur — dönüşüm
nesnesi değildir: PM `istek/ilkeler.md`'yi her koşumda kısıt olarak okur.

## Giriş biçimi sözleşmesi (istek/ dosyaları)

```
<!-- uy:<tip>/<slug> -->
## Başlık
boy: kucuk|orta|epik        (opsiyonel — epik: damıtma böler, ≤5 alt-chunk)
esik: <ölçü>                (opsiyonel — nitelikte kabul kriterine iner)
<1 paragraf gövde — kullanıcı sesi esas.>
```

Slug: küçük harf, Türkçe karakterler ASCII'ye, boşluk→`-`. Çıpalar utopya genelinde
benzersizdir; fenced (```) örnek blokları çıpa sayılmaz.

## `hedef.utopyaRef` alan sözleşmesi

PM, gövdesinde `Kutup yıldızı: uy:<ref>` taşıyan gelen-notundan hedef üretirken hedef
JSON'una `"utopyaRef": "uy:<ref>[#alt-N]"` yazar. Alan opsiyoneldir; tüketiciler sistem-graf
(`vizyon→hedef icerir` kenarı) ve vizyon-damit (kapsama analizi).

---
*Bu belge hedefi anlatır; kod damgası taşımaz. Makine bloğu hariç her şey insan sesidir.*
