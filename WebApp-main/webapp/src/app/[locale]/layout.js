import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/navbar";
import { NextIntlClientProvider } from "next-intl";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { Toaster } from "@/components/ui/sonner";
import AuthProvider from "@/components/auth-provider";

const geistSans = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const geistMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export async function generateMetadata() {
  return {
    title: "Portable Isolated Environment",
    icons: {
      icon: "/pie_icon.png",
    },
    other: {
      // Add hreflang links for SEO
      alternates: {
        languages: {
          en: `/${routing.locales[0]}`,
          pt: `/${routing.locales[1]}`,
        },
      },
    },
  };
}

export default async function RootLayout({ children, params }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }
  let messages;
  try {
    messages = (await import(`@/locales/${locale}/common.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale ${locale}:`, error);
    messages = {};
  }
  return (
    <html lang={locale} suppressHydrationWarning> 
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider locale={locale}>
            <Navbar />
            <main className="container mx-auto px-4">{children}</main>
          </AuthProvider>
        </NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}