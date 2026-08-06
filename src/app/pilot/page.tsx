import Link from "next/link";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";
import {
  nextPilotStep,
  parsePilotFeedback,
  parsePilotStep,
  PILOT_STEPS,
  PILOT_STEP_LABELS,
  pilotProgress,
  type PilotFeedback,
  type PilotStep,
} from "./journey";
import { DemoShareControls } from "./demo-share-controls";

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value / 100);
}

function StepContent({ step, feedback }: { step: PilotStep; feedback: PilotFeedback | null }) {
  const performance = dashboardResponse(7, "ready").snapshot;
  const insights = insightsResponse(7, "delayed");
  if (step === "session") return <><span className="eyebrow">PİLOT ERİŞİMİ</span><h1>Güvenli karar destek yolculuğu</h1><p>Canlı pilot oturumu sunucu tarafı çalışma alanı üyeliğiyle sınırlandırılır. Bu sürüş anonim demo kimliğiyle ürün akışını doğrular.</p><div className="pilot-proof"><strong>Demo oturumu doğrulandı</strong><span>demo-analyst · analyst rolü · salt-okunur ürün sınırı</span></div></>;
  if (step === "workspace") return <><span className="eyebrow">ÇALIŞMA ALANI</span><h1>Demo Marka çalışma alanı</h1><p>Müşteri, hesap ve kampanya verisi yalnız bu çalışma alanının üyeleri için sunucu tarafında filtrelenir.</p><dl className="pilot-facts"><div><dt>Rol</dt><dd>Analyst</dd></div><div><dt>Hesap</dt><dd>2 bağlı kaynak</dd></div><div><dt>Para birimi</dt><dd>TRY</dd></div></dl></>;
  if (step === "source") return <><span className="eyebrow">VERİ KAYNAĞI</span><h1>Salt-okunur kaynağı seçin</h1><p>Platform bağlantıları yalnız okuma kapsamı ister; CSV aynı kanonik doğrulamadan geçer.</p><div className="source-grid"><article><strong>Meta Ads</strong><span>ads_read · bağlı</span></article><article><strong>Google Ads</strong><span>google_ads.readonly · bağlı</span></article><article><strong>CSV</strong><span>Şema kontrollü fallback</span></article></div></>;
  if (step === "sync") return <><span className="eyebrow">İLK SENKRONİZASYON</span><h1>Kaynak izi korunarak tamamlandı</h1><p>Cursor checkpoint, retry ve içerik hash'iyle aynı veri yeniden işlendiğinde kayıt çoğalmaz.</p><dl className="pilot-facts"><div><dt>Durum</dt><dd>Tamamlandı</dd></div><div><dt>Kaynak</dt><dd>Meta + Google</dd></div><div><dt>Tazelik</dt><dd>4 saat</dd></div></dl></>;
  if (step === "dashboard") return <><span className="eyebrow">7 GÜNLÜK GENEL BAKIŞ</span><h1>İki kanal, aynı kanonik görünüm</h1><p>Para birimi, saat dilimi ve attribution penceresi toplamların yanında görünür kalır.</p><div className="pilot-metrics"><article><span>Harcama</span><strong>{money(performance.current.spendMinor)}</strong></article><article><span>Dönüşüm</span><strong>{performance.current.conversions}</strong></article><article><span>ROAS</span><strong>{performance.current.roas?.toFixed(2)}×</strong></article></div><Link className="quiet-link" href="/dashboard">Detaylı dashboard'u aç</Link></>;
  if (step === "insights") return <><span className="eyebrow">AÇIKLANABİLİR İÇGÖRÜ</span><h1>{insights[0]?.title ?? "Güvenilir sapma bulunmadı"}</h1>{insights[0] ? <><p>{insights[0].explanation}</p><div className="pilot-proof"><strong>Kanıt ve güven</strong><span>{insights[0].evidence.metric} · eşik {insights[0].evidence.threshold} · güven %{Math.round(insights[0].confidence.score * 100)}</span></div><p><strong>Sonraki güvenli adım:</strong> {insights[0].recommendedAction}</p><nav className="feedback-actions" aria-label="İçgörü geri bildirimi"><Link href="?step=insights&feedback=helpful" aria-current={feedback === "helpful" ? "true" : undefined}>Yararlı</Link><Link href="?step=insights&feedback=unhelpful" aria-current={feedback === "unhelpful" ? "true" : undefined}>Yararsız</Link><Link href="?step=insights&feedback=acted" aria-current={feedback === "acted" ? "true" : undefined}>Aksiyon alındı</Link></nav>{feedback ? <p role="status" className="feedback-status">Geri bildirim kaydedildi: {feedback}</p> : null}</> : null}</>;
  return <><span className="eyebrow">PAYLAŞIM</span><h1>Salt-okunur rapor hazır</h1><p>Rapor aynı dashboard snapshot'ını, tazelik ve kaynak bilgisini taşır; süreli bağlantı iptal edilebilir.</p><div className="pilot-proof"><strong>Paylaşım politikası</strong><span>read_only · 24 saat · snapshot bağlı · audit kaydı açık</span></div><DemoShareControls /><Link className="quiet-link" href="/reports/demo">İmzasız görsel önizlemeyi aç</Link></>;
}

export default async function PilotPage({ searchParams }: { searchParams: Promise<{ step?: string; feedback?: string }> }) {
  const params = await searchParams;
  const step = parsePilotStep(params.step);
  const feedback = parsePilotFeedback(params.feedback);
  const next = nextPilotStep(step);
  return <main className="pilot-shell">
    <header className="pilot-top"><Link href="/" className="quiet-link">ReklamZeka</Link><span>{PILOT_STEPS.indexOf(step) + 1} / {PILOT_STEPS.length}</span></header>
    <div className="pilot-progress" role="progressbar" aria-label="Pilot yolculuğu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pilotProgress(step) * 100)}><span style={{ width: `${pilotProgress(step) * 100}%` }} /></div>
    <nav className="pilot-steps" aria-label="Pilot adımları">{PILOT_STEPS.map((item, index) => <Link key={item} href={`?step=${item}`} aria-current={item === step ? "step" : undefined} data-complete={index < PILOT_STEPS.indexOf(step)}>{PILOT_STEP_LABELS[item]}</Link>)}</nav>
    <section className="pilot-stage" aria-label="Aktif pilot adımı"><StepContent step={step} feedback={feedback} /></section>
    <footer className="pilot-actions">{step !== "session" ? <Link href={`?step=${PILOT_STEPS[PILOT_STEPS.indexOf(step) - 1]}`}>← Geri</Link> : <span />}{next ? <Link className="pilot-next" href={`?step=${next}`}>{PILOT_STEP_LABELS[next]} →</Link> : <Link className="pilot-next" href="/reports/demo">Önizlemeyi görüntüle →</Link>}</footer>
  </main>;
}
