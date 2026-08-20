import { Suspense } from 'react'
import Link from 'next/link'
import LoginForm from './LoginForm'

export const metadata = { title: 'Dashboard Login' }

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">The Bread Chapter</h1>
        <p className="text-ink-muted mt-1">Dashboard access</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-sm text-ink-muted">
        <Link href="/login/forgot-password" className="underline underline-offset-2">
          Forgot password?
        </Link>
      </p>
    </div>
  )
}
