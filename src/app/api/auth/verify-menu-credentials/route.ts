import { NextResponse } from 'next/server'

// Deprecated in M10 (RBAC) — menu CRUD gate removed.
// Returns success for any remaining clients that might still call this.
export async function POST() {
  return NextResponse.json({ data: { token: 'rbac' }, error: null })
}
