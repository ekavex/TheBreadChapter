import { NextResponse } from 'next/server'

// Deprecated in M10 (RBAC) - menu CRUD gate removed.
// Kept as a no-op to avoid breaking any stale imports.
export async function requireMenuCrudToken(): Promise<NextResponse | null> {
  return null
}
