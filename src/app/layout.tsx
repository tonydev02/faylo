import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Faylo — private finance workspace",
  description: "A private personal-finance workspace protected by Google sign-in.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
