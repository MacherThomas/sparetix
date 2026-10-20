import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Work_Sans } from "next/font/google";
import Header from "@/components/Header";
import "./globals.css";

// Google now ships "Big Shoulders Display" as the opsz axis of Big Shoulders.
const display = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  adjustFontFallback: false, // next/font has no fallback metrics for this family
});
const sans = Work_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "SpareTix — spare tickets for IE students",
  description:
    "SpareTix helps IE students buy and sell spare party and event tickets in one place, so they stop chasing deals in group chats.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Header />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
