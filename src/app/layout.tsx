import type { Metadata, Viewport } from "next";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Illini Course Planner",
  description: "Build a conflict-free UIUC schedule with seat status, restrictions, GPA by instructor and professor comparisons in one place.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
