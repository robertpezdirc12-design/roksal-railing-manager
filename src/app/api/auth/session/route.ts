import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/auth'

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton.')
  return NextResponse.json({ user })
}
