'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { IconBook, IconSearch, IconSignal } from '@/components/icons'

export const SURFACES = [
  { href: '/search', label: 'Search', key: '1', Icon: IconSearch },
  { href: '/leads', label: 'Leads', key: '2', Icon: IconBook },
  { href: '/outreach', label: 'Outreach', key: '3', Icon: IconSignal },
] as const

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Nav() {
  const pathname = usePathname()
  const router = useRouter()

  // Keyboard-first, as the form demands. Alt+n moves between surfaces without
  // stealing plain digits, which the search and filter fields will want.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      const surface = SURFACES.find((s) => s.key === event.key)
      if (!surface) return
      event.preventDefault()
      router.push(surface.href)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router])

  return (
    <nav aria-label="Surfaces" className="flex items-stretch">
      {SURFACES.map(({ href, label, key, Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
              'group relative flex items-center gap-1.5 px-2 py-2 transition-colors duration-150',
              'md:gap-2 md:px-3',
              active ? 'text-ink' : 'text-ink-faint hover:text-ink-dim',
            ].join(' ')}
          >
            <Icon className="size-3.5 shrink-0" />
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
