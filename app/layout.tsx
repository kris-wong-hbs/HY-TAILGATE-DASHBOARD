import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harvard-Yale Tailgate — Sales",
  description: "Live ticket sales by school",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
