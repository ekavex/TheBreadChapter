import { Suspense } from 'react'
import LoginForm from './LoginForm'

export const metadata = { title: 'Dashboard Login' }

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Smart Cafe</h1>
        <p className="text-ink-muted mt-1">Dashboard access</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
