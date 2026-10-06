import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET () {
  return NextResponse.json({ build: process.env.ROKSAL_BUILD ?? 'rekonstrukcija-R431' })
}
