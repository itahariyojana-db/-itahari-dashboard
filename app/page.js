// Root route — the middleware handles the redirect logic, but this
// server component adds a hard redirect as a fallback.
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
