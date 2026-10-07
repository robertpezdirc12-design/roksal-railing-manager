// API /api/gallery — galerija zaključenih del (gallery.read)
// FOTO meritve na projektih s statusom ZAKLJUCEN ali ARHIV; ?projectId= filter.
// params je JSON { photo: dataURL } (isti format kot foto modul) → razširjen v photo.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'

interface GalleryItem {
  id: string
  location: string | null
  note: string | null
  createdAt: Date
  photo: string | null
  project: { id: string; code: string; title: string; status: string } | null
  author: { name: string } | null
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'gallery.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')

  const photos = await db.measurement.findMany({
    where: {
      type: 'FOTO',
      project: { status: { in: ['ZAKLJUCEN', 'ARHIV'] } },
      ...(projectId ? { projectId } : {}),
    },
    include: {
      project: { select: { id: true, code: true, title: true, status: true } },
      author: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const data: GalleryItem[] = photos.map((m) => {
    let photo: string | null = null
    if (m.params) {
      try {
        const parsed = JSON.parse(m.params) as { photo?: unknown }
        if (typeof parsed.photo === 'string' && parsed.photo) photo = parsed.photo
      } catch {
        photo = null
      }
    }
    return {
      id: m.id,
      location: m.location,
      note: m.note,
      createdAt: m.createdAt,
      photo,
      project: m.project,
      author: m.author,
    }
  })

  return NextResponse.json({ data })
}
