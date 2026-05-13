import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Translate",
  description:
    "Real-time broadcast translation powered by the Gemini Live API.",
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
