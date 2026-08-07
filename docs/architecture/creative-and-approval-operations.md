# Yayındaki reklam metni, existing-post promotion ve atomik onay sözleşmesi

## Amaç

ReklamZeka mevcut reklam içeriğini kayıpsız okur ve bağlı Instagram/Page gönderisini
yayınlanmış şablon + ön ayarlı hedef kitleyle reklamlaştırabilir. Sistem yeni reklam metni,
görseli, videosu veya creative varyantı üretmez/değiştirmez. Her write kullanıcı tarafından
ayrı ayrı kontrol edilir.

## Okunan creative gerçeği

`CreativeContentSnapshot` şunları taşır:

- primary text/body, headline/title, description/caption;
- CTA type/label, destination/deep link, display link;
- Page/Instagram actor, creative ID, object-story/post/media ID;
- image/video/carousel ve dynamic asset-feed metin/medya varyantları;
- bağlı ad/ad set/campaign, configured/effective status ve snapshot zamanı;
- her alan için source field, raw payload hash ve `known/absent/unavailable` durumu.

“Yayındaki metin” yetkili Meta creative/spec ve linked-post verisinden türetilir; scraping
veya model tahmini kullanılmaz. Dynamic creative tek bir hayali metne indirgenmez.

## PromotionTemplate ve AudiencePreset

`PromotionTemplateVersion` şu frozen bağları taşır:

- alias/description/examples ve uygulanabilir internal category/account/actor/post type;
- objective/optimization, destination, placement ve tracking/naming;
- mevcut campaign/ad set'i kullanma veya gerektiğinde yenisini oluşturma politikası;
- budget/schedule default/floor/cap;
- zorunlu `AudiencePresetVersion` referansı;
- approval/risk policy ve capability snapshot gereksinimleri.

`AudiencePresetVersion` immutable targeting spec veya izinli Meta saved/custom audience
referansıdır. Agent yalnız yayınlanmış sürümü seçebilir; geo, yaş, dil, interest/custom
audience veya exclusion üretemez/değiştiremez.

## Existing-post promotion preflight

1. Workspace/account/actor ownership ve permission.
2. Post/media varlığı, lifecycle ve promotion capability.
3. PromotionTemplate ve AudiencePreset scope/selector uyumu.
4. Objective/optimization, placement, destination, special category ve tracking uyumu.
5. Resolved budget owner, spend etkisi, schedule ve parent status chain.

Uygun mevcut ad set kullanılabilir; yoksa template'in izin verdiği campaign/ad set/ad
yapısı proposal olur. Desteklenmeyen post veya belirsiz template fail-closed reason taşır.

## Action bundle ve atomik kararlar

```text
ExistingPostPromotionIntent
  └─ ActionBundle
      ├─ U1 post identity/content preview
      ├─ U2 PromotionTemplate + AudiencePreset
      ├─ U3 campaign create/update              (gerekiyorsa)
      ├─ U4 ad-set create/update                (gerekiyorsa)
      ├─ U5 budget set
      ├─ U6 creative-reference + ad create/publish
      └─ U7 activate
```

Bundle yalnız gruplama/dependency DAG'ıdır. Her `ActionUnit` typed target, before/after,
post/template/audience preview, spend delta, evidence/policy, risk, frozen version/hash,
approval, idempotency, Meta result ve verify taşır. Bir unit'ın onayı diğerini onaylamaz;
rejected/stale/onaysız dependency downstream execute'u durdurur. Bulk seçim yalnız açık
kullanıcı işlemiyle ve child başına ayrı approval record'la mümkündür.

## Approval-only ve session içi onay

Default `approval_only` profilde K1–K4 her write unit'ı insan onayı ister. Agent/schedule
yalnız proposal hazırlar; expiry veya child scope profili genişletmez. Dashboard veya local
`reklamzeka` companion, TTY/passkey sonrası tek unit/spec'e bağlı HumanPresenceGrant üretir.
Model bu grant'i mint edemez. Approval execute değildir.

Onay frozen bileşimi:

`postContentHash + actorId + promotionTemplateVersion + audiencePresetVersion + destination + targetAdSet + budgetPlanVersion + schedule`

Bir parça değişirse ilgili ve downstream onaylar stale olur.

## Kabul değişmezleri

1. Active ad copy source creative/post alanına izlenir; eksik alan uydurulmaz.
2. Uygun olmayan post reason code ile proposal-ready değildir.
3. Agent targeting veya yeni creative/metin üretemez.
4. Approval-only profilde K1 dahil hiçbir write otomatik çalışmaz.
5. Bir bundle unit onayı sibling/downstream unit'ı onaylamaz.
6. Post/template/audience/spec değişikliği eski onayı geçersiz kılar.
