# Model tier politikası — hangi iş hangi modelle koşar

Tier→(model, effort) eşlemesi tek kaynaktan türer: **`~/.config/agent-ide/config.json` → `models`**;
oradan **`~/.claude/model-policy.json`**'a türetilir (agent'lar ve maestro bunu okur) ve `ana` tier'ı
**`~/.claude/settings.json` → `model`** alanına pinlenir (Claude Code'un okuduğu tek yer).
Ayarı kullanıcı `aide` TUI'nın *Yapılandır → Modeller* sekmesinden yapar. Sen yalnız **okur**, uygularsın.

**Türev dosyaları ELLE DÜZENLEME** (`model-policy.json`, `settings.json → model`): `writeModelPolicy`
üzerine yazar, değişikliğin sessizce kaybolur. Değişiklik yalnız kaynaktan (`config.json → models`) yapılır.

## Kanon — üç cümle

- **Ana loop (interaktif oturum) = Opus 5 (1M).** Uygulama, kodlama, test, planın adımlarını yürütme.
- **Plan + kompleks analiz = Fable 5.** Ana loop'un modelini değiştirerek değil, **DELEGE ederek**:
  `Agent(subagent_type: "planlayici"|"analist", model: "fable", …)`.
- **Fable yürütmez, Opus planlamaz.** Plan üreten ajanların `Edit`/`Write` aracı yoktur; ürettikleri
  adımları Opus ana loop uygular.

## Tier'lar — hangi iş hangi tier

| tier | ne zaman |
|---|---|
| `ana` | **interaktif oturum** (settings.json'a pinlenir; agent koşumunda kullanılmaz) |
| `plan` | plan, mimari, kompleks analiz/kök-neden, orchestration/brifing, uzun-ufuk ajanik iş |
| `kod` | uygulama, kod yazımı/düzenleme, refactor (pedantik) |
| `inceleme` | review, verify, adversarial doğrulama |
| `hizli` | özet, sınıflandırma, decider/watcher, mekanik tarama |

## Çözümleme

`Bash` aracın varsa:

```sh
cat ~/.claude/model-policy.json 2>/dev/null
```

Şema:

```json
{ "schema": 1,
  "tiers":  { "ana":  {"model": "claude-opus-5[1m]", "effort": "high"},
              "plan": {"model": "claude-fable-5", "effort": "high", "fallback": "claude-opus-5[1m]"} },
  "agents": { "<agent-adı>": { "kod": {"effort": "xhigh"} } } }
```

Bir tier'ın efektif ayarı = `agents.<ben>.<tier>` ile `tiers.<tier>`'ın **alan bazında**
birleşimi. Agent ezmesi kısmidir: yalnız `model`, yalnız `effort` ya da ikisi olabilir;
yazılmayan alan global tier'dan devralınır.

**Agent ezmesi, agent'ın GERÇEK tier'ı altına yazılır.** `tier: kod` olan bir agent için
`agents.<ad>.plan` yazmak **ölü kayıttır** — hiçbir zaman uygulanmaz (`aide model doctor` FAIL eder).

## Çözüleni geçirme

| dağıtım yolu | nasıl |
|---|---|
| Task/Agent tool | `model:` parametresi **OPSİYONEL** — ajanın frontmatter pini (policy türevi) geçerlidir. Etkin model yanlış ailedeyse `model-policy-guard` hook'u çağrıyı REDDETMEZ; `updatedInput` ile doğru aileye **otomatik devreder** (2026-07-16 kullanıcı kararı: iş DURMAZ, devir systemMessage ile görünür) |
| `zamanla add --new-cmd 'claude --resume <sid>'` | komuta `--model <id> [--effort <e>]` ekle |
| `zamanla add --agent <ref>` | `--tier <t>` geçir; **model/effort geçme** — launcher (`runAgent`) hedef agent'ın ezmesi dahil kendisi çözer |

## Üç sert kural

1. **Effort'u desteklemeyen modele `--effort` geçme.** Haiku 4.5 effort kabul etmez;
   geçersen API hata verir. Policy'de o tier'ın `effort` alanı zaten yoktur — alan
   yoksa bayrağı hiç ekleme.
2. **Graceful default:** `model-policy.json` yoksa, bozuksa veya tier eksikse
   **bayrak belirtme** ve görevi durdurma. Agent frontmatter'ındaki `model:` ya da
   harness varsayılanı geçerlidir. Politika okunamadı diye işi iptal etme.
3. **Fallback:** bir tier `fallback` taşıyorsa koşuma `--fallback-model <id>` ekle.
   Fable kapasite dışı kalabiliyor ("currently unavailable") — bayrak yoksa plan işi
   sessizce düşer.

## Not — yalnız dağıtan agent policy okur

Alt-görev açmayan (leaf) bir agent'ın policy'yi okumasına gerek yoktur; kendi modeli
onu başlatan launcher tarafından çözülür. Bu yüzden `tools:` listesinde `Bash`
olmayan leaf agent'lar sorunsuzdur. Orchestrator bir agent yazıyorsan `Bash`'e
ihtiyacın var.

## Denetim

`aide model doctor` — politikanın **gerçekten uygulandığını** ölçer: settings pini ↔ `ana` tier,
türev ↔ kaynak drifti, ölü agent ezmesi, tanınmayan tier/model. Bir politika, onu ölçen bir kapı
yoksa yalnızca bir niyettir.
