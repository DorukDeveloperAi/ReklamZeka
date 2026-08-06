const principles = [
  ["Birleşik görünüm", "Meta Ads ve Google Ads verisini kaynak bağını kaybetmeden ortak metriklerde karşılaştır."],
  ["Açıklanabilir içgörü", "Her sapmanın zaman aralığını, karşılaştırmasını, güvenini ve kanıtını gör."],
  ["İnsan onayı", "İlk sürüm reklam hesabına yazmaz; karar ve sorumluluk kullanıcıda kalır."],
] as const;

export default function Home() {
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">REKLAM KARAR DESTEĞİ</span>
        <h1>Ne değiştiğini değil, neden değiştiğini görün.</h1>
        <p className="lede">
          ReklamZeka ücretli medya verisini birleştirir, sapmaları kanıtıyla açıklar ve
          güvenli sonraki adımı önerir. Hesabınızda siz onaylamadan hiçbir şeyi değiştirmez.
        </p>
        <div className="status" role="status">
          <span className="pulse" aria-hidden="true" />
          Ürün temeli hazır · Teknik altyapı kuruluyor
        </div>
      </section>

      <section className="principles" aria-label="Ürün ilkeleri">
        {principles.map(([title, description]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
