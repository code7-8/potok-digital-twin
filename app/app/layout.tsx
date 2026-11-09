import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ПОТОК — цифровой двойник отгрузки",
  description: "Исследование производственной логистики: воспроизводимая модель, сценарии и интерактивный 3D-тур. Учебный кейс Газпром нефти.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
