import { NextRequest, NextResponse } from 'next/server'
import { verifyScope } from './session'

// Guard for menu Add/Edit/Delete routes (Module 9). The client attaches the
// short-lived token it got back from POST /api/auth/verify-menu-credentials
// after the popup — there is no session/role, just this per-action check.
export async function requireMenuCrudToken(req: NextRequest): Promise<NextResponse | null> {
  const token = req.headers.get('x-menu-crud-token')
  const ok = await verifyScope(token, 'menu_crud')
  if (!ok) {
    return NextResponse.json({ error: 'Menu CRUD credentials required' }, { status: 401 })
  }
  return null
}
