import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Trashketball — Quota Mode";
const description =
  "A physics-based 3D paper-ball game. Hit quota in the severed office, then throw from a luxury beach house.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = `${protocol}://${host}`;
  const imageUrl = `${origin}/og.jpg`;

  return {
    title,
    description,
    applicationName: "Trashketball",
    keywords: ["trashketball", "Three.js", "3D game", "paper toss"],
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      siteName: "Trashketball",
      images: [
        {
          url: imageUrl,
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
      images: [imageUrl],
    },
  };
}

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
      <body>{children}</body>
    </html>
  );
}
