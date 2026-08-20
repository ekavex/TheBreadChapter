import { Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import LoginForm from './LoginForm'

export const metadata = { title: 'Login' }

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <Image
          src="/tbc-log-bg.png"
          alt="The Bread Chapter"
          width={160}
          height={160}
          className="mx-auto mb-2"
          priority
        />
        <p className="text-ink-muted text-sm">Dashboard access</p>
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
