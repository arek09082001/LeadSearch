import Image from 'next/image'

/*
 * The mark plus the name. Three surfaces render it — the masthead rule, the
 * login header, the 404 header — and they were three copies of the same span
 * before the logo arrived, so it lives in one place now.
 *
 * The mark is the one rounded thing in this world, and it stays that way: it is
 * a supplied asset, not drawn chrome, and squaring it off would be redrawing
 * someone's logo. Sized to the cap height of the wordmark so the rule reads as
 * a line of type with a glyph on it, not a header with a picture in it.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${className ?? ''}`}>
      {/*
        Decorative: the word beside it already says what this is, so a second
        announcement of "Lead Engine" is noise in a screen reader.

        The source is 1254px square; width/height here are the rendered box, and
        next/image serves a variant sized for it rather than the original.
      */}
      <Image
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={16}
        height={16}
        priority
        className="size-4 shrink-0"
      />
      <span className="label text-ink">Lead Engine</span>
    </span>
  )
}
