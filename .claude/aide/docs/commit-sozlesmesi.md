# Commit sözleşmesi — geçmişi araştırılabilir tutmak

> Bu belge `aide sync` ile kurulur. Kanon: `/Users/ybg/dev/agent-ide/packages/kit/templates/docs/commit-sozlesmesi.md`.
> Motor tarafı: `packages/core/src/commit-mesaji.ts` · Log tarafı: `packages/core/src/durum-log.ts`.

Bir commit iki soruya cevap verir: **ne değişti** ve **neden**. Diff birinciyi zaten
söyler. Commit mesajının asıl işi ikincisidir — çünkü altı ay sonra `git log`'a bakan
kişi (çoğu zaman sensin ya da bir ajan) diffi okuyabilir ama *kararı* okuyamaz.

**Ölçüm (2026-07-26, agent-ide):** son 40 commit'in **35'i** `auto: <zaman>` ya da
`aide tasima: <zaman>` idi. Yani geçmiş vardı, bilgi yoktu. Bu sözleşme onun cevabıdır.

---

## 1. İki sınıf — ve karıştırılmazlar

| sınıf | kim yazar | neden'i bilir mi | biçim |
|---|---|---|---|
| **İŞ commit'i** | insan ya da Claude oturumu | **evet** | aşağıdaki sözleşme |
| **CHECKPOINT** | motor (`aide tasima` · cron) | hayır | `cp(...)` — motor TÜRETİR |

Motor "neden" uyduramaz: uydurmak için LLM doğurması gerekirdi ve checkpoint 15 dakikada
bir koşar (agentic bir checkpoint sürekli token yakardı). Yapabildiği şey **ölçmektir** —
kapsam, dosya sayısı, satır sayısı. Bu yüzden checkpoint mesajları artık şöyledir:

```
cp(core,docs): 4 dosya · +118/-37

packages/core/src/tasima.ts   +80 -12
docs/DURUM.md                 +38 -25
… +2 dosya

Aide-Tur: checkpoint
Aide-Tetik: tasima
```

**Checkpoint'i elle yazma, iş commit'ini motora bırakma.** Ayrım ölçülebilir olsun diye
sınıf hem konu biçiminde (`cp(`) hem `Aide-Tur:` trailer'ında durur; `docs/DURUM.md`
checkpoint'leri eleyip yalnız iş commit'lerini raporlar.

---

## 2. İş commit'i biçimi

```
<kapsam>: <ne değişti — olgusal, ≤72 karakter>

<NEDEN — hangi problem/gözlem tetikledi. 1-3 cümle.>
<SONUÇ — davranış nasıl değişti; bir sözleşme kırıldıysa AÇIK yaz.>

Kanıt: <iddiayı ölçen şey — komut · çıktı · dosya:satır · test adı>
Ref:   <plan/aşama · alarm id · karar tarihi>   (varsa)
```

**Konu satırı**

- `<kapsam>:` zorunlu — bkz. §3. Birden çok kapsam virgülle: `core,vscode: …`
- Türkçe, **olgusal** ("teslim alma yönüne kendi palet girişi"), emir kipi şart değil.
- ≤72 karakter. Sığmıyorsa değişiklik muhtemelen iki commit'tir.
- Nokta ile bitmez. "güncelleme", "düzeltme", "iyileştirme" gibi **içeriksiz** kelimeler
  tek başına kullanılmaz — neyin düzeldiğini söyle.

**Gövde — ne zaman gerekir**

Değişiklik konu satırından tam anlaşılıyorsa gövde YAZMA. Aksi hâlde gövde şu üçünü
kapatır ve **12 satırı geçmez**:

1. **Neden** — hangi gözlem, ölçüm, hata ya da kullanıcı kararı bunu tetikledi.
2. **Ne değişti** — davranış düzeyinde (dosya düzeyinde değil; onu diff söyler).
3. **Sonuç / risk** — ne kırıldı, kaçış valfi ne, geri alma nasıl.

**Yasak:** diffin düzyazı tekrarı. "`foo.ts`'e `bar()` eklendi, `baz.ts`'ten `qux()`
silindi" satırları bilgi taşımaz — `git show` bunu zaten verir.

---

## 3. Kapsam sözlüğü (motorla AYNI tablo)

Kapsamı motor yoldan türetir (`yolKapsami()`); elle yazarken aynı adları kullan ki
checkpoint'lerle iş commit'leri aynı eksende toplanabilsin:

| yol | kapsam |
|---|---|
| `packages/<ad>/**` | `<ad>` (ör. `core`, `vscode`, `maestro`) |
| `.claude/filing/**` | `filing` |
| `.claude/skills/**` · `.claude/agents/**` | `skill` · `agent` |
| `.claude/**` (diğer) | `claude` |
| `docs/gunluk/**` | `gunluk` |
| `docs/**` | `docs` |
| `plans/**` | `plan` |
| `jobs/**` · `bin/**` · `scripts/**` | `jobs` · `bin` · `scripts` |
| kökteki dosya | `kok` |

Kapsam yoksa (`README` dışı, sınıflanamaz) `kok` kullan — **boş bırakma**: kapsamsız
commit DURUM logunda `?` olarak birikir.

---

## 4. Trailer'lar

Gövdenin sonunda, boş satırla ayrılmış:

| trailer | ne zaman | değer |
|---|---|---|
| `Aide-Tur:` | sınıf belirsizse | `is` · `checkpoint` · `birlesme` |
| `Aide-Tetik:` | motor yazımı | `tasima` · `cron` · `elle` |

Sınıflandırma trailer'a **tek başına** güvenmez (sözleşmeden önceki geçmiş onu taşımaz):
sırayla trailer → konu biçimi → eski desenler (`auto:`, `aide tasima:`) ölçülür. **Şüphede
commit İŞ sayılır** — ters varsayım gerçek işi geçmişten sessizce silerdi.

---

## 5. Örnekler

**İyi — kısa, konu yeter:**

```
filing: teslim alma yönüne kendi palet girişi (erişim eksiği)
```

**İyi — gövde gerekiyor:**

```
core: DURUM logu checkpoint döngüsünü kıracak biçimde türetiliyor

DURUM.md'yi taşıyan checkpoint, DURUM.md'nin içeriğini değiştirseydi her tick
yeni bir commit doğururdu (15 dk × sonsuz, sıfır iş için). İçerik artık yalnız
iş commit'lerinin ve plan durumunun fonksiyonu: "şu an" damgası, HEAD hash'i ve
checkpoint sayısı BİLEREK dışarıda.

Sonuç: bir iş commit'i düşünce DURUM bir kez değişir, bir checkpoint onu taşır,
sistem tek adımda yakınsar. Parmak izi tarafı da ucuz tutuldu (git-tarafı eleme,
-n1) — boot'un "2. koşum ~0 maliyet" sözleşmesi korunuyor.

Kanıt: packages/core/test/durum-log.test.ts → "YAKINSAMA" · 54/54 yeşil
Ref:   kullanıcı kararı 2026-07-26 (commit sözleşmesi + durum logu)
```

**Kötü — ve nedeni:**

| commit | sorun |
|---|---|
| `auto: 2026-07-26 16:00:00` | sınıfı doğru ama elle yazılmış olsaydı bilgi sıfır |
| `fix` · `güncelleme` · `wip` | kapsam yok, ne değiştiği yok, neden yok |
| `core: tasima.ts güncellendi` | diffin tekrarı — dosya adı bilgi değil |
| `çok şey değişti, detay için diffe bak` | commit'in var oluş sebebini reddediyor |

---

## 6. Bağlı yüzeyler

- **`docs/DURUM.md`** — projenin anlık durumu. TÜREV, motor yazar (`aide durum`),
  checkpoint'leri eler. Elle düzenleme sapmadır.
- **`docs/durum/<YYYY-MM-DD>.json`** — makine-okunur arşiv. **Yalnız durumun değiştiği
  gün** yazılır; yani klasörün kendisi bir etkinlik kaydıdır.
- **`docs/gunluk/`** — günlük anlatı/kronik. **AGENTIC** (gunlukcu ajanı, token harcar) —
  DURUM'un deterministik olduğu yerde bu yorum katmanıdır. İkisi karıştırılmaz.

```bash
aide durum            # üret (değişmediyse HİÇBİR ŞEY yazmaz)
aide durum --kuru     # ne yazardı?
aide durum goster     # üretileni bas, diske dokunma
git log --oneline --invert-grep --grep='^cp(' --grep='^auto: '   # yalnız İŞ commit'leri
```

---

## 7. Sözleşmenin kuralları

1. **Motor "neden" uydurmaz** — checkpoint ölçer, iş commit'i açıklar.
2. **Diffin tekrarı yazılmaz** — commit kararı taşır, dosya listesini değil.
3. **Kapsam zorunlu** — kapsamsız commit DURUM logunda `?` olarak birikir.
4. **Şüphede İŞ** — sınıflandırılamayan commit checkpoint sayılmaz, geçmişten silinmez.
5. **12 satır tavanı** — daha uzun gerekiyorsa yeri commit değil `docs/` ya da bir plandır.
