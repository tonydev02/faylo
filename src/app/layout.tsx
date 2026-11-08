import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Faylo — a clearer view of your money",
  description: "A responsive personal finance workspace preview. Accounts, transactions, authentication, and storage are not connected yet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
