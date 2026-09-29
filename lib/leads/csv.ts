import { CHANGE_SPECS, sortChanges } from '@/lib/leads/changes'
import { FINDING_SPECS, sortCodes } from '@/lib/enrichment/vocabulary'
import { formatPlaceType } from '@/lib/places-types'
import type { LeadRow } from '@/lib/leads/types'

/*
 * The book, as a file he can open in Excel.
 *
 * Everything the operator can see in the library, in the order he reads it, for
 * exactly the rows the filters selected. Not a database dump: this is the same
 * view he was looking at, which is why it takes a filter set rather than a
 * table name — a CSV that quietly exported something other than what was on
 * screen would be worse than no CSV at all.
 *
 * TWO DIALECTS, and the reason is Excel.
 *
 * German Excel splits on the list separator from the Windows locale, which is a
 * semicolon, and reads a comma-separated file as one column per row. It also
 * assumes the ANSI code page unless the file opens with a UTF-8 byte-order
 * mark, which turns every ä in a German business name into two characters of
 * mojibake. So the default here is semicolons with a BOM, because the file
 * exists to be opened by one person on a German desktop.
 *
 * The comma dialect is offered beside it, without a BOM, for everything else —
 * a spreadsheet on the web, a script, anything that reads RFC 4180 and is
 * confused by a semicolon.
 *
 * Nothing here is `server-only`: the encoding is pure, the route streams it, and
 * the console builds the link. There is no third copy of the column list.
 */

export type CsvDialect = 'excel' | 'rfc'

export interface DialectSpec {
  /** What goes between fields. */
  delimiter: string
  /** Emitted once, before the header row. Empty for the dialects that do not want it. */
  preamble: string
  label: string
}

export const CSV_DIALECTS: Record<CsvDialect, DialectSpec> = {
  excel: {
    delimiter: ';',
    // U+FEFF. Excel reads a file without it as ANSI and mangles every umlaut.
    preamble: '﻿',
    label: 'CSV for Excel',
  },
  rfc: {
    delimiter: ',',
    preamble: '',
    label: 'CSV, comma-separated',
  },
}

export function isCsvDialect(value: string | null | undefined): value is CsvDialect {
  return value === 'excel' || value === 'rfc'
}

/**
 * One field, quoted the way RFC 4180 says.
 *
 * Quoting is decided per field rather than applied to everything: a file where
 * every cell is quoted is harder to read in a terminal and no more correct.
 *
 * The leading-punctuation guard is not decoration. A cell beginning `=`, `+`,
 * `-` or `@` is executed as a formula by Excel and Sheets the moment the file is
 * opened, which is how a spreadsheet becomes an attack surface — and business
 * names, addresses and the operator's own notes all reach this function
 * unfiltered. Prefixing a tab keeps the text visible and stops it being parsed.
 */
export function csvField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return ''

  let text = String(value)
  // Newlines inside a quoted field are legal, but a lone CR confuses parsers
  // that split on CRLF; normalise before deciding whether to quote.
  text = text.replace(/\r\n?/g, '\n')

  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`

  const mustQuote =
    text.includes(delimiter) || text.includes('"') || text.includes('\n') || text !== text.trim()

  if (!mustQuote) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function csvRow(cells: readonly unknown[], delimiter: string): string {
  return cells.map((cell) => csvField(cell, delimiter)).join(delimiter)
}

/* ------------------------------------------------------------------------- *
 * The columns
 * ------------------------------------------------------------------------- */

/**
 * What a row says, in the order the library says it.
 *
 * Cold recall is the rule here as everywhere — PRODUCT.md's fourth principle —
 * so the export carries the things a lead cannot be understood without: the
 * faults in words rather than codes, the age of the Google half, what has
 * changed since it was saved, and the place ID that makes the row re-findable.
 *
 * Deliberately absent: the audit's raw measurements and the score's arithmetic.
 * Both live on the lead's own page, both are long, and a spreadsheet with
 * ninety columns is one nobody scrolls.
 */
interface Column {
  header: string
  value: (lead: LeadRow) => unknown
}

/** German decimal comma, because the file is opened in a German spreadsheet. */
function decimal(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

/** `2026-07-31T09:14:00Z` reduced to `31.07.2026`. Dates only; no zone to argue about. */
function day(value: string | null): string {
  if (!value) return ''
  const [date] = value.split('T')
  const [year, month, rest] = date.split('-')
  return rest ? `${rest}.${month}.${year}` : date
}

export const CSV_COLUMNS: Column[] = [
  { header: 'Name', value: (lead) => lead.name },
  { header: 'Score', value: (lead) => lead.score ?? '' },
  { header: 'Status', value: (lead) => lead.status },
  { header: 'Website', value: (lead) => lead.website ?? '' },
  {
    header: 'Faults',
    value: (lead) =>
      sortCodes(lead.auditFlags)
        .map((code) => FINDING_SPECS[code].label)
        .join(' · '),
  },
  {
    header: 'Changed',
    value: (lead) =>
      sortChanges(lead.changeFlags)
        .map((code) => CHANGE_SPECS[code].mark)
        .join(' · '),
  },
  { header: 'Changed on', value: (lead) => day(lead.changedAt) },
  { header: 'Phone', value: (lead) => lead.phone ?? '' },
  // Not a measurement, despite arriving with the audit — it is a way to reach
  // the business, and reaching them in writing is most of what this file is
  // opened for. Google supplies a number and practically never an address.
  { header: 'Imprint email', value: (lead) => lead.imprintEmail ?? '' },
  { header: 'Imprint phone', value: (lead) => lead.imprintPhone ?? '' },
  { header: 'Address', value: (lead) => lead.formattedAddress ?? '' },
  { header: 'City', value: (lead) => lead.city ?? '' },
  {
    header: 'Category',
    value: (lead) => (lead.primaryType ? formatPlaceType(lead.primaryType) : ''),
  },
  { header: 'Rating', value: (lead) => decimal(lead.rating) },
  { header: 'Reviews', value: (lead) => lead.userRatingCount ?? '' },
  { header: 'Follow-up', value: (lead) => day(lead.followUpAt) },
  { header: 'Lists', value: (lead) => lead.lists.map((list) => list.name).join(' · ') },
  { header: 'Notes', value: (lead) => lead.noteCount },
  { header: 'Saved', value: (lead) => day(lead.savedAt) },
  { header: 'Audited', value: (lead) => day(lead.lastAuditedAt) },
  {
    header: 'Site answered',
    value: (lead) => (lead.websiteStatus ? lead.websiteStatus.replace('_', ' ') : ''),
  },
  { header: 'PageSpeed', value: (lead) => lead.psiPerformance ?? '' },
  { header: 'Platform', value: (lead) => lead.platform ?? '' },
  // Principle 5, carried into the file: a column of Google data that cannot say
  // how old it is has no business leaving the product.
  { header: 'Google data from', value: (lead) => day(lead.fetchedAt) },
  { header: 'Google Maps', value: (lead) => lead.mapsUri ?? '' },
  { header: 'Place ID', value: (lead) => lead.googlePlaceId },
]

export function csvHeader(dialect: DialectSpec): string {
  return dialect.preamble + csvRow(CSV_COLUMNS.map((column) => column.header), dialect.delimiter)
}

export function csvLine(lead: LeadRow, dialect: DialectSpec): string {
  return csvRow(CSV_COLUMNS.map((column) => column.value(lead)), dialect.delimiter)
}

/**
 * `lead-engine-book-2026-07-31.csv`.
 *
 * The `what` says which question produced the file, because the operator will
 * have several of these in his downloads folder by the end of a month and "the
 * one I exported on Tuesday" is not a way to find one.
 */
export function csvFilename(what: string, dayString: string): string {
  const slug = what
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `lead-engine-${slug || 'leads'}-${dayString}.csv`
}
