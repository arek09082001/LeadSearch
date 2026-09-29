'use client'

import { useEffect } from 'react'

import { CommandButton } from '@/components/ui/command-button'
import { ErrorState } from '@/components/ui/states'

export default function SurfaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <ErrorState
      headline="Surface failed to load"
      body="Nothing was saved or lost — this surface only reads. Retry, and if it fails again the message below is the place to start."
      detail={error.digest ? `${error.message} · digest ${error.digest}` : error.message}
      action={
        <CommandButton variant="primary" onClick={reset}>
          Retry
        </CommandButton>
      }
    />
  )
}
