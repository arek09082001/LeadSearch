import type { Metadata } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'

import './globals.css'

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lead Engine',
  description: 'Local businesses with weak web presence, triaged and kept.',
}

/*
 * The direction contract. Emitted as a real HTML comment so it survives the
 * production build and can be audited against the render.
 */
const DIRECTION_CONTRACT = `<!--
THESIS: A dealing screen for local prospects. Refuses the SaaS admin shell - icon sidebar, rounded cards, stat row. The live feed and the saved book are different materials, not two tabs.
OWN-WORLD: Near-black ground, hairline rules instead of boxes, nothing rounded. Archivo caps for labels, JetBrains Mono tabular for every figure. Amber is the only accent; green means live, red means cold.
STORY: The operator lands mid-session, sees at a glance what is live and what is his, and moves by keyboard.
FIRST VIEWPORT: Masthead rule - wordmark left, SEARCH/LEADS/OUTREACH centre, session identity right. A status strip beneath carries provenance and age. Content fills the rest, edge to edge.
FORM: Market data terminal; candidate 5 of 7 on the grounded list; seed key 58af9e90.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrainsMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  )
}
