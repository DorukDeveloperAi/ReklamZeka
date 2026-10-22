# REVIZYON defteri (kümülatif)

> **Kümülatif defter:** v(N+1) dosyası önceki blokları da AYNEN taşır (tek dosya, tüm geçmiş).
> Her revizyon TEK blokla açılır: sabit biçimli başlık + serbest gövde. Revize/pivot sayısı
> bu başlıklardan **SAYILIR** — sayaç dosyası YOK.
>
> **Başlık sözleşmesi** (birebir; ayraç em-dash `—`, ISO ts boşluksuz):
> `## r<N> — tip: revize|pivot — <YYYY-MM-DDTHH:mmZ>`
> Regex: `^##\s+r(\d+)\s+—\s+tip:\s*(revize|pivot)\s+—\s+(\S+)\s*$`
>
> - `<N>` = 1'den artan sıra numarası.
> - `tip: revize` = AYNI yaklaşım (aşama ekle/kır, kapsam düzelt).
> - `tip: pivot` = yaklaşım DEĞİŞİR. Ancak EKSİK'te 2 revizyon da aynı yaklaşımı yamadıysa, TEK
>   hak. v(N+1) MASTER'ında zorunlu **`## Önceki yaklaşımın otopsisi`** bölümü + `## Riskler`e
>   otopsiden türeyen tek-cümlelik kural. **AYNI yaklaşımın üçüncü denemesi YASAK.**
> - `<ts>` = revizyon anının UTC zaman damgası (boşluk içermez).
>
> **Sayaç aritmetiği:** bir `pivot` bloğu revize sayacını SIFIRLAR. İkinci pivot açılmaz; karar
> kullanıcıya döner (tavan `revize:2 + pivot:1`). Bu aritmetiği otomatik uygulayan Rotacı
> 2026-10-22'de arşive gitti.

Örnek başlıklar (yer tutucular DOLDURULMUŞ). Aşağıdaki blok GERÇEK bir revizyonda SİLİNİR,
iskeleti değil kendi bloklarınızı yazarsınız:

```
## r1 — tip: revize — 2026-01-15T09:30Z
## r2 — tip: pivot — 2026-02-03T14:00Z
```

## r<N> — tip: revize|pivot — <YYYY-MM-DDTHH:mmZ>

> Tarih: <YYYY-MM-DD> · Talimat: "<kullanıcı revize talimatı, aynen>"
> (pivot ise: v(N+1) MASTER'ında `## Önceki yaklaşımın otopsisi` bölümü ZORUNLU.)

### Neden

<Revizyonun gerekçesi: yeni ölçüm, değişen kapsam, STUCK/EKSİK, kullanıcı kararı…>
<pivot ise: iki revizyon da AYNI yaklaşımı yamadı — hangi yaklaşım neden tutmadı, yeni yaklaşımın FARKI.>

### Künye değişimi

| alan | v<N-1> | v<N> | gerekçe |
|---|---|---|---|
| Kritiklik | <değer> | <değer> | <neden değişti — değişmediyse "aynen"> |
| Aciliyet | <değer> | <değer> | <…> |
| Hacim | <değer> | <değer> | <kapsam daraldı/genişledi> |
| Hedef | <cümle> | <cümle> | <…> |

<Künye v<N>'e AYNEN taşınıyorsa tablo "aynen" satırlarıyla kalır — künyesiz v(N+1) YASAK
(gate advisory'si `--kunye`'de görünür, tüketici sırasız kalır). Pivotta kritiklik/aciliyet
çoğu zaman DEĞİŞİR: yaklaşım değiştiyse aciliyet gerekçesi de yeniden ölçülür.>

### Değişenler

| aşama | v<N-1> | v<N> | not |
|---|---|---|---|
| <NN> | <özet> | <özet> | yeniden kırıldı / silindi / eklendi |

### Aynen taşınanlar

- Aşama <NN> — <ad> (yeniden planlatılmadı; tamamlanmış maddeler işaretli taşındı)

### Taşınan ilerleme

<STATE/CHECKLIST'ten hangi işaretler taşındı; kanıtları hâlâ geçerli mi (damga/tazelik notu)>
