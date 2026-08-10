import postgres from 'postgres'

declare global {
  // eslint-disable-next-line no-var
  var __db: postgres.Sql | undefined
}

export function getDb(): postgres.Sql {
  if (!global.__db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    global.__db = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      types: {
        // Return NUMERIC as JS number instead of string
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (n: number) => String(n),
          parse: (x: string) => parseFloat(x),
        },
        // Return TIMESTAMPTZ as ISO string (matches Supabase behaviour)
        timestamptz: {
          to: 1184,
          from: [1184],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
          parse: (x: string) => x,
        },
        // Return TIMESTAMP without tz as ISO string
        timestamp: {
          to: 1114,
          from: [1114],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
          parse: (x: string) => x,
        },
        // Return DATE as YYYY-MM-DD string (matches Supabase behaviour)
        date: {
          to: 1082,
          from: [1082],
          serialize: (x: Date | string) => (x instanceof Date ? x.toISOString().slice(0, 10) : x),
          parse: (x: string) => x,
        },
      },
    })
  }
  return global.__db
}
