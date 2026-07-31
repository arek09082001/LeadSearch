import { IconExit } from '@/components/icons'
import { Nav } from '@/components/shell/nav'
import { signOutAction } from '@/app/auth/actions'

/*
 * The masthead is a rule with things on it. No bar, no shadow, no card.
 * Wordmark left, surfaces centre, session identity right — the arrangement a
 * dealing screen has always used, because the operator's eye starts centre.
 */
export function Masthead({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-ground/95 backdrop-blur-[2px]">
      <div className="flex items-stretch justify-between gap-2 px-2 md:gap-4 md:px-3">
        {/* On a phone the wordmark is the least useful thing on the rule: the
            operator knows what he opened, and the nav says where he is. */}
        <div className="hidden items-center gap-2 py-2 pr-2 md:flex">
          <span className="label text-ink">Lead Engine</span>
          <span aria-hidden="true" className="h-3 w-px bg-rule-strong" />
        </div>

        <Nav />

        <div className="flex items-center gap-3 py-2 pl-2">
          {/* Identity is reassurance, not a control. First thing to go when the
              masthead is competing for width on a phone. */}
          <span className="hidden font-data text-micro text-ink-faint lg:inline" title={email}>
            {email}
          </span>
          <form action={signOutAction}>
            {/*
              The glyph stays 14px; the target does not. PRODUCT.md says he
              checks a lead from a phone between sessions, and a 22px hit area
              for the one control that ends the session is a mis-tap waiting to
              happen. Padding rather than a bigger icon, so the rule above looks
              exactly as it did.
            */}
            <button
              type="submit"
              className="-m-2 flex min-h-11 min-w-11 items-center justify-center p-2 text-ink-faint transition-colors duration-150 hover:text-alert md:min-h-0 md:min-w-0"
            >
              <IconExit className="size-3.5" />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
