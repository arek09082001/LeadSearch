import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AppShell } from '@/components/shell/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts already turned away anyone unauthenticated; this keeps the layout
  // correct on its own if the matcher ever stops covering these routes.
  const session = await auth()
  if (!session?.user?.email) redirect('/login')

  return <AppShell email={session.user.email}>{children}</AppShell>
}
