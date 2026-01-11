import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apple Health Dashboard",
  description: "Parse & visualize Apple Health exports",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="isolate">{children}</body>
    </html>
  );
}