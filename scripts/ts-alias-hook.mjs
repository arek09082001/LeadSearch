/*
 * A module resolve hook, so `lib/` can be imported from a bare node session.
 *
 * Two things stand between node and this project's TypeScript, and neither is
 * worth changing the project over:
 *
 *   1. `@/lib/...` is a tsconfig path alias. Node has never heard of it.
 *   2. TypeScript imports have no file extension. Node requires one.
 *
 * Node 22.6+ already strips the types itself, so this hook is the whole of what
 * is missing. It handles `@/` specifiers only — everything else, including every
 * package import, is handed straight back to node's own resolver, which is what
 * keeps a hook this small from quietly breaking a dependency's exports map.
 *
 * Used by scripts/assistant-demo.mjs. It is a development convenience and
 * nothing in the application imports it.
 */
import { existsSync, statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function firstFile(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export function resolve(specifier, context, next) {
  if (!specifier.startsWith('@/')) return next(specifier, context)

  const base = resolvePath(ROOT, specifier.slice(2))
  const file = firstFile([base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`])

  if (!file) {
    throw new Error(`Could not resolve "${specifier}" under ${ROOT}`)
  }

  return { url: pathToFileURL(file).href, shortCircuit: true }
}
