import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPaymentProvider, missingPineLabsVars } from '@/lib/payment/provider'
import { MockPaymentProvider } from '@/lib/payment/MockPaymentProvider'
import { PineLabsCloudProvider } from '@/lib/payment/PineLabsCloudProvider'

const PINELABS_KEYS = [
  'PINELABS_MERCHANT_ID',
  'PINELABS_SECURITY_TOKEN',
  'PINELABS_STORE_ID',
  'PINELABS_BASE_URL',
  'PAYMENT_PROVIDER',
  'NODE_ENV',
] as const

let saved: Record<string, string | undefined> = {}

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k]
    else (process.env as Record<string, string | undefined>)[k] = v
  }
}

function fullCredentials() {
  return {
    PINELABS_MERCHANT_ID: '123456',
    PINELABS_SECURITY_TOKEN: 'token-abc',
    PINELABS_STORE_ID: '9988',
    PINELABS_BASE_URL: 'https://www.plutuscloudserviceuat.in:8201',
  }
}

beforeEach(() => {
  saved = {}
  for (const key of PINELABS_KEYS) saved[key] = process.env[key]
  setEnv(Object.fromEntries(PINELABS_KEYS.map((k) => [k, undefined])))
})

afterEach(() => setEnv(saved))

describe('payment provider selection (P0: mock must never serve production)', () => {
  it('refuses to start in production when Pine Labs is not configured', () => {
    setEnv({ NODE_ENV: 'production' })
    expect(() => createPaymentProvider()).toThrowError(/No payment provider configured/)
  })

  it('refuses an explicit mock in production', () => {
    setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', ...fullCredentials() })
    expect(() => createPaymentProvider()).toThrowError(/not allowed in production/)
  })

  it('refuses pinelabs with partial credentials, naming what is missing', () => {
    setEnv({ PAYMENT_PROVIDER: 'pinelabs', PINELABS_MERCHANT_ID: '123456' })
    expect(() => createPaymentProvider()).toThrowError(/PINELABS_SECURITY_TOKEN/)
  })

  it('uses Pine Labs when fully configured', () => {
    setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'pinelabs', ...fullCredentials() })
    expect(createPaymentProvider()).toBeInstanceOf(PineLabsCloudProvider)
  })

  it('falls back to the mock only outside production', () => {
    setEnv({ NODE_ENV: 'development' })
    expect(createPaymentProvider()).toBeInstanceOf(MockPaymentProvider)
  })

  it('reports exactly which variables are missing', () => {
    setEnv({ PINELABS_MERCHANT_ID: '1' })
    expect(missingPineLabsVars()).toEqual([
      'PINELABS_SECURITY_TOKEN',
      'PINELABS_STORE_ID',
      'PINELABS_BASE_URL',
    ])
  })
})

describe('Pine Labs configuration validation', () => {
  it('rejects a non-numeric MerchantID instead of sending MerchantID 0', () => {
    setEnv({ ...fullCredentials(), PINELABS_MERCHANT_ID: 'not-a-number' })
    expect(() => new PineLabsCloudProvider()).toThrowError(/must be numeric/)
  })

  it('rejects a plaintext base URL', () => {
    setEnv({ ...fullCredentials(), PINELABS_BASE_URL: 'http://insecure.example' })
    expect(() => new PineLabsCloudProvider()).toThrowError(/must be https/)
  })
})
