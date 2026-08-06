# <ROADMAP ADI> — MASTER (v<N>)

> Üretici: /plan-kur · Tarih: <YYYY-MM-DD> · Kaynak görev: "<ana görev tarifi, aynen>"
> Kategori: <proje|özellik|altyapı|süreç|araştırma> · Üst: <üst-plan-slug ya da —>
> Kritiklik: <düşük|orta|yüksek|kritik> · Aciliyet: <ertelenebilir|normal|yakın|acil> · Hacim: <küçük|orta|büyük|epik>
> Hedef: <TEK cümle — bu plan bitince dünyada ne değişmiş olur>
> Kapatır: <td:<etiket>/<ref>[, …] — bu plan hangi genel-TODO maddelerini kapatıyor; YOKSA BU SATIRI SİL>
> Sürüm: v<N> <v2+ ise: (önceki: v<N-1>, değişiklikler REVIZYON.md'de)>

<!-- KÜNYE (zorunlu, 2026-07-26): bu 4 alan planın kimlik kartıdır — "hangi plan önce"
     sorusunu tahmin değil künye yanıtlar. `oncelik` (P0-P3) TÜREVDİR, elle YAZILMAZ:
     agac.mjs hesaplar (min(3, round((kritiklik+aciliyet)/2))). Şema dışı değer gate FAIL'idir.
     Kritiklik = olmazsa ne kırılır · Aciliyet = zaman baskısı · Hacim = iş büyüklüğü.
     `Kapatır:` OPSİYONELDİR ve künyeden AYRI sınıftır: sorunu gate'i KIRMAZ, ADVISORY üretir
     (künye SIRALAR — yanlışı zehirler; Kapatır yalnız kapsama raporunu besler). Ref'ler
     `agac.mjs --todo --json` çıktısından BİREBİR alınır. Tüketicisi: agac.mjs ters-bağ
     (`todo.maddeler[].kapatan`) + `agac.mjs --kunye` plansız-madde raporu — rezerv alan DEĞİL. -->

## Amaç ve başarı tanımı

<Görevin niyeti, 2-4 cümle. Sonra:>

**BAŞARI =** <ölçülebilir bitiş hali; hangi kanıt kümesi "bitti" ilan eder>
**Durma kuralı:** <yakınsama ölçümü; STUCK/eskalasyon koşulu>

## Aşamalar ve bağımlılık grafiği

| # | aşama | SONUÇ (bitince dünya nasıl?) | bağımlı | dosya |
|---|---|---|---|---|
| 01 | <ad> | <ölçülebilir yüklem> | — | [asama-01-<ad>.md](asama-01-<ad>.md) |
| 02 | <ad> | <…> | 01 | [asama-02-<ad>.md](asama-02-<ad>.md) |

<Gerekirse metin/mermaid ile grafiğin açıklaması.>

## /goal komutları (fire-and-forget)

Sırayla, her biri ayrı session'da:

```
/goal plans/<slug>/v<N>/asama-01-<ad>.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/<slug>/v<N>/asama-02-<ad>.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
```

## Global requirements

→ [REQUIREMENTS.md](REQUIREMENTS.md) (tek toplam; burada tekrar edilmez)

## Riskler

- <risk> — <etki/önlem>

## İLAN EDİLMİŞ muafiyetler (kapsam dışı, gerekçeli)

- <muaf yüzey> — <gerekçe> <mümkünse: muafiyetin ölçüme bağı>
