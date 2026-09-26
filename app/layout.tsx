import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A股成交观察",
  description: "沪深A股单日成交额与20个交易日滚动累计。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
