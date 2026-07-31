'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { IconBook, IconFork, IconMap, IconSearch, IconSignal } from '@/components/icons'

/*
 * Working order, left to right: find them, keep them, look at where they are,
 * call them — and then, last and least often, ask whether any of it was ranked
 * right. Map sits beside Leads because the two are one question drawn twice,
 * not two questions. Outcomes sits at the end because it is the one surface that
 * is not part of a session; it is read between sessions, after enough calls have
 * accumulated to mean something.
 */
export const SURFACES = [
  { href: '/search', label: 'Search', key: '1', Icon: IconSearch },
  { href: '/leads', label: 'Leads', key: '2', Icon: IconBook },
  { href: '/map', label: 'Map', key: '3', Icon: IconMap },
  { href: '/outreach', label: 'Outreach', key: '4', Icon: IconSignal },
  { href: '/outcomes', label: 'Outcomes', key: '5', Icon: IconFork },
] as const

/**
 * The two surfaces that draw the same book.
 *
 * Moving between them carries the query string, and that is the whole of how the
 * map shares the library's state: filters live in the URL, both routes parse
 * them with `parseFilters`, so "narrow it in the table, then look at it on the
 * map" is one click and not a second filtering. Coming from anywhere else —
 * Search, Outreach, Outcomes — the link is bare, because a query string from a
 * surface that does not use these filters would be noise carried into one that
 * does.
 */
const BOOK_SURFACES = new Set<string>(['/leads', '/map'])

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Nav() {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()

  const carried = BOOK_SURFACES.has(pathname) ? params.toString() : ''
  const hrefFor = (href: string) =>
    carried && BOOK_SURFACES.has(href) ? `${href}?${carried}` : href

  // Keyboard-first, as the form demands. Alt+n moves between surfaces without
  // stealing plain digits, which the search and filter fields will want.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      const surface = SURFACES.find((s) => s.key === event.key)
      if (!surface) return
      event.preventDefault()
      router.push(hrefFor(surface.href))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, carried])

  return (
    /*
      Five surfaces do not fit on one 360px rule, and the label is the thing
      DESIGN.md says never drops — so the rule wraps instead.
      "SEARCH LEADS MAP OUTREACH OUTCOMES" is 320px of type before padding, and
      with the sign-out control beside it that is 20px past a 360px phone. Every
      way of buying those 20px costs something worse: shaving the padding leaves
      MAP with a 32px-wide tap target, scrolling the rule hides surfaces behind a
      gesture nothing announces, and dropping the inactive labels means
      navigating by icon. A second line below ~400px costs one row of masthead on
      the width where this product is a reference rather than an instrument, and
      costs nothing at all above it.
    */
    <nav aria-label="Surfaces" className="flex flex-wrap items-stretch">
      {SURFACES.map(({ href, label, key, Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={hrefFor(href)}
            aria-current={active ? 'page' : undefined}
            className={[
              'group relative flex items-center gap-1.5 px-1.5 py-2 transition-colors duration-150',
              'md:gap-2 md:px-3',
              active ? 'text-ink' : 'text-ink-faint hover:text-ink-dim',
            ].join(' ')}
          >
            {/*
              The glyph is the last thing on this rule that can be spared, and at
              five surfaces it has to be. DESIGN.md fixes the order of what drops
              on a phone — the wordmark, then the key hints — and fixes what never
              does: the surface label. Labels plus icons run past 360px and push
              the sign-out control off the edge, so below `md` the icons go and
              every surface stays named and reachable.
            */}
            <Icon className="hidden size-3.5 shrink-0 md:block" />
            <span className="label">{label}</span>
            {/* The key hint is for the desk, where a keyboard exists. */}
            <span
              aria-hidden="true"
              className="hidden font-data text-micro text-ink-faint group-hover:text-ink-dim md:inline"
            >
              {key}
            </span>
            {/* Active surface is marked by a rule, not a pill. */}
            <span
              aria-hidden="true"
              className={[
                'absolute inset-x-0 -bottom-px h-px',
                active ? 'bg-signal' : 'bg-transparent',
              ].join(' ')}
            />
          </Link>
        )
      })}
    </nav>
  )
}
