import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Invoiced — Unbounded Technologies Inc.",
  description: "Single-user toolbox for incorporation management",
  robots: { index: false, follow: false }, // private app
  manifest: "/manifest.json",
  applicationName: "Invoiced",
  appleWebApp: {
    capable: true,
    title: "Invoiced",
    statusBarStyle: "black-translucent",
    startupImage: [
      // iOS picks the closest match from these via media-query hints. Order
      // is descending by physical resolution.
      { url: "/splash/apple-splash-2048-2732.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1668-2388.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1284-2778.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-1170-2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" },
      { url: "/splash/apple-splash-750-1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  // Icons resolved via Next.js App Router file conventions:
  // src/app/icon.png            → <link rel="icon">              (cache-busted)
  // src/app/apple-icon{,0,1,2}  → <link rel="apple-touch-icon">  (cache-busted, 180/167/152/120)
  // The cache-bust hash forces iOS "Add to Home Screen" to refetch the icon
  // instead of serving a stale copy from before the brand refresh.
};

export const viewport: Viewport = {
  themeColor: "#0a0a14",
  // viewportFit: "cover" lets us address env(safe-area-inset-*) so the dark
  // status bar overlays cleanly when the PWA is in standalone mode on iPhone.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
