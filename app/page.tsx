import { redirect } from 'next/navigation'

/** A session always starts on the feed. */
export default function Home() {
  redirect('/search')
}
