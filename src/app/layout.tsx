import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "ReklamZeka",
  description: "Kanıtı görünen, insan onaylı reklam karar desteği.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
