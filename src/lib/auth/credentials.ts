import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/server'
import type { AuthScope } from '@/lib/types'

// Exactly one row per scope (`dashboard`, `menu_crud`) — no user table, no roles.
export async function verifyCredentials(scope: AuthScope, userId: string, password: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auth_credentials')
    .select('user_id, password_hash')
    .eq('scope', scope)
    .maybeSingle()

  if (error || !data) return false
  if (data.user_id !== userId) return false
  return bcrypt.compare(password, data.password_hash)
}
