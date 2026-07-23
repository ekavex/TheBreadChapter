import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials } from '@/lib/auth/credentials'
import { createMenuCrudActionToken } from '@/lib/auth/session'

// Called by the Add/Edit/Delete Menu popup (Module 9). Re-verified every
// time — this is not a session, just a ~2min action token for the mutating
// request that follows.
export async function POST(req: NextRequest) {
  const { userId, password } = await req.json()
  if (!userId || !password) {
    return NextResponse.json({ error: 'userId and password required' }, { status: 400 })
  }

  const ok = await verifyCredentials('menu_crud', userId, password)
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await createMenuCrudActionToken()
  return NextResponse.json({ data: { token }, error: null })
}
