'use client'

import * as React from 'react'
// custom-icons — Roksal custom SVG ikone (namesto generičnih Lucide)
// Uporaba: <RoksalIcon name="camera" className="size-5" />

import { cn } from '@/lib/utils'

const icons: Record<string, (props: { className?: string }) => React.ReactElement> = {
  camera: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  ),
  ruler: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" />
      <path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" />
      <path d="m17.5 15.5 2-2" />
    </svg>
  ),
  fence: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M3 20V8l3-3 3 3v12" />
      <path d="M9 20V8l3-3 3 3v12" />
      <path d="M15 20V8l3-3 3 3v12" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  ),
  photo: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L7 20" />
    </svg>
  ),
  measure: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 4 4-4" />
      <circle cx="7" cy="16" r="1" fill="currentColor" />
      <circle cx="11" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="16" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  qr: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h1" />
      <path d="M21 12v.01" />
    </svg>
  ),
  pdf: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15v-2h2" />
      <path d="M9 13h2a1 1 0 0 1 0 2H9" />
      <path d="M15 13v4" />
      <path d="M13 13h4" />
    </svg>
  ),
  bluetooth: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="m7 7 10 10-5 5V2l5 5L7 17" />
    </svg>
  ),
  ar: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  share: ({ className }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4', className)}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
}

export type RoksalIconName = keyof typeof icons

export function RoksalIcon ({ name, className }: { name: RoksalIconName; className?: string }) {
  const Icon = icons[name]
  if (!Icon) return null
  return <Icon className={className} />
}

export { icons as roksalIcons }

// Re-export all Lucide icons — custom SVGs take precedence where defined above.
export { Activity, AlertTriangle, Aperture, ArrowDownLeft, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BadgeCheck, BadgeJapaneseYen, Ban, Banknote, Bell, BellRing, BookOpen, Box, Boxes, Calculator, CalendarCheck, CalendarCheck2, CalendarClock, CalendarDays, Camera, CameraOff, CarFront, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, Circle, CircleDashed, CircleHelp, ClipboardCheck, ClipboardList, Clock, Clock3, Cloud, CloudOff, CloudRain, CloudSnow, CloudUpload, Cloudy, Cog, Compass, Copy, Cpu, Crosshair, DatabaseBackup, Download, Eraser, ExternalLink, Eye, Factory, Fence, FileCode, FileCode2, FileDown, FileImage, FileJson, FilePlus2, FileSignature, FileSpreadsheet, FileStack, FileText, FileWarning, Film, FlagTriangleRight, Flashlight, FlashlightOff, FolderKanban, FolderOpen, FolderPlus, Gauge, GitBranch, GitCompareArrows, Grid3x3, Hammer, HandCoins, HardHat, HelpCircle, History, Image, ImageIcon, Inbox, Info, KeyRound, Languages, Laptop, Layers, LifeBuoy, Lightbulb, Link2, ListChecks, ListRestart, ListTree, Loader2, Lock, LockKeyhole, LockOpen, LogIn, LogOut, Mail, Map, MapPin, Maximize2, MessageSquare, MessageSquareWarning, Minimize2, Minus, MinusCircle, Moon, MoreHorizontal, Mountain, MousePointerClick, Move, Move3d, MoveHorizontal, NotebookPen, Orbit, Package, PackageCheck, PackagePlus, PackageSearch, PackageX, Palette, Paperclip, Pause, PenLine, Pencil, Percent, Phone, Play, Plus, Radar, RadioTower, Receipt, Redo2, RefreshCcw, RefreshCw, Rocket, RotateCcw, RotateCw, Ruler, Satellite, Save, Scale, ScanLine, ScanSearch, ScrollText, Search, Send, Settings2, Shapes, ShieldAlert, ShieldCheck, ShieldQuestion, ShoppingCart, Sigma, SkipForward, Smartphone, Sparkles, SquarePlus, SquareStack, Star, Sun, SwitchCamera, Tag, Target, Thermometer, Timer, Trash2, TrendingUp, TriangleAlert, Truck, Umbrella, Undo2, Unlink, Upload, User, UserCheck, UserPlus, UserRound, Users, Video, Volume2, VolumeX, Wallet, Wand2, Warehouse, Waypoints, Webhook, WifiOff, Wind, Workflow, Wrench, X, XCircle, ZoomIn } from "lucide-react"
