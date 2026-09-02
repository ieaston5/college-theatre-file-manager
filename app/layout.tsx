import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Penn Players Hub",
  description: "One place to find and file every Penn Players document.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-ink-50 text-ink-900">{children}</body>
    </html>
  );
}
