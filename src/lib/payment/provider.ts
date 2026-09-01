// Single place where the live PaymentProvider is chosen.
//
// Safety rule (P0): a production deployment must NEVER silently fall back to
// MockPaymentProvider - a missing env var would otherwise mark every order PAID
// without any money being collected. Selection is therefore explicit:
//
//   PAYMENT_PROVIDER=pinelabs  → real provider, requires all credentials
//   PAYMENT_PROVIDER=mock      → mock, refused when NODE_ENV=production
//   (unset)                    → pinelabs if fully configured, else mock in
//                                development only; throws in production.

import { MockPaymentProvider } from './MockPaymentProvider'
import { PineLabsCloudProvider } from './PineLabsCloudProvider'
import { logger } from '@/lib/logger'
import type { PaymentProvider } from './types'

const REQUIRED_PINELABS_VARS = [
  'PINELABS_MERCHANT_ID',
  'PINELABS_SECURITY_TOKEN',
  'PINELABS_STORE_ID',
  'PINELABS_BASE_URL',
] as const

export function missingPineLabsVars(): string[] {
  return REQUIRED_PINELABS_VARS.filter((name) => !process.env[name]?.trim())
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function createPaymentProvider(): PaymentProvider {
  const requested = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase()
  const missing = missingPineLabsVars()

  if (requested === 'mock') {
    if (isProduction()) {
      throw new Error(
        'PAYMENT_PROVIDER=mock is not allowed in production - set PAYMENT_PROVIDER=pinelabs and configure Pine Labs credentials.'
      )
    }
    logger.warn('payment.provider.mock', { reason: 'explicitly requested' })
    return new MockPaymentProvider()
  }

  if (requested === 'pinelabs' || missing.length === 0) {
    if (missing.length > 0) {
      throw new Error(`Pine Labs payment provider is missing required env vars: ${missing.join(', ')}`)
    }
    logger.info('payment.provider.pinelabs', { baseUrl: process.env.PINELABS_BASE_URL })
    return new PineLabsCloudProvider()
  }

  if (isProduction()) {
    throw new Error(
      `No payment provider configured. Set PAYMENT_PROVIDER=pinelabs and provide: ${missing.join(', ')}. ` +
        'Refusing to start with the mock provider in production.'
    )
  }

  logger.warn('payment.provider.mock', { reason: 'pine labs not configured (development)', missing })
  return new MockPaymentProvider()
}

// Lazily built and memoised: `next build` runs module top-level code with
// NODE_ENV=production, so eager construction would fail the build on any
// machine without live credentials. Failing on first use keeps the safety
// guarantee where it matters - no request can be served by a mock in prod.
let cached: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (!cached) cached = createPaymentProvider()
  return cached
}

// Thin facade so call sites read naturally while staying lazy.
export const paymentProvider: PaymentProvider = {
  charge: (input) => getPaymentProvider().charge(input),
  status: (ptrid, ctx) => getPaymentProvider().status(ptrid, ctx),
  cancel: (ptrid, amountPaisa, ctx) => getPaymentProvider().cancel(ptrid, amountPaisa, ctx),
}
