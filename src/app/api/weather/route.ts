import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'

// /api/weather — napoved za terenska dela (route-map: GET /api/weather)
// Vir: Open-Meteo (brez API ključa). Vrata: nalog.read (teren uporabljajo monterji in vodje).
// Query: ?lat=…&lon=…&place=… (privzeto Ljubljana). Vrača danes + 3 dni z oceno primerenosti za montažo.

interface Wmo { label: string; icon: 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' }

const WMO: Record<number, Wmo> = {
  0: { label: 'Jasno', icon: 'sun' },
  1: { label: 'Pretežno jasno', icon: 'sun' },
  2: { label: 'Delno oblačno', icon: 'cloud' },
  3: { label: 'Oblačno', icon: 'cloud' },
  45: { label: 'Megla', icon: 'fog' },
  48: { label: 'Zmrzovalna megla', icon: 'fog' },
  51: { label: 'Šibka rosica', icon: 'rain' },
  53: { label: 'Rosica', icon: 'rain' },
  55: { label: 'Močna rosica', icon: 'rain' },
  61: { label: 'Šibek dež', icon: 'rain' },
  63: { label: 'Dež', icon: 'rain' },
  65: { label: 'Močan dež', icon: 'rain' },
  66: { label: 'Zmrzovalni dež', icon: 'rain' },
  67: { label: 'Močan zmrzovalni dež', icon: 'rain' },
  71: { label: 'Šibek sneg', icon: 'snow' },
  73: { label: 'Sneg', icon: 'snow' },
  75: { label: 'Močan sneg', icon: 'snow' },
  77: { label: 'Snežna zrna', icon: 'snow' },
  80: { label: 'Plošice', icon: 'rain' },
  81: { label: 'Plošice', icon: 'rain' },
  82: { label: 'Močne plošice', icon: 'rain' },
  85: { label: 'Snežne plošice', icon: 'snow' },
  86: { label: 'Močne snežne plošice', icon: 'snow' },
  95: { label: 'Nevihta', icon: 'storm' },
  96: { label: 'Nevihta s točo', icon: 'storm' },
  99: { label: 'Močna nevihta s točo', icon: 'storm' },
}

const PLACES: Record<string, { lat: number; lon: number }> = {
  'Ljubljana': { lat: 46.0569, lon: 14.5058 },
  'Kranj': { lat: 46.2387, lon: 14.3556 },
  'Maribor': { lat: 46.5547, lon: 15.6459 },
  'Celje': { lat: 46.2309, lon: 15.2604 },
  'Koper': { lat: 45.5481, lon: 13.7300 },
  'Novo mesto': { lat: 45.8010, lon: 15.1700 },
  'Nova Gorica': { lat: 45.9555, lon: 13.6403 },
  'Portorož': { lat: 45.5133, lon: 13.5936 },
  'Slovenj Graddek': { lat: 46.5100, lon: 15.0500 },
}

interface WeatherDay {
  date: string
  tmin: number
  tmax: number
  precip: number
  precipHours: number
  windMax: number
  code: number
  label: string
  icon: Wmo['icon']
  score: number // 0–100 primernost za montažo na terenu
}

/** Ocene primerenosti za terensko montažo: hladen dež in veter sta glavni oviri. */
function montažniScore (day: Omit<WeatherDay, 'score' | 'label' | 'icon'>): number {
  let s = 100
  s -= Math.min(45, day.precip * 28) // dež
  s -= Math.min(20, day.precipHours * 2.2)
  s -= Math.min(25, Math.max(0, day.windMax - 25) * 2) // veter nad 25 km/h
  if (day.tmax < 2) s -= 25 // zmrzal
  if (day.tmax > 33) s -= 15 // žega
  return Math.round(Math.max(0, Math.min(100, s)))
}

export async function GET (req: NextRequest) {
  const auth = await requirePermission(req, 'nalog.read')
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const place = (url.searchParams.get('place') ?? 'Ljubljana').trim()
  let lat = Number(url.searchParams.get('lat'))
  let lon = Number(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    const p = PLACES[place] ?? PLACES.Ljubljana
    lat = p.lat; lon = p.lon
  }

  const api = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,wind_speed_10m_max,weather_code' +
    '&timezone=Europe%2FBelgrade&forecast_days=4'

  let raw: {
    daily?: {
      time: string[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
      precipitation_sum: number[]
      precipitation_hours: number[]
      wind_speed_10m_max: number[]
      weather_code: number[]
    }
  }

  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'roksal-railing-manager/1.0' } })
    if (!res.ok) return jsonError(502, 'Vremenska storitev ni odgovorila.', `Open-Meteo HTTP ${res.status}.`)
    raw = await res.json() as typeof raw
  } catch {
    return jsonError(503, 'Vremenska storitev trenutno ni dosegljiva.', 'Poskusite znova kasneje.')
  }

  const d = raw.daily
  if (!d || !Array.isArray(d.time)) return jsonError(502, 'Nepričakovana oblika odgovora vremenske storitve.')

  const days: WeatherDay[] = d.time.slice(0, 4).map((date, i) => {
    const base = {
      date,
      tmax: Math.round(d.temperature_2m_max[i]),
      tmin: Math.round(d.temperature_2m_min[i]),
      precip: d.precipitation_sum[i],
      precipHours: d.precipitation_hours[i],
      windMax: Math.round(d.wind_speed_10m_max[i]),
      code: d.weather_code[i],
    }
    const wmo = WMO[base.code] ?? { label: 'Neznano', icon: 'cloud' as const }
    return { ...base, label: wmo.label, icon: wmo.icon, score: montažniScore(base) }
  })

  return NextResponse.json({
    data: {
      place: PLACES[place] ? place : `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      days,
      updated: new Date().toISOString(),
    },
  })
}
