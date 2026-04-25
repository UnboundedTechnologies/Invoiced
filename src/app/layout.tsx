import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Invoiced - Unbounded Technologies Inc.",
  description: "Single-user toolbox for incorporation management",
  robots: { index: false, follow: false }, // private app
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP nonce is set per request by src/middleware.ts. Next.js reads it
  // from the `x-nonce` request header automatically and injects it into
  // its own bootstrap scripts. `strict-dynamic` in the CSP trusts
  // anything those scripts chain-load (Analytics/SpeedInsights beacons,
  // hydration chunks) so we don't have to thread the nonce manually.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans`}
        suppressHydrationWarning
      >
        {children}
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
