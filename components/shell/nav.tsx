'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { IconBook, IconMap, IconSearch, IconSignal } from '@/components/icons'

export const SURFACES = [
  { href: '/search', label: 'Search', key: '1', Icon: IconSearch },
  { href: '/leads', label: 'Leads', key: '2', Icon: IconBook },
  { href: '/map', label: 'Map', key: '3', Icon: IconMap },
  { href: '/outreach', label: 'Outreach', key: '4', Icon: IconSignal },
] as const

/**
 * The two surfaces that draw the same book.
 *
 * Moving between them carries the query string, and that is the whole of how the
 * map shares the library's state: filters live in the URL, both routes parse
 * them with `parseFilters`, so "narrow it in the table, then look at it on the
 * map" is one click and not a second filtering. Coming from anywhere else —
 * Search, Outreach — the link is bare, because a query string from a surface
 * that does not use these filters would be noise carried into one that does.
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
    <nav aria-label="Surfaces" className="flex items-stretch">
      {SURFACES.map(({ href, label, key, Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={hrefFor(href)}
            aria-current={active ? 'page' : undefined}
            className={[
              'group relative flex items-center gap-1.5 px-2 py-2 transition-colors duration-150',
              'md:gap-2 md:px-3',
              active ? 'text-ink' : 'text-ink-faint hover:text-ink-dim',
            ].join(' ')}
          >
            <Icon className="size-3.5 shrink-0" />
            {/*
              Four surfaces now rather than three, and a phone is 360px wide.
              The label on the inactive ones is the first thing that can go: the
              icon still says which is which, and the active surface keeps its
              word because that is the one the operator is checking.
            */}
            <span className={`label ${active ? '' : 'hidden sm:inline'}`}>{label}</span>
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
