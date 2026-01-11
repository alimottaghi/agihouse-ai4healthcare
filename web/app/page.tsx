'use client'

import { FormEvent, useCallback, useState, useId, useMemo, useEffect, ReactNode } from 'react'
import { CircleAlertIcon, BedIcon, ClockIcon, EyeIcon, TrendingUpIcon, ActivityIcon, HeartPulseIcon, ListIcon, MessageSquareIcon, XIcon } from "lucide-react"
import { Button, buttonVariants } from '../components/ui/button'
import { Dialog, DialogTrigger, DialogPortal, DialogBackdrop, DialogPopup, DialogTitle, DialogClose } from "../components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Frame } from '../components/ui/frame'
import { Field, FieldLabel, FieldControl } from '../components/ui/field'
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert'

// Types
type Row = {
  type?: string
  startDate?: string
  endDate?: string
  value?: string | number
  workoutActivityType?: string
  _tag?: string
  [k: string]: unknown
}

function useVitals() {
  const defaultPath = process.env.NEXT_PUBLIC_APPLE_XML_PATH || ''
  const [filePath, setFilePath] = useState(defaultPath)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<VitalRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    if (!filePath) {
      setError('Enter file_path or set NEXT_PUBLIC_APPLE_XML_PATH')
      return
    }
    setLoading(true)
    try {
      const sp = new URLSearchParams({ file_path: filePath })
      if (startDate) sp.append('start', startDate)
      if (endDate) sp.append('end', endDate)
      const res = await fetch('/api/vitals?' + sp, { cache: 'no-store' })
      const text = await res.text()
      if (!res.ok) {
        const detail = parseDetail(text)
        throw new Error(detail ?? `Request failed (${res.status})`)
      }
      const data = text ? (JSON.parse(text) as VitalRow[]) : []
      setRows(data)
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filePath, startDate, endDate])

  const reset = () => { setFilePath(defaultPath); setStartDate(''); setEndDate(''); setRows([]); setError('') }
  return { filePath, setFilePath, startDate, setStartDate, endDate, setEndDate, rows, loading, error, load, reset }
}
type SleepStage = 'Awake' | 'Core' | 'Deep' | 'REM' | 'Unspecified'
type SleepSegment = { stage: SleepStage; startDate: string; endDate: string; duration: number }
type SleepSession = {
  startDate: string; endDate: string; duration: number;
  asleepDuration: number; awakeDuration: number; awakenings: number; segments: SleepSegment[];
}

type VitalRow = Row

type Tab = 'records' | 'sleep' | 'vitals'
type NavItem = {
  id: Tab
  label: string
  icon: React.ReactNode
  disabled?: boolean
}

const navigationItems: NavItem[] = [
  { id: 'records', label: 'Records', icon: <ListIcon className="w-4 h-4" /> },
  { id: 'sleep', label: 'Sleep', icon: <BedIcon className="w-4 h-4" /> },
  { id: 'vitals', label: 'Vitals', icon: <HeartPulseIcon className="w-4 h-4" /> },
]

function isTab(id: Tab): id is Tab {
  return true
}

type VitalPoint = { date: string; value: number; unit?: string; source?: string }
type VitalSeries = { type: string; unit?: string; points: VitalPoint[]; secondaryPoints?: VitalPoint[] }

const VITAL_NAME_MAP: Record<string, string> = {
  HKQuantityTypeIdentifierHeartRate: 'Heart Rate',
  HKQuantityTypeIdentifierRestingHeartRate: 'Resting Heart Rate',
  HKQuantityTypeIdentifierWalkingHeartRateAverage: 'Walking HR Avg',
  HKQuantityTypeIdentifierBloodPressureSystolic: 'Blood Pressure (Systolic)',
  HKQuantityTypeIdentifierBloodPressureDiastolic: 'Blood Pressure (Diastolic)',
  HKQuantityTypeIdentifierBloodGlucose: 'Blood Glucose',
  HKQuantityTypeIdentifierRespiratoryRate: 'Respiratory Rate',
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: 'Wrist Temperature',
}

const VITAL_UNIT_MAP: Record<string, string> = {
  'count/min': 'BPM',
  bpm: 'BPM',
  'breaths/min': 'breaths/min',
  'degC': '°C',
  'degF': '°F',
  kg: 'kg',
  lb: 'lb',
  mmHg: 'mmHg',
  'mg/dL': 'mg/dL',
}

const VITAL_UNIT_BY_TYPE: Record<string, string> = {
  HKQuantityTypeIdentifierRespiratoryRate: 'breaths/min',
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: '°C',
}

function displayValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function friendlyName(type: string): string {
  return VITAL_NAME_MAP[type] || type.replace(/^HKQuantityTypeIdentifier/, '').replace(/([A-Z])/g, ' $1').trim()
}

function friendlyUnit(unit?: string): string | undefined {
  if (!unit) return undefined
  const norm = unit.trim()
  return VITAL_UNIT_MAP[norm] || norm
}

function buildVitalSeries(rows: VitalRow[]): VitalSeries[] {
  const byRaw: Record<string, VitalSeries> = {}
  rows.forEach((r) => {
    const rawType = (r.type || r._type || r._tag || 'Unknown') as string
    const valueNum = Number(r.value)
    if (Number.isNaN(valueNum)) return
    const overrideUnit = VITAL_UNIT_BY_TYPE[rawType]
    const unit = overrideUnit || friendlyUnit((r as any).unit as string | undefined)
    if (!byRaw[rawType]) byRaw[rawType] = { type: rawType, unit, points: [] }
    byRaw[rawType].points.push({
      date: (r.startDate as string) || (r.endDate as string) || (r.creationDate as string) || '',
      value: valueNum,
      unit,
      source: r.sourceName as string | undefined,
    })
  })

  const sortPoints = (pts: VitalPoint[]) =>
    pts.filter((p) => p.date).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const series: VitalSeries[] = []

  const sys = byRaw['HKQuantityTypeIdentifierBloodPressureSystolic']
  const dia = byRaw['HKQuantityTypeIdentifierBloodPressureDiastolic']
  if (sys || dia) {
    series.push({
      type: 'Blood Pressure',
      unit: friendlyUnit(sys?.unit || dia?.unit),
      points: sortPoints(sys?.points || []),
      secondaryPoints: sortPoints(dia?.points || []),
    })
    delete byRaw['HKQuantityTypeIdentifierBloodPressureSystolic']
    delete byRaw['HKQuantityTypeIdentifierBloodPressureDiastolic']
  }

  Object.values(byRaw).forEach((s) => {
    const pts = sortPoints(s.points)
    if (pts.length === 0) return
    series.push({ ...s, type: friendlyName(s.type), points: pts })
  })

  return series
}

// Hooks
function useRecords() {
  const defaultPath = process.env.NEXT_PUBLIC_APPLE_XML_PATH || ''
  const [filePath, setFilePath] = useState(defaultPath)
  const [typeFilter, setTypeFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    if (!filePath) {
      setError('Enter file_path or set NEXT_PUBLIC_APPLE_XML_PATH')
      return
    }
    setLoading(true)
    try {
      const sp = new URLSearchParams({ file_path: filePath })
      typeFilter.split(',').map(s => s.trim()).filter(Boolean).forEach(t => sp.append('types', t))
      if (startDate) sp.append('start', startDate)
      if (endDate) sp.append('end', endDate)
      const res = await fetch('/api/records?' + sp, { cache: 'no-store' })
      const text = await res.text()
      if (!res.ok) {
        const detail = parseDetail(text)
        throw new Error(detail ?? `Request failed (${res.status})`)
      }
      const data = text ? (JSON.parse(text) as Row[]) : []
      setRows(data)
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filePath, typeFilter, startDate, endDate])

  const reset = () => {
    setFilePath(defaultPath); setTypeFilter(''); setStartDate(''); setEndDate(''); setRows([]); setError('')
  }

  return { filePath, setFilePath, typeFilter, setTypeFilter, startDate, setStartDate, endDate, setEndDate, rows, loading, error, load, reset }
}

function useSleepSessions() {
  const defaultPath = process.env.NEXT_PUBLIC_APPLE_XML_PATH || ''
  const [filePath, setFilePath] = useState(defaultPath)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [sessions, setSessions] = useState<SleepSession[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    if (!filePath) {
      setError('Enter file_path or set NEXT_PUBLIC_APPLE_XML_PATH')
      return
    }
    setLoading(true)
    try {
      const sp = new URLSearchParams({ file_path: filePath })
      if (startDate) sp.append('start', startDate)
      if (endDate) sp.append('end', endDate)
      const res = await fetch('/api/sleep?' + sp, { cache: 'no-store' })
      const text = await res.text()
      if (!res.ok) {
        const detail = parseDetail(text)
        throw new Error(detail ?? `Request failed (${res.status})`)
      }
      const data = text ? (JSON.parse(text) as SleepSession[]) : []
      setSessions(data)
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [filePath, startDate, endDate])

  const reset = () => { setFilePath(defaultPath); setStartDate(''); setEndDate(''); setSessions([]); setError('') }
  return { filePath, setFilePath, startDate, setStartDate, endDate, setEndDate, sessions, loading, error, load, reset }
}

function parseDetail(s: string) {
  try { const j = JSON.parse(s); return j?.detail || j?.error || null } catch { return null }
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return "0m"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const sleepStageConfig: Record<SleepStage, { label: string; color: string; bgClass: string }> = {
  Deep: { label: "Deep", color: "var(--chart-3)", bgClass: "bg-chart-3" },
  Core: { label: "Core", color: "var(--chart-2)", bgClass: "bg-chart-2" },
  REM: { label: "REM", color: "var(--chart-4)", bgClass: "bg-chart-4" },
  Awake: { label: "Awake", color: "var(--chart-5)", bgClass: "bg-chart-5" },
  Unspecified: { label: "Unspecified", color: "var(--muted-foreground)", bgClass: "bg-muted" },
}

// Sleep Statistics Component
function SleepStatistics({ sessions }: { sessions: SleepSession[] }) {
  const stats = useMemo(() => {
    if (sessions.length === 0) return null

    const totalSleep = sessions.reduce((sum, s) => sum + s.asleepDuration, 0)
    const avgSleep = totalSleep / sessions.length
    const totalAwake = sessions.reduce((sum, s) => sum + s.awakeDuration, 0)
    const avgAwake = totalAwake / sessions.length
    const totalAwakenings = sessions.reduce((sum, s) => sum + s.awakenings, 0)
    const avgAwakenings = totalAwakenings / sessions.length
    const avgEfficiency = sessions.reduce((sum, s) => sum + (s.asleepDuration / s.duration), 0) / sessions.length * 100

    // Stage breakdown
    const stageBreakdown: Record<string, number> = {}
    sessions.forEach(session => {
      session.segments.forEach(seg => {
        stageBreakdown[seg.stage] = (stageBreakdown[seg.stage] || 0) + seg.duration
      })
    })

    return {
      avgSleep,
      avgAwake,
      avgAwakenings,
      avgEfficiency,
      totalSessions: sessions.length,
      stageBreakdown
    }
  }, [sessions])

  if (!stats) return null

  return (
    <div className="stats-grid mb-6">
      <Frame className="p-4">
        <div className="stat-card">
          <div>
            <p className="stat-card-content">Avg Sleep</p>
            <p className="stat-card-value">{formatDuration(stats.avgSleep)}</p>
          </div>
          <BedIcon className="stat-card-icon" />
        </div>
      </Frame>
      
      <Frame className="p-4">
        <div className="stat-card">
          <div>
            <p className="stat-card-content">Efficiency</p>
            <p className="stat-card-value">{stats.avgEfficiency.toFixed(0)}%</p>
          </div>
          <TrendingUpIcon className="stat-card-icon" />
        </div>
      </Frame>

      <Frame className="p-4">
        <div className="stat-card">
          <div>
            <p className="stat-card-content">Avg Awake</p>
            <p className="stat-card-value">{formatDuration(stats.avgAwake)}</p>
          </div>
          <ClockIcon className="stat-card-icon" />
        </div>
      </Frame>

      <Frame className="p-4">
        <div className="stat-card">
          <div>
            <p className="stat-card-content">Awakenings</p>
            <p className="stat-card-value">{stats.avgAwakenings.toFixed(1)}</p>
          </div>
          <EyeIcon className="stat-card-icon" />
        </div>
      </Frame>
    </div>
  )
}

// Enhanced Sleep Session Card
function SleepSessionCard({ session, showDetails }: { session: SleepSession; showDetails?: boolean }) {
  const [expanded, setExpanded] = useState(showDetails ?? false)
  
  const stageBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {}
    session.segments.forEach(seg => {
      breakdown[seg.stage] = (breakdown[seg.stage] || 0) + seg.duration
    })
    return breakdown
  }, [session.segments])

  const efficiency = ((session.asleepDuration / session.duration) * 100).toFixed(0)
  const startDate = new Date(session.startDate)
  const endDate = new Date(session.endDate)

  return (
    <Frame className="p-4 space-y-4 card-hover">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <header className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="font-semibold text-base">
              {startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {formatTime(session.startDate)} → {formatTime(session.endDate)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">{formatDuration(session.asleepDuration)}</p>
            <p className="text-xs text-muted-foreground">{efficiency}% efficiency</p>
          </div>
        </header>
      </button>

      {/* Quick Stats */}
      <div className="quick-stats-grid">
        <div className="stat-item">
          <div className="icon-badge">
            <ClockIcon className="icon-badge-sm" />
          </div>
          <div>
            <p className="stat-item-label">In Bed</p>
            <p className="stat-item-value">{formatDuration(session.duration)}</p>
          </div>
        </div>
        <div className="stat-item">
          <div className="icon-badge">
            <BedIcon className="icon-badge-sm" />
          </div>
          <div>
            <p className="stat-item-label">Awake</p>
            <p className="stat-item-value">{formatDuration(session.awakeDuration)}</p>
          </div>
        </div>
        <div className="stat-item">
          <div className="icon-badge">
            <EyeIcon className="icon-badge-sm" />
          </div>
          <div>
            <p className="stat-item-label">Woke</p>
            <p className="stat-item-value">{session.awakenings}×</p>
          </div>
        </div>
      </div>

      {/* Sleep Stage Timeline */}
      <div>
        <div className="w-full h-10 flex rounded-lg overflow-hidden shadow-sm" title="Sleep Stages Timeline">
          {session.segments.map((seg, i) => {
            const width = (seg.duration / session.duration) * 100
            return (
              <div
                key={i}
                style={{ 
                  width: `${width}%`, 
                  backgroundColor: sleepStageConfig[seg.stage].color 
                }}
                className="timeline-segment"
                title={`${seg.stage}: ${formatDuration(seg.duration)} (${formatTime(seg.startDate)} - ${formatTime(seg.endDate)})`}
              />
            )
          })}
        </div>
        
        {/* Legend */}
        <div className="legend-wrapper mt-3">
          {Object.entries(sleepStageConfig)
            .filter(([stage]) => stageBreakdown[stage])
            .map(([stage, config]) => (
              <div key={stage} className="legend-item">
                <span className="sleep-stage-indicator" style={{ backgroundColor: config.color }} />
                <span className="legend-label">
                  {config.label}: <span className="legend-value">{formatDuration(stageBreakdown[stage])}</span>
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="pt-3 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">Sleep Segments</p>
          <div className="scrollable-segments space-y-1">
            {session.segments.map((seg, i) => (
              <div key={i} className="detail-row">
                <div className="detail-row-label">
                  <span className="sleep-stage-dot" style={{ backgroundColor: sleepStageConfig[seg.stage].color }} />
                  <span className="font-medium">{sleepStageConfig[seg.stage].label}</span>
                </div>
                <div className="detail-row-content">
                  <span>{formatTime(seg.startDate)} - {formatTime(seg.endDate)}</span>
                  <span className="font-medium">{formatDuration(seg.duration)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Frame>
  )
}

function Sparkline({ points, secondary }: { points: VitalPoint[]; secondary?: VitalPoint[] }) {
  if (points.length === 0 && (!secondary || secondary.length === 0)) return null
  const w = 260
  const h = 72
  const allPoints = secondary ? [...points, ...secondary] : points
  const minX = Math.min(...allPoints.map((p) => new Date(p.date).getTime()))
  const maxX = Math.max(...allPoints.map((p) => new Date(p.date).getTime()))
  const minY = Math.min(...allPoints.map((p) => p.value))
  const maxY = Math.max(...allPoints.map((p) => p.value))
  const padY = (maxY - minY) * 0.1 || 1
  const minYp = minY - padY
  const maxYp = maxY + padY

  const scaleX = (t: number) => ((t - minX) / (maxX - minX || 1)) * w
  const scaleY = (v: number) => h - ((v - minYp) / (maxYp - minYp || 1)) * h

  const toPath = (pts: VitalPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(new Date(p.date).getTime()).toFixed(2)} ${scaleY(p.value).toFixed(2)}`)
      .join(' ')

  const primaryPath = points.length ? toPath(points) : ''
  const secondaryPath = secondary && secondary.length ? toPath(secondary) : ''
  const baseForFill = points[0] || secondary?.[0]
  const secondaryStroke = 'text-muted-foreground'
  const secondaryDot = 'fill-muted-foreground'

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[72px] text-primary/80">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {primaryPath && (
        <>
          <path d={primaryPath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {baseForFill && (
            <path
              d={`${primaryPath} V ${h} H ${scaleX(new Date(baseForFill.date).getTime()).toFixed(2)} Z`}
              fill="url(#spark)"
              stroke="none"
              opacity="0.5"
            />
          )}
        </>
      )}
      {secondaryPath && (
        <path
          d={secondaryPath}
          fill="none"
          stroke="currentColor"
          className={secondaryStroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={scaleX(new Date(p.date).getTime())} cy={scaleY(p.value)} r={3} className="fill-primary" />
      ))}
      {secondary && secondary.map((p, i) => (
        <circle key={i} cx={scaleX(new Date(p.date).getTime())} cy={scaleY(p.value)} r={3} className={secondaryDot} />
      ))}
    </svg>
  )
}

function VitalSeriesCard({ series }: { series: VitalSeries }) {
  const primary = series.points
  const secondary = series.secondaryPoints
  const first = primary[0]
  const latest = primary[primary.length - 1]
  if (!first || !latest) return null
  const delta = latest.value - first.value
  const deltaPct = first.value !== 0 ? (delta / first.value) * 100 : 0
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'

  const latestSecondary = secondary && secondary[secondary.length - 1]

  return (
    <Frame className="p-4 space-y-3">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Vital</p>
          <h3 className="font-semibold text-base">{series.type}</h3>
          {series.unit && <p className="text-xs text-muted-foreground">Unit: {series.unit}</p>}
        </div>
        <div className="text-right">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-semibold">
                {latestSecondary
                  ? `${displayValue(latest.value)} / ${displayValue(latestSecondary.value)} ${series.unit || latest.unit || ''}`
                  : `${displayValue(latest.value)} ${series.unit || latest.unit || ''}`}
              </div>
              <span className={direction === 'up' ? 'text-destructive' : direction === 'down' ? 'text-emerald-600' : 'text-muted-foreground'}>
                {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'} {Math.abs(delta).toFixed(1)} ({Math.abs(deltaPct).toFixed(1)}%)
              </span>
            </div>
            {latestSecondary && (
              <div className="text-xs text-muted-foreground">
                Latest: {displayValue(latest.value)} systolic / {displayValue(latestSecondary.value)} diastolic
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="rounded-xl border bg-card/60 p-3">
        <Sparkline points={primary} secondary={secondary} />
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
          <span>{new Date(first.date).toLocaleDateString()}</span>
          <span>{new Date(latest.date).toLocaleDateString()}</span>
        </div>
      </div>
    </Frame>
  )
}

// Floating Navigation Sidebar
function NavigationSidebar({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  return (
    <Frame className="p-2 shadow-lg">
      <nav className="space-y-1">
        {navigationItems
          .filter((item): item is NavItem & { id: Tab } => isTab(item.id))
          .map((item) => {
            const isActive = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`
                  nav-btn
                  ${isActive
                    ? 'nav-btn-active'
                    : 'nav-btn-default'
                  }
                `}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            )
          })}
      </nav>
    </Frame>
  )
}

type ChatRole = 'assistant' | 'user'
type ChatMessage = { role: ChatRole; content: string }

function ChatColumn({
  messages,
  input,
  setInput,
  onSend,
  sending,
  error,
  suggestions,
  suggestionsLoading,
  onSelectSuggestion,
  onHide,
}: {
  messages: ChatMessage[]
  input: string
  setInput: (v: string) => void
  onSend: (override?: string) => void
  sending: boolean
  error: string
  suggestions: string[]
  suggestionsLoading: boolean
  onSelectSuggestion: (v: string) => void
  onHide: () => void
}) {
  const renderMessage = (content: string) => {
    const lines = content.split('\n')
    const blocks: React.ReactNode[] = []
    let list: string[] = []
    const flushList = () => {
      if (list.length) {
        blocks.push(
          <ul className="list-disc list-inside space-y-0.5 text-[13px]" key={`list-${blocks.length}`}>
            {list.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        )
        list = []
      }
    }
    lines.forEach((line, idx) => {
      if (line.trim().startsWith('- ')) {
        list.push(line.trim().slice(2))
      } else {
        flushList()
        blocks.push(
          <p className="text-[13px] leading-snug whitespace-pre-wrap" key={`p-${idx}`}>
            {line || '\u00A0'}
          </p>
        )
      }
    })
    flushList()
    return blocks
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <p className="text-xs text-muted-foreground">Chat</p>
          <h3 className="font-semibold text-sm">Health Coach</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">Online</span>
          <button
            onClick={onHide}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition"
            aria-label="Hide chat"
          >
            <XIcon className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
                {m.role === 'user' ? 'You' : 'Assistant'}
              </p>
              <div className="space-y-1">{renderMessage(m.content)}</div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-3 py-2 bg-muted text-foreground text-xs opacity-70">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t space-y-2">
        <div className="flex flex-wrap gap-2">
          {(suggestionsLoading ? Array.from({ length: 3 }).map((_, i) => `Loading ${i}`) : suggestions).map((s, i) =>
            suggestionsLoading ? (
              <span key={i} className="h-8 px-3 rounded-full bg-muted text-muted-foreground/70 text-xs flex items-center animate-pulse">
                …
              </span>
            ) : (
              <button
                key={s + i}
                className="rounded-full border bg-background hover:bg-muted text-xs px-3 py-1 transition"
                onClick={() => onSelectSuggestion(s)}
                type="button"
              >
                {s}
              </button>
            )
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            disabled={sending}
            className="flex-1 rounded-lg border px-3 py-2 text-sm bg-background"
            placeholder="Ask about your vitals, workouts, or sleep..."
          />
          <Button size="sm" onClick={() => onSend()} disabled={sending || !input.trim()}>
            Send
          </Button>
        </div>
        {error && <p className="text-[10px] text-destructive">{error}</p>}
        <p className="text-[10px] text-muted-foreground">Context-aware answers using loaded data.</p>
      </div>
    </div>
  )
}


export default function Dashboard() {
  const [chatOpen, setChatOpen] = useState(true)
  const [chatWidth, setChatWidth] = useState(320)
  const [resizingChat, setResizingChat] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! Ask me about your vitals, workouts, or sleep.' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([])
  const [chatSuggestionsLoading, setChatSuggestionsLoading] = useState(false)
  const [initialSuggestionsDone, setInitialSuggestionsDone] = useState(false)
  const [activeTab, setActiveTab] = useState<'records' | 'sleep' | 'vitals'>('records')
  const recordsState = useRecords()
  const sleepState = useSleepSessions()
  const vitalsState = useVitals()
  const state = activeTab === 'records' ? recordsState : activeTab === 'sleep' ? sleepState : vitalsState
  const { loading, error } = state

  const handleReset = () => { recordsState.reset(); sleepState.reset(); vitalsState.reset() }

  const filePathId = useId()
  const recordTypesId = useId()
  const startDateId = useId()
  const endDateId = useId()

  const buildRecordsContext = () => {
    const rows = recordsState.rows || []
    if (!rows.length) return ''
    const types = Array.from(new Set(rows.map((r) => (r.type || r._tag || 'Unknown')))).sort()
    const samples = rows.slice(0, 50).map((r) => ({
      type: r.type || r._tag || 'Unknown',
      start: r.startDate || r.start || '',
      end: r.endDate || r.end || '',
      value: r.value ?? '',
      unit: r.unit ?? '',
    }))
    return `Records tab: total=${rows.length}, types=[${types.join(', ')}], samples=${JSON.stringify(samples)}`
  }

  const buildSleepContext = () => {
    const sessions = sleepState.sessions || []
    if (!sessions.length) return ''
    const summarized = sessions.map((s) => ({
      start: s.startDate,
      end: s.endDate,
      durationMin: s.duration,
      asleepMin: s.asleepDuration,
      awakeMin: s.awakeDuration,
      awakenings: s.awakenings,
      segments: (s.segments || []).map((seg) => ({
        stage: seg.stage,
        start: seg.startDate,
        end: seg.endDate,
        durationMin: seg.duration,
      })),
    }))
    return `Sleep tab: total=${sessions.length}, sessions=${JSON.stringify(summarized)}`
  }

  const buildVitalsContext = () => {
    const rows = vitalsState.rows || []
    if (!rows.length) return ''
    const series = buildVitalSeries(rows)
    const detailed = series.slice(0, 12).map((s) => {
      const pts = s.points || []
      const latest = pts[pts.length - 1]
      const sample = pts.slice(-50).map((p) => ({ time: p.date, value: p.value }))
      const secondarySample = (s.secondaryPoints || []).slice(-50).map((p) => ({ time: p.date, value: p.value }))
      return {
        type: s.type,
        unit: s.unit,
        latest: latest ? { time: latest.date, value: latest.value } : null,
        points: sample,
        secondaryPoints: secondarySample.length ? secondarySample : undefined,
      }
    })
    return `Vitals tab: seriesCount=${series.length}, series=${JSON.stringify(detailed)}`
  }

  const buildContextForChat = () => {
    const ctx =
      activeTab === 'records'
        ? buildRecordsContext()
        : activeTab === 'sleep'
          ? buildSleepContext()
          : buildVitalsContext()
    return ctx ? `Active tab: ${activeTab}\n${ctx}` : ''
  }

  const headerTitle =
    activeTab === 'records'
      ? 'Apple Health Explorer'
      : activeTab === 'sleep'
        ? 'Sleep Sessions'
        : 'Vitals'
  const headerSubtitle =
    activeTab === 'records'
      ? 'Parse, visualize, and chat with your health data'
      : activeTab === 'sleep'
        ? 'Aggregated sleep by night'
        : 'Trends across your vitals'

  const REQUIRED_SUGGESTION = 'What 3 practical changes would improve my REM and deep sleep based on these records?'

  const fetchSuggestions = async (baseMessages: ChatMessage[], ensureRequired?: boolean) => {
    setChatSuggestionsLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: baseMessages,
          context: buildContextForChat(),
          mode: 'suggestions',
        }),
      })
      const text = await res.text()
      let replyText: string | undefined
      try {
        const json = text ? JSON.parse(text) : {}
        replyText = json.reply
      } catch {
        replyText = undefined
      }
      const includeRequired = ensureRequired && !initialSuggestionsDone
      if (replyText) {
        const lines = replyText.split('\n').map((l: string) => l.replace(/^-+\s*/, '').trim()).filter(Boolean)
        let finalLines = lines.slice(0, 5)
        if (includeRequired) {
          if (!finalLines.length) finalLines = [REQUIRED_SUGGESTION]
          if (!finalLines.includes(REQUIRED_SUGGESTION)) {
            if (finalLines.length < 5) {
              finalLines.push(REQUIRED_SUGGESTION)
            } else {
              finalLines[finalLines.length - 1] = REQUIRED_SUGGESTION
            }
          }
        }
        setChatSuggestions(finalLines)
      } else if (includeRequired) {
        setChatSuggestions([REQUIRED_SUGGESTION])
      }
      if (includeRequired) setInitialSuggestionsDone(true)
    } catch {
      /* ignore suggestion errors */
    } finally {
      setChatSuggestionsLoading(false)
    }
  }

  const sendChat = async (override?: string) => {
    if (chatSending) return
    const trimmed = (override ?? chatInput).trim()
    if (!trimmed) return
    setChatError('')
    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content: trimmed }]
    setChatMessages(nextMessages)
    if (override === undefined) setChatInput('')
    setChatSending(true)
    setChatSuggestionsLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, context: buildContextForChat() }),
      })
      const text = await res.text()
      if (!res.ok) {
        let detail: any = null
        try { detail = JSON.parse(text) } catch {}
        const message = detail?.error ?? `Request failed (${res.status})`
        throw new Error(message)
      }
      const data = text ? JSON.parse(text) as { reply?: string } : {}
      const reply = data.reply?.trim()
      if (reply) {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      } else {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I could not generate a reply.' }])
      }
      fetchSuggestions([...nextMessages, { role: 'assistant', content: reply || '' }], false)
    } catch (err: any) {
      setChatError(err?.message ?? 'Unexpected error')
      setChatSuggestionsLoading(false)
    } finally {
      setChatSending(false)
    }
  }

  useEffect(() => {
    if (!resizingChat) return
    const handleMove = (e: MouseEvent) => {
      const vw = window.innerWidth
      const newWidth = Math.min(Math.max(vw - e.clientX, 260), 560)
      setChatWidth(newWidth)
    }
    const handleUp = () => setResizingChat(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [resizingChat])

  const handleLoadAll = async (e?: FormEvent) => {
    e?.preventDefault()
    await recordsState.load(e)
    await Promise.all([sleepState.load(), vitalsState.load()])
    fetchSuggestions(chatMessages, true)
  }

  return (
    <div className={`layout-grid ${chatOpen ? 'layout-grid--chat-open' : ''}`} style={{ paddingRight: chatOpen ? chatWidth : undefined }}>
      {/* Left sidebar */}
      <div className="layout-sidebar">
        <div className="sidebar-sticky">
          <NavigationSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* Center content */}
      <main className={`layout-main ${chatOpen ? 'layout-main--chat-open' : ''}`}>
        {/* Header */}
        <header className="page-header">
          <div>
            <h1 className="page-title">{headerTitle}</h1>
            <p className="page-subtitle">{headerSubtitle}</p>
          </div>
        </header>

        {/* Mobile Navigation */}
        <div className="lg:hidden mb-6">
          <Frame className="p-2">
            <nav className="flex gap-1 overflow-x-auto">
              {navigationItems
                .filter((item): item is NavItem & { id: Tab } => isTab(item.id))
                .map((item) => {
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`
                        nav-btn-mobile
                        ${isActive ? 'nav-btn-mobile-active' : 'nav-btn-mobile-default'}
                      `}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </nav>
            </Frame>
          </div>

        {/* Form (records-driven load only) */}
        {activeTab === 'records' && (
          <form onSubmit={handleLoadAll} className="section-spacing mb-6">
            <Frame className="p-4 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor={filePathId}>Apple Health XML file_path</FieldLabel>
                  <FieldControl
                    id={filePathId}
                    type="text"
                    value={recordsState.filePath}
                    onChange={(e) => { recordsState.setFilePath(e.target.value); sleepState.setFilePath(e.target.value); vitalsState.setFilePath(e.target.value) }}
                    placeholder="Your Apple Health export .xml"
                  />
                </Field>

                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor={recordTypesId}>Filter record types <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
                  <FieldControl
                    id={recordTypesId}
                    type="text"
                    value={recordsState.typeFilter}
                    onChange={(e) => recordsState.setTypeFilter(e.target.value)}
                    placeholder="HKQuantityTypeIdentifierStepCount, HKQuantityTypeIdentifierHeartRate"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor={startDateId}>Start Date <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
                  <FieldControl
                    id={startDateId}
                    type="date"
                    value={recordsState.startDate}
                    onChange={(e) => { recordsState.setStartDate(e.target.value); sleepState.setStartDate(e.target.value); vitalsState.setStartDate(e.target.value) }}
                    placeholder="2024-01-20 08:00:00 -0700"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor={endDateId}>End Date <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
                  <FieldControl
                    id={endDateId}
                    type="text"
                    value={recordsState.endDate}
                    onChange={(e) => { recordsState.setEndDate(e.target.value); sleepState.setEndDate(e.target.value); vitalsState.setEndDate(e.target.value) }}
                    placeholder="2024-01-20 09:00:00 -0700"
                  />
                </Field>
              </div>

              <div className="flex justify-center mt-6">
                <Button type="submit" disabled={loading} className="min-w-32">
                  {loading ? 'Loading…' : 'Load Data'}
                </Button>
              </div>
            </Frame>
          </form>
        )}

        {/* Error */}
        {error && (
          <Alert variant="error" className="mb-6">
            <CircleAlertIcon />
            <AlertTitle>Error Loading Data</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Records */}
        {activeTab === 'records' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div />
              <div className="text-sm text-muted-foreground">
                {recordsState.rows.length > 0 ? `${recordsState.rows.length} records loaded` : 'No data loaded'}
              </div>
            </div>

            <Frame className="p-2 overflow-hidden">
              {recordsState.rows.length === 0 ? (
                <div className="empty-state p-10">
                  <CircleAlertIcon className="empty-state-icon" />
                  <p className="empty-state-text">No records loaded</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsState.rows.map((row, i) => {
                      const type = row.type || row.workoutActivityType || row._tag || '—'
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{type}</TableCell>
                          <TableCell>{row.startDate || '—'}</TableCell>
                          <TableCell>{row.endDate || '—'}</TableCell>
                          <TableCell>{displayValue(row.value)}</TableCell>
                          <TableCell>
                            <Dialog>
                              <DialogTrigger className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                                View
                              </DialogTrigger>
                              <DialogPopup>
                                <div className="mb-4 space-y-1">
                                  <DialogTitle>Record Details</DialogTitle>
                                  <p className="text-sm text-muted-foreground">Raw JSON for this record</p>
                                </div>
                                <pre className="text-xs bg-muted rounded-lg p-3 max-h-[60vh] overflow-auto">{JSON.stringify(row, null, 2)}</pre>
                                <div className="mt-4 flex justify-end">
                                  <DialogClose>
                                    <Button variant="outline">Close</Button>
                                  </DialogClose>
                                </div>
                              </DialogPopup>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </Frame>
          </section>
        )}

        {/* Sleep */}
        {activeTab === 'sleep' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div />
              <div className="text-sm text-muted-foreground">
                {sleepState.sessions.length > 0 ? `${sleepState.sessions.length} sessions loaded` : 'No data loaded'}
              </div>
            </div>

            {sleepState.sessions.length === 0 ? (
              <Frame className="p-10">
                <div className="empty-state space-y-2">
                  <CircleAlertIcon className="empty-state-icon" />
                  <p className="empty-state-text">No sleep sessions found for the selected range.</p>
                </div>
              </Frame>
            ) : (
              <>
                <SleepStatistics sessions={sleepState.sessions} />
                <div className="grid gap-4">
                  {sleepState.sessions.map((s, i) => (
                    <SleepSessionCard key={i} session={s} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* Vitals */}
        {activeTab === 'vitals' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div />
              <div className="text-sm text-muted-foreground">
                {vitalsState.rows.length > 0 ? `${vitalsState.rows.length} records loaded` : 'No data loaded'}
              </div>
            </div>

            {vitalsState.rows.length === 0 ? (
              <Frame className="p-10">
                <div className="empty-state space-y-2">
                  <CircleAlertIcon className="empty-state-icon" />
                  <p className="empty-state-text">No vitals found for the selected range.</p>
                </div>
              </Frame>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  {buildVitalSeries(vitalsState.rows).map((series, i) => (
                    <VitalSeriesCard key={series.type + i} series={series} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* Right gutter */}
      {chatOpen && (
        <div className="layout-gutter" style={{ width: chatWidth }}>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-border/60 transition"
            onMouseDown={() => setResizingChat(true)}
            aria-label="Resize chat column"
          />
          <ChatColumn
            messages={chatMessages}
            input={chatInput}
            setInput={setChatInput}
            onSend={sendChat}
            sending={chatSending}
            error={chatError}
            suggestions={chatSuggestions}
            suggestionsLoading={chatSuggestionsLoading}
            onSelectSuggestion={(text) => sendChat(text)}
            onHide={() => setChatOpen(false)}
          />
        </div>
      )}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed top-4 right-4 z-50 hidden lg:inline-flex items-center justify-center w-9 h-9 rounded-full border bg-background shadow-sm hover:bg-muted transition"
          aria-label="Show chat"
        >
          <MessageSquareIcon className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}