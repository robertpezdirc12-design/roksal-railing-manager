'use client'

// DANES — vreme za terenska dela (R434 — nespremenjeno) — R548 izvleček iz
// danes.tsx (razbitje po vzorcu R546/R547; BREZ spremembe obnašanja).

import {
  CloudRain, CloudSnow, Cloudy, Sun, Thermometer, TriangleAlert, Umbrella, Wind,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type WeatherDay } from './danes-shared'

// ─── vreme (R434 — nespremenjeno) ────────────────────────────────────────────

export const W_ICONS: Record<string, typeof Sun> = {
  sun: Sun, cloud: Cloudy, rain: CloudRain, snow: CloudSnow, storm: TriangleAlert, fog: Cloudy,
}

export const DAY_NAMES = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob']

export function scoreLabel (score: number): { text: string; cls: string } {
  if (score >= 75) return { text: 'primerno za montažo', cls: 'text-emerald-600 dark:text-emerald-400' }
  if (score >= 45) return { text: 'previdno — preveri termin', cls: 'text-amber-600 dark:text-amber-400' }
  return { text: 'neprimerno za teren', cls: 'text-red-600 dark:text-red-400' }
}

export function WeatherCard ({ day, isToday }: { day: WeatherDay; isToday: boolean }) {
  const Icon = W_ICONS[day.icon] ?? Cloudy
  const sl = scoreLabel(day.score)
  const dt = new Date(day.date)
  const dayName = isToday ? 'danes' : DAY_NAMES[dt.getDay()]
  return (
    <Card className={cn(isToday && 'border-roksal-amber/60')}>
      <CardContent className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{dayName}</span>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="flex items-baseline gap-1.5">
          <Thermometer className="size-3.5 shrink-0 self-center text-muted-foreground" aria-hidden />
          <span className="text-lg font-bold leading-none">{day.tmax}°</span>
          <span className="text-xs text-muted-foreground">{day.tmin}°</span>
        </div>
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Umbrella className="size-3 shrink-0" aria-hidden />
            {day.precip > 0 ? `${day.precip.toFixed(1)} mm · ${day.precipHours} h` : 'brez padavin'}
          </div>
          <div className="flex items-center gap-1">
            <Wind className="size-3 shrink-0" aria-hidden />
            {day.windMax} km/h
          </div>
        </div>
        <p className={cn('text-[11px] font-semibold leading-tight', sl.cls)}>{sl.text}</p>
        <p className="sr-only">
          {dayName}: {day.label}, {day.tmin} do {day.tmax} stopinj,
          {day.precip > 0 ? ` padavine ${day.precip.toFixed(1)} milimetrov` : ' brez padavin'},
          veter do {day.windMax} kilometrov na uro. {sl.text}.
        </p>
      </CardContent>
    </Card>
  )
}
