import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types'

export async function verifyCredentials(
  userId: string,
  password: string
): Promise<{ role: UserRole; displayName: string } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auth_credentials')
    .select('password_hash, role, display_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null
  const match = await bcrypt.compare(password, data.password_hash)
  if (!match) return null
  return { role: data.role as UserRole, displayName: data.display_name }
}
