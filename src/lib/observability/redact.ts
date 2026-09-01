// Redaction for payment payloads.
//
// Pine Labs responses carry a masked PAN, acquirer, card type and customer VPA.
// None of that is needed to run the cafe, and storing or logging it widens the
// PCI/PII surface for no benefit. We keep what reconciliation actually needs
// (PTRID, RRN, ApprovalCode, TransactionLogId, amount, mode) and reduce card
// data to its last four digits.

const SENSITIVE_KEYS = new Set(
  [
    'cardnumber', 'card_no', 'cardno', 'pan',
    'customervpa', 'vpa', 'payervpa',
    'cardholdername', 'customername', 'customerphone', 'mobilenumber', 'email',
    'securitytoken', 'token', 'password',
  ].map((k) => k.toLowerCase())
)

// Card-like values keep their last four digits (useful for matching a slip);
// everything else sensitive is dropped entirely.
const CARD_KEYS = new Set(['cardnumber', 'card_no', 'cardno', 'pan'])

function maskValue(key: string, value: unknown): string {
  const isCard = CARD_KEYS.has(key.trim().toLowerCase())
  if (isCard && typeof value === 'string') return lastFour(value)
  return '[redacted]'
}

function lastFour(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****'
}

/**
 * Deep-copies a payment payload with sensitive values removed or reduced.
 * Card numbers become ****1234; tokens and contact details are dropped.
 */
export function redactPaymentPayload(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null

  if (Array.isArray(value)) {
    // Pine Labs TransactionData is [{ Tag, Value }] - redact by Tag.
    return value.map((entry) => {
      if (
        entry && typeof entry === 'object' &&
        'Tag' in (entry as Record<string, unknown>) &&
        'Value' in (entry as Record<string, unknown>)
      ) {
        const tag = String((entry as Record<string, unknown>).Tag)
        const raw = (entry as Record<string, unknown>).Value
        if (SENSITIVE_KEYS.has(tag.trim().toLowerCase())) {
          return { Tag: tag, Value: maskValue(tag, raw) }
        }
        return { Tag: tag, Value: raw }
      }
      return redactPaymentPayload(entry, depth + 1)
    })
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = maskValue(key, val)
        continue
      }
      out[key] = redactPaymentPayload(val, depth + 1)
    }
    return out
  }

  return value
}

/** JSON-safe, redacted copy suitable for both `payments.raw_response` and logs. */
export function toStorableJson(value: unknown): unknown {
  return redactPaymentPayload(JSON.parse(JSON.stringify(value ?? null)))
}
