---
kosum: tek-ajan   # ya da: workflow:<sablon-ref> — karar kılavuzu: plan-kur SKILL.md "Koşum türü"
---
# Aşama <NN> — <AD> (v<N>)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: <aşama listesi ya da "—">
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

<Bu aşamanın var olma sebebi + gerekli arka plan; MASTER'a bakmadan anlaşılır olacak kadar.
İlgili dosya yolları, ölçülmüş sayılar, önceki aşamaların bıraktığı durum.>

## SONUÇ

**Bu aşama bitince:** <ölçülebilir ürün-gerçeği yüklemi/yüklemleri>

## Önkoşullar

- <önkoşul + nasıl doğrulanır (komut)>

## Task'lar

### T<NN>.1 — <task adı>
**SONUÇ:** <yüklem>
**Subtask'lar:** <somut adımlar (dosya/komut düzeyi)>
_— YA DA —_
**Subtask-üretici:** `<komut>` → bulguları şu kurala göre task'a çevir: <kural>.
Bulgu kaybolunca task kapanır.
**Kabul kriteri (kanıt):** `<komut>` → <beklenen çıktı>

### T<NN>.2 — …

## Task checklist

- [ ] T<NN>.1 — <kısa ad> · kanıt: <komut → beklenen>
- [ ] T<NN>.2 — …

## Aşama requirements

- <yüklem> · doğrulama: <komut/kanıt>

## Doğrulama (aşama kapanışı)

<Uçtan uca kanıt dizisi. İdempotens: aynı doğrulamayı iki kez koşmak hükmü değiştirmemeli.>

## Efor/maliyet notu

<tarayıcı-ağır / token-ağır / tahmini süre>

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
