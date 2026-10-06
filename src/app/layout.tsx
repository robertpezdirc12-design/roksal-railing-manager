import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roksal Railing Manager",
  description: "Upravljanje ograj — projekti, teren, proizvodnja, računi. Rekonstrukcija R431 (vir: Vercel deployment R430).",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='6' width='24' height='3.2' rx='1.6' fill='%23f59e0b'/%3E%3Crect x='4' y='14' width='24' height='3.2' rx='1.6' fill='%23f59e0b'/%3E%3Crect x='5.5' y='6' width='3.4' height='22' rx='1.7' fill='%231d2b3e'/%3E%3Crect x='14.3' y='6' width='3.4' height='22' rx='1.7' fill='%231d2b3e'/%3E%3Crect x='23.1' y='6' width='3.4' height='22' rx='1.7' fill='%231d2b3e'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sl" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
