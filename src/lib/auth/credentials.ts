import bcrypt from 'bcryptjs'
import { getDb } from '@/lib/db'
import type { UserRole } from '@/lib/types'

export async function verifyCredentials(
  userId: string,
  password: string
): Promise<{ role: UserRole; displayName: string } | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT password_hash, role, display_name
    FROM auth_credentials
    WHERE user_id = ${userId}
  `
  const row = rows[0]
  if (!row) return null
  const match = await bcrypt.compare(password, row.password_hash as string)
  if (!match) return null
  return { role: row.role as UserRole, displayName: row.display_name as string }
}
