'use client'

import { IconDownload } from '@/components/icons'
import { Menu, MenuItem, MenuLabel } from '@/components/ui/controls'
import { CSV_DIALECTS } from '@/lib/leads/csv'

/*
 * Take this view away as a file.
 *
 * Plain anchors, not a fetch. The browser's own download machinery handles a
 * `Content-Disposition` response better than any amount of blob-and-object-URL
 * code: it streams, it survives a tab switch, it shows progress, and there is
 * nothing to clean up afterwards. The route is a GET taking the same query
 * string this page was drawn from, so the file cannot contain anything other
 * than what is on screen.
 *
 * Two dialects, offered rather than guessed, because the answer depends on where
 * the file is going. German Excel wants semicolons and a byte-order mark and
 * renders anything else as one mangled column; everything that reads RFC 4180
 * wants commas and is confused by a semicolon. Excel is first because that is
 * where this file is going nine times in ten.
 */

export function ExportCsv({
  /** The library's query string, or `queue=due` / `queue=cold` for the book's two queues. */
  query,
  /** How many rows the file will hold. Stated, because an export of nothing is a surprise. */
  count,
}: {
  query: string
  count: number
}) {
  const href = (sep: string) => `/api/leads/export?${[query, `sep=${sep}`].filter(Boolean).join('&')}`

  return (
    <Menu
      label={
        <span className="flex items-center gap-1.5">
          <IconDownload className="size-3.5" />
          CSV
        </span>
      }
      align="right"
      variant="quiet"
      width="w-64"
      disabled={count === 0}
    >
      {(close) => (
        <>
          <MenuLabel>
            {count.toLocaleString('de-DE')} {count === 1 ? 'row' : 'rows'}, exactly this view
          </MenuLabel>
          {(Object.keys(CSV_DIALECTS) as (keyof typeof CSV_DIALECTS)[]).map((key) => (
            <MenuItem key={key} onClick={close}>
              {/*
                The anchor is inside the item rather than around it so the menu
                closes on the same click that starts the download — and so the
                row keeps the one hover treatment every other menu row has.
              */}
              <a href={href(key)} download className="block w-full">
                {CSV_DIALECTS[key].label}
              </a>
            </MenuItem>
          ))}
          <p className="border-t border-rule px-2.5 py-1.5 text-sm text-ink-faint">
            Semicolons and a byte-order mark for Excel on a German machine; commas for
            everything else.
          </p>
        </>
      )}
    </Menu>
  )
}
