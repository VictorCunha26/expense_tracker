import type { Metadata, Viewport } from "next"
import "./globals.css"
import "./mobile.css"

export const metadata: Metadata = {
  title: "Synch Cash",
  description: "Controle suas despesas, orçamentos, contas e metas em um só lugar.",
  applicationName: "Synch Cash",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Synch Cash" },
  other: { "codex-preview": "development" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050607",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  )
}
