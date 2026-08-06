# ADR-0009 — Kullanıcı talimatları, miras ve çatışma

## Durum

Kabul — 2026-08-06

## Bağlam

Kullanıcı “pahalı olsa da bu bölgenin bütçesini taşıma” gibi metrikten bağımsız
iş kuralları tanımlamak istiyor. Bunların enforceable kısmı serbest prompt olarak kalırsa
tekrar üretim, çatışma çözümü, etki önizleme ve güvenli execution mümkün değildir. Bununla
birlikte her analitik görüşün ilk günden enforceable policy olması gerekmez; ADR-0013 soft
guidance yolunu ekler.

## Karar

- Ham talimat değişmeden saklanır. Analitik/stratejik içerik G0–G2 guidance olarak scoped,
  versioned ve retrievable olabilir; action/budget/approval'ı bağlayan clause için agent
  strict normalize-policy **taslağı** üretir.
- Taslak scope, policy type, priority, effective dates, unit/window, reason, assumptions,
  affected entities ve conflict preview taşır; insan publish etmeden yürürlüğe girmez.
- Politika scope'u workspace→account→category→campaign→adset→ad'dır.
- Öncelik: platform/hukuk+tenant → hard safety → locked user instruction → budget
  commitment → entity exception → internal category → Meta objective → metric rule → advisor.
- Aynı kademede daha spesifik scope, sonra daha yeni published version kazanır.
- Bastırma iz bırakır; çözülemeyen conflict fail-closed `PARKED_CONFLICT` olur.
- Düzenleme yeni immutable version; silme audit nedeniyle archive/tombstone'dur.

## Sonuçlar

Kullanıcı doğal dil kolaylığını korur; soft guidance esnek, yürütmeyi bağlayan karar yolu
deterministik ve denetlenebilir kalır. Prompt injection policy değiştiremez. UI raw owner
wording, guidance synthesis ve normalize policy yorumunu ayrı göstermelidir.
