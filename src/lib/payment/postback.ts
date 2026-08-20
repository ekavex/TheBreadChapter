// Pine Labs Post Back payload parsing.
//
// The body is application/x-www-form-urlencoded, but the value is a single
// comma-joined "key=value" CSV string (PINELABS_INTEGRATION_MASTER.md §6).
// Kept out of the route file so it can be unit-tested — Next.js route modules
// may only export handlers and route config.

/** Splits the comma-joined key=value payload. Values may themselves contain '='. */
export function parsePostBack(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return result
}

/** Unwraps the form encoding Pine Labs wraps the CSV payload in. */
export function extractCsvPayload(rawBody: string): string {
  if (rawBody.includes('%3D') || rawBody.startsWith('data=') || rawBody.includes('&')) {
    const params = new URLSearchParams(rawBody)
    return params.get('data') ?? params.get('postback') ?? rawBody
  }
  return rawBody
}

export function parsePostBackBody(rawBody: string): Record<string, string> {
  return parsePostBack(decodeURIComponent(extractCsvPayload(rawBody)))
}
