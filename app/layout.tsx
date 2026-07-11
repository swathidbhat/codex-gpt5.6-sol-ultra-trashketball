import type { Metadata, Viewport } from "next";
import gameStyles from "./globals.css?raw";

const siteUrl = "https://trashketball-quota-mode.swthbht.chatgpt.site";
const title = "Trashketball — Quota Mode";
const description =
  "A physics-based 3D paper-ball game. Hit quota in the severed office, then throw from a luxury beach house.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "Trashketball",
  keywords: ["trashketball", "Three.js", "3D game", "paper toss"],
  openGraph: {
    title,
    description,
    type: "website",
    url: siteUrl,
    siteName: "Trashketball",
    images: [
      {
        url: `${siteUrl}/og.jpg`,
        width: 1200,
        height: 630,
        alt: "Trashketball's office and beach house levels connected by a glowing paper-ball trajectory",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${siteUrl}/og.jpg`],
  },
};

export const viewport: Viewport = {
  themeColor: "#082e2b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: gameStyles }} />
      </head>
      <body>
        {children}
        <noscript>
          <div className="no-script-message">
            Trashketball needs JavaScript and WebGL enabled to run.
          </div>
        </noscript>
      </body>
    </html>
  );
}
