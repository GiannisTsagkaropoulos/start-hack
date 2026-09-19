import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ScrollToTop from "@components/ScrollToTop";
import AmbientField from "@/components/world/AmbientField";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wallet Authority",
  description:
    "Grant your shopping agent a spending authority in plain language, then watch every purchase get checked against it in real time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-void text-ink-0">
        {/* Mounted once, here, so it never remounts across route changes -
            the world persists; only the pages layered on top change. */}
        <AmbientField />
        {children}
        <ScrollToTop />
      </body>
    </html>
  );
}
