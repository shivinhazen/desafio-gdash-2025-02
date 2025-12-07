import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Button } from '@/components/components/ui/button'
import { Card } from '@/components/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/components/ui/dropdown-menu'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/components/ui/accordion'
import { Input } from '@/components/components/ui/input'
import { Label } from '@/components/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/components/ui/table'
import { ClimoAssistantCard } from '@/components/ClimoAssistantCard'
import { cn } from '@/components/lib/utils'
import {
  apiCreateUser,
  apiCurrentUser,
  apiDeleteUser,
  apiExportWeather,
  apiInsights,
  apiLogin,
  apiUpdateUser,
  apiUsers,
  apiWeatherLogs,
  type ApiError,
  type SafeUser,
  type WeatherInsightsPayload,
  type WeatherLog,
  API_ORIGIN,
} from '@/lib/api'
import { type ClimoInsightContext } from '@/hooks/useClimoInsight'
import { io } from 'socket.io-client'
import Lottie from 'lottie-react'
import { ToastProvider } from '@/components/hooks/toast-provider'
import { useToast } from '@/components/hooks/use-toast'
import weatherDayBroken from './assets/lottie/weather-day-broken-clouds.json'
import weatherDayFew from './assets/lottie/weather-day-few-clouds.json'
import weatherDayRain from './assets/lottie/weather-day-rain.json'
import weatherNightClear from './assets/lottie/weather-night-clear-sky.json'
import weatherNightShowers from './assets/lottie/weather-night-shower-rains.json'
import bgDark from '@/assets/background/darkthemebackground.webp'
import bgLight from '@/assets/background/whitethemebackground.webp'
import {
  Activity,
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CloudRain,
  Droplet,
  Download,
  LogOut,
  MoreVertical,
  Moon,
  RefreshCcw,
  SmilePlus,
  Sun,
  Sunset,
  Sunrise,
  Thermometer,
  TrendingUp,
  Wind,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { type LineSeries, type PointTooltipProps } from '@nivo/line'

const LOGS_PAGE_SIZE = 18
const TimeSeriesChart = lazy(() => import('@/components/TimeSeriesChart'))
const HistoricalMiniHeatmap = lazy(() => import('@/components/HistoricalMiniHeatmap'))

type GraphKey = 'temperature' | 'humidity' | 'wind' | 'rain'

const METRIC_KEYS: Record<GraphKey, string[]> = {
  temperature: ['temperature', 'temperature_2m'],
  humidity: ['humidity', 'relative_humidity_2m'],
  wind: ['wind_speed', 'wind_speed_10m'],
  rain: ['rain_chance', 'precipitation_probability'],
}

type RiskLevel = 'none' | 'low' | 'moderate' | 'high'
type HazardKind = 'rain' | 'wind' // future kinds (heat/cold) can be added here.

interface HazardAlert {
  kind: HazardKind
  level: RiskLevel
  label: string
  summary: string
  advice: string
  metrics: {
    rainProbability?: number | null
    rainTotalMm?: number | null
    rainySlots?: number | null
    maxWindKmh?: number | null
    maxGustKmh?: number | null
  }
}

interface DailyAlertSummary {
  level: RiskLevel
  badgeText: string | null
  hazards: HazardAlert[]
  primaryHazard: HazardAlert | null
  hasRain: boolean
  hasWind: boolean
  shortSummary: string | null
  shortAction: string | null
}

type StableDaySuggestion = {
  summary: string
  action: string | null
}

function buildStableDaySuggestion(opts: {
  tempAvg: number | null
  tempMax: number | null
  rainProbability: number | null
  totalRainMm: number
  windSpeed: number | null
}): StableDaySuggestion | null {
  const comfortTemp = opts.tempAvg ?? opts.tempMax ?? null
  if (comfortTemp === null) {
    return null
  }
  const prob = opts.rainProbability ?? 0
  const mm = opts.totalRainMm
  const wind = opts.windSpeed ?? 0

  if (prob >= 40 || mm >= 2 || wind >= 40) {
    return null
  }

  if (comfortTemp >= 26 && prob < 30 && mm < 1 && wind <= 30) {
    return {
      summary: 'Tempo quente e estável: ótimo dia para praia ou atividades ao ar livre.',
      action: 'Leve água, proteção solar e planeje pausas à sombra.',
    }
  }
  if (comfortTemp >= 22 && comfortTemp < 26 && prob < 35 && mm < 1.5) {
    return {
      summary: 'Clima ameno e estável: bom dia para caminhar e ficar na rua.',
      action: 'Aproveite para resolver pendências externas ou passear com mais conforto.',
    }
  }
  if (comfortTemp >= 18 && comfortTemp < 22 && prob < 40 && mm < 2) {
    return {
      summary: 'Tempo estável e mais fresco, ideal para resolver pendências na rua.',
      action: 'Leve um agasalho leve, mas não há previsão de mudanças bruscas ao longo do dia.',
    }
  }
  return {
    summary: 'Dia estável, sem alertas climáticos relevantes.',
    action: 'Use o painel como referência: se algo mudar, os alertas serão atualizados automaticamente.',
  }
}

const WEATHER_THRESHOLDS = {
  rain: {
    // chance de chuva ≥ 40% já merece monitoramento no resumo,
    // ≥ 70% passa a aparecer como alerta relevante.
    chanceMonitor: 40,
    chanceAlert: 70,

    // mm em 24h:
    // - ≥ 2 mm já indica chuva leve perceptível ao longo do dia;
    // - ≥ 10 mm caracteriza um dia chuvoso de fato.
    mmLight: 2,
    mmHeavy: 10,
  },
  wind: {
    // vento médio (km/h):
    // - ≥ 25 km/h já é vento moderado (sensível ao ar livre);
    // - ≥ 45 km/h consideramos vento forte.
    speedModerate: 25,
    speedStrong: 45,

    // rajadas (km/h):
    // - ≥ 60 km/h tratamos como rajadas fortes para fins de alerta.
    gustStrong: 60,
  },
} as const

const STORM_RAIN_WARN = WEATHER_THRESHOLDS.rain.chanceMonitor
const STORM_RAIN_HIGH = WEATHER_THRESHOLDS.rain.chanceAlert
const STORM_GUST_WARN = WEATHER_THRESHOLDS.wind.speedStrong
const STORM_GUST_HIGH = WEATHER_THRESHOLDS.wind.gustStrong

const HEAT_INDEX_OK = 27
const HEAT_INDEX_ATTENTION = 32
const RAIN_PROBABILITY_MONITOR = WEATHER_THRESHOLDS.rain.chanceMonitor
const RAIN_PROBABILITY_ALERT = WEATHER_THRESHOLDS.rain.chanceAlert
const DAILY_RAIN_WARN_MM = WEATHER_THRESHOLDS.rain.mmLight
const DAILY_RAIN_HIGH_MM = WEATHER_THRESHOLDS.rain.mmHeavy
const WIND_SPEED_MONITOR_KMH = WEATHER_THRESHOLDS.wind.speedModerate
const WIND_SPEED_HIGH_KMH = WEATHER_THRESHOLDS.wind.speedStrong
const WIND_GUST_MONITOR_KMH = WEATHER_THRESHOLDS.wind.speedModerate
const WIND_GUST_HIGH_KMH = WEATHER_THRESHOLDS.wind.gustStrong
const PRESSURE_TREND_STABLE_MAX = 1.5
const PRESSURE_TREND_ALERT_MIN = 3
const TOMORROW_OFFSET_MS = 24 * 60 * 60 * 1000
const TOMORROW_WIND_SANITY_KMH = 150
const TOMORROW_RAIN_SANITY_MM = 500
const MIN_TODAY_RAIN_SAMPLES = 3
const MIN_TODAY_WIND_SAMPLES = 3

const COLLECTOR_INTERVAL_DISPLAY_MINUTES = 10
const CHART_HISTORY_OPTIONS = [
  { value: '3h', label: '3h', hours: 3 },
  { value: '6h', label: '6h', hours: 6 },
  { value: '24h', label: '24h', hours: 24 },
] as const
type ChartHistoryValue = (typeof CHART_HISTORY_OPTIONS)[number]['value']

type LoginForm = {
  email: string
  password: string
}

type UserForm = {
  name: string
  email: string
  password: string
}

function parseMetric(value: string | number | undefined): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.')
    const parsed = Number.parseFloat(normalized)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return null
}

function computeMedian(values: number[]): number | null {
  if (!values.length) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatMetaTime(value?: string) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function findMetricValue(
  metrics: Record<string, string | number> | undefined,
  patterns: RegExp[],
): number | null {
  if (!metrics) {
    return null
  }
  const matchingKey = Object.keys(metrics).find((key) =>
    patterns.some((pattern) => pattern.test(key)),
  )
  if (!matchingKey) {
    return null
  }
  return parseMetric(metrics[matchingKey])
}

function readMetricValue(
  metrics: Record<string, string | number> | undefined,
  keys: string[],
): number | null {
  if (!metrics) {
    return null
  }
  for (const key of keys) {
    const candidate = parseMetric(metrics[key] as string | number | undefined)
    if (candidate !== null) {
      return candidate
    }
  }
  return null
}

function angleToCardinal(angle: number): string {
  const normalized = ((angle % 360) + 360) % 360
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(normalized / 45) % 8
  return directions[index]
}

function computeDominantWindDirection(values: number[]): string | undefined {
  if (!values.length) {
    return undefined
  }
  const radianValues = values.map((angle) => (angle * Math.PI) / 180)
  const sinSum = radianValues.reduce((acc, rad) => acc + Math.sin(rad), 0)
  const cosSum = radianValues.reduce((acc, rad) => acc + Math.cos(rad), 0)
  if (sinSum === 0 && cosSum === 0) {
    return undefined
  }
  const averageAngle = (Math.atan2(sinSum, cosSum) * 180) / Math.PI
  return angleToCardinal(averageAngle)
}

type WindDirKey = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

const WIND_DIRECTION_PT_LABEL: Record<WindDirKey, string> = {
  N: 'N',
  NE: 'NE',
  E: 'L',
  SE: 'SE',
  S: 'S',
  SW: 'SO',
  W: 'O',
  NW: 'NO',
}

const WIND_DIRECTION_ICON: Record<WindDirKey, LucideIcon> = {
  N: ArrowUp,
  NE: ArrowUpRight,
  E: ArrowRight,
  SE: ArrowDownRight,
  S: ArrowDown,
  SW: ArrowDownLeft,
  W: ArrowLeft,
  NW: ArrowUpLeft,
}

function normalizeWindDir(direction?: string | null): WindDirKey | null {
  if (!direction) {
    return null
  }
  const key = direction.trim().toUpperCase() as WindDirKey
  return key in WIND_DIRECTION_PT_LABEL ? key : null
}

type WindDirectionIndicatorProps = {
  direction?: string | null
  className?: string
}

function WindDirectionIndicator({ direction, className }: WindDirectionIndicatorProps) {
  const key = normalizeWindDir(direction)

  if (!key) {
    return <span className={className}>—</span>
  }

  const Icon = WIND_DIRECTION_ICON[key]
  const label = WIND_DIRECTION_PT_LABEL[key]

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

function getWindDirectionDisplay(direction?: string | null): { key?: WindDirKey; label?: string } {
  const key = normalizeWindDir(direction)
  if (!key) {
    return {}
  }
  return {
    key,
    label: WIND_DIRECTION_PT_LABEL[key],
  }
}

function getPercentile(sortedValues: number[], p: number): number {
  if (!sortedValues.length) {
    return 0
  }
  const index = (p / 100) * (sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sortedValues[lower]
  }
  const ratio = index - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * ratio
}

function percentileScore(value: number, pLow: number, pHigh: number): number {
  if (pHigh <= pLow) {
    return 0
  }
  if (value <= pLow) {
    return 0
  }
  if (value >= pHigh) {
    return 1
  }
  return (value - pLow) / (pHigh - pLow)
}

const DASHBOARD_TIMEZONE = 'America/Sao_Paulo'
const localDayFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getLocalDayFormatter(timeZone: string) {
  const existing = localDayFormatterCache.get(timeZone)
  if (existing) {
    return existing
  }
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  localDayFormatterCache.set(timeZone, formatter)
  return formatter
}

function formatLocalDayKey(value: string | Date | undefined, timeZone: string) {
  if (!value) {
    return null
  }
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return getLocalDayFormatter(timeZone).format(date)
}

function isSameLocalDay(a: string | Date | undefined, b: string | Date | undefined, timeZone: string) {
  const first = formatLocalDayKey(a, timeZone)
  const second = formatLocalDayKey(b, timeZone)
  return first !== null && second !== null && first === second
}

const DEBUG_LOGS = false

function parseTimestampMs(value?: string) {
  if (!value) {
    return null
  }
  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

function getEffectiveLogs(logs: WeatherLog[]) {
  const nowMs = Date.now()
  const withParsedTs = logs
    .map((log) => ({
      ...log,
      __ts: parseTimestampMs(log.timestamp),
    }))
    .filter(
      (log): log is WeatherLog & { __ts: number } =>
        typeof log.__ts === 'number' && !Number.isNaN(log.__ts),
    )
  const pastOrPresent = withParsedTs.filter((log) => log.__ts <= nowMs)
  pastOrPresent.sort((a, b) => a.__ts - b.__ts)
  return pastOrPresent.map((log) => {
    const copy = { ...log }
    delete (copy as WeatherLog & { __ts?: number }).__ts
    return copy as WeatherLog
  })
}

const HAZARD_PRIORITY: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
}

function buildRainHazard(todayRainStats: TodayRainStats, context?: HazardContext): HazardAlert | null {
  const { rain } = WEATHER_THRESHOLDS
  const probability = todayRainStats.rainProbability
  const totalRainMm = todayRainStats.totalRainMm ?? 0
  const sawRain = totalRainMm >= rain.mmLight || todayRainStats.rainySlots > 0

  const isSparse = context?.isDataSparse ?? !todayRainStats.hasSufficientSamples
  const usingFallback = Boolean(context?.fallbackSourceLabel)
  const noDataAvailable =
    isSparse && !usingFallback && probability === null && totalRainMm === 0 && !todayRainStats.hasRainEvents

  if (noDataAvailable) {
    return {
      kind: 'rain',
      level: 'low',
      label: 'Dados insuficientes sobre chuva',
      summary: 'Ainda não há leituras suficientes de chuva para estimar o risco de hoje.',
      advice: 'Aguarde novos logs do pipeline ou use a previsão como referência temporária.',
      metrics: {
        rainProbability: null,
        rainTotalMm: null,
        rainySlots: todayRainStats.rainySlots,
      },
    }
  }

  if (probability === null && !sawRain) {
    return null
  }

  let level: RiskLevel | null = null
  if (
    totalRainMm >= rain.mmHeavy ||
    ((probability ?? 0) >= rain.chanceAlert && totalRainMm >= rain.mmLight)
  ) {
    level = 'high'
  } else if (
    (probability ?? 0) >= rain.chanceMonitor &&
    (totalRainMm >= rain.mmLight || sawRain)
  ) {
    level = 'moderate'
  } else if ((probability ?? 0) >= rain.chanceMonitor) {
    level = 'low'
  }

  if (!level) {
    return null
  }

  const safeProbability = probability ?? 0
  const label =
    level === 'high'
      ? 'Chuva forte provável'
      : level === 'moderate'
      ? 'Chuva leve/moderada possível'
      : 'Chance de chuva isolada'
  const severityDescriptor =
    level === 'high' ? 'chuva forte' : level === 'moderate' ? 'chuva moderada' : 'chance isolada de chuva'
  const dataSourceIntro = usingFallback
    ? `Com base na ${context?.fallbackSourceLabel ?? 'fonte mais recente'},`
    : 'Leituras de hoje indicam'
  const summary =
    level === 'high'
      ? `${dataSourceIntro} ${severityDescriptor} ao longo do dia (aprox. ${Math.round(safeProbability)}% e ${totalRainMm.toFixed(1)} mm).`
      : level === 'moderate'
      ? `${dataSourceIntro} ${severityDescriptor} ao longo do dia (cerca de ${Math.round(safeProbability)}%).`
      : `${dataSourceIntro} ${severityDescriptor} (cerca de ${Math.round(safeProbability)}%).`
  const advice =
    level === 'high'
      ? 'Planeje atividades com cobertura e considere rotas alternativas.'
      : level === 'moderate'
      ? 'Leve capa ou guarda-chuva para deslocamentos.'
      : 'Acompanhe o painel; leve uma capa leve se for ficar na rua.'

  return {
    kind: 'rain',
    level,
    label,
    summary,
    advice,
    metrics: {
      rainProbability: safeProbability,
      rainTotalMm: totalRainMm,
      rainySlots: todayRainStats.rainySlots,
    },
  }
}

function buildWindHazard(todayWindStats: TodayWindStats, context?: HazardContext): HazardAlert | null {
  const { wind } = WEATHER_THRESHOLDS
  const sustained =
    todayWindStats.maxWindSpeed ??
    todayWindStats.displayWindSpeed ??
    todayWindStats.medianSpeed ??
    null
  const gust = todayWindStats.maxWindGust ?? todayWindStats.currentWindGust ?? null

  const isSparse = context?.isDataSparse ?? !todayWindStats.hasSufficientSamples
  const usingFallback = Boolean(context?.fallbackSourceLabel)
  if (sustained === null && gust === null) {
    if (isSparse && !usingFallback) {
      return {
        kind: 'wind',
        level: 'low',
        label: 'Dados insuficientes sobre vento',
        summary: 'Ainda não há leituras confiáveis de vento para o dia.',
        advice: 'Assim que os sensores informarem vento, este painel será atualizado automaticamente.',
        metrics: {
          maxWindKmh: null,
          maxGustKmh: null,
        },
      }
    }
    return null
  }

  let level: RiskLevel | null = null
  if (
    (gust !== null && gust >= wind.gustStrong) ||
    (sustained !== null && sustained >= wind.speedStrong)
  ) {
    level = 'high'
  } else if (sustained !== null && sustained >= wind.speedModerate) {
    level = 'moderate'
  } else {
    level = 'low'
  }

  if (!level) {
    return null
  }

  const displayValue = gust ?? sustained ?? 0
  const gustText = `${Math.round(displayValue)} km/h`
  const label =
    level === 'high'
      ? 'Ventos fortes'
      : level === 'moderate'
      ? 'Vento moderado'
      : 'Brisa leve'
  const severityDescriptor =
    level === 'high' ? 'ventos fortes' : level === 'moderate' ? 'ventos moderados' : 'vento leve'
  const dataSourceIntro = usingFallback
    ? `Com base na ${context?.fallbackSourceLabel ?? 'fonte mais recente'},`
    : 'Leituras de hoje indicam'
  const summary =
    level === 'low'
      ? `${dataSourceIntro} ${severityDescriptor}.`
      : `${dataSourceIntro} ${severityDescriptor}, com rajadas por volta de ${gustText}.`
  const advice =
    level === 'high'
      ? 'Fixe objetos soltos e evite áreas muito expostas.'
      : level === 'moderate'
      ? 'Revise estruturas leves antes de atividades externas.'
      : 'Sem restrições especiais relacionadas ao vento.'

  return {
    kind: 'wind',
    level,
    label,
    summary,
    advice,
    metrics: {
      maxWindKmh: sustained,
      maxGustKmh: gust,
    },
  }
}

function buildDailyAlertSummary(params: {
  todayRainStats: TodayRainStats | null
  todayWindStats: TodayWindStats | null
  todayTemperatureStats: TodayTemperatureStats | null
  rainContext: StatsContext<TodayRainStats>
  windContext: StatsContext<TodayWindStats>
}): DailyAlertSummary {
  const hazards: HazardAlert[] = []
  if (params.rainContext.hasCoverage && params.rainContext.stats) {
    const rainHazard = buildRainHazard(params.rainContext.stats, {
      isDataSparse: params.rainContext.isDataSparse,
      fallbackSourceLabel: params.rainContext.isFallback
        ? params.rainContext.fallbackSourceLabel
        : null,
    })
    if (rainHazard) {
      hazards.push(rainHazard)
    }
  }
  if (params.windContext.hasCoverage && params.windContext.stats) {
    const windHazard = buildWindHazard(params.windContext.stats, {
      isDataSparse: params.windContext.isDataSparse,
      fallbackSourceLabel: params.windContext.isFallback
        ? params.windContext.fallbackSourceLabel
        : null,
    })
    if (windHazard) {
      hazards.push(windHazard)
    }
  }

  hazards.sort((a, b) => HAZARD_PRIORITY[b.level] - HAZARD_PRIORITY[a.level])

  const hasRain = hazards.some((hazard) => hazard.kind === 'rain')
  const hasWind = hazards.some((hazard) => hazard.kind === 'wind')
  const lackingRainData = !params.rainContext.hasCoverage
  const lackingWindData = !params.windContext.hasCoverage
  const lacksCoverage = lackingRainData && lackingWindData

  const primaryHazard =
    hazards.reduce<HazardAlert | null>((current, hazard) => {
      if (current === null) {
        return hazard
      }
      const currentPriority = HAZARD_PRIORITY[current.level]
      const nextPriority = HAZARD_PRIORITY[hazard.level]
      if (nextPriority > currentPriority) {
        return hazard
      }
      if (nextPriority === currentPriority && current.kind === 'wind' && hazard.kind === 'rain') {
        return hazard
      }
      return current
    }, null)

  const level: RiskLevel =
    hazards.length === 0
      ? 'none'
      : hazards.reduce(
          (current, hazard) =>
            HAZARD_PRIORITY[hazard.level] > HAZARD_PRIORITY[current] ? hazard.level : current,
          'low' as RiskLevel,
        )

  if (hazards.length === 0) {
    if (lacksCoverage) {
      return {
        level: 'none',
        badgeText: 'Dados insuficientes hoje',
        hazards: [],
        primaryHazard: null,
        hasRain: false,
        hasWind: false,
        shortSummary: 'Sem dados suficientes de chuva e vento para avaliar o dia de hoje.',
        shortAction: 'Assim que novas leituras chegarem, este painel será atualizado automaticamente.',
      }
    }
    if (lackingRainData && !lackingWindData) {
      return {
        level: 'none',
        badgeText: 'Chuva: dados insuficientes',
        hazards: [],
        primaryHazard: null,
        hasRain: false,
        hasWind: false,
        shortSummary: 'Sem dados suficientes de chuva para avaliar o risco hoje.',
        shortAction: 'Este indicador será atualizado assim que novas leituras de chuva estiverem disponíveis.',
      }
    }
    if (lackingWindData && !lackingRainData) {
      return {
        level: 'none',
        badgeText: 'Vento: dados insuficientes',
        hazards: [],
        primaryHazard: null,
        hasRain: false,
        hasWind: false,
        shortSummary: 'Sem dados suficientes de vento para avaliar o risco hoje.',
        shortAction: 'Este indicador será atualizado assim que novas leituras de vento estiverem disponíveis.',
      }
    }
  }

  let badgeText: string | null = 'Estado estável'
  if (level === 'high') {
    if (hasRain && hasWind) {
      badgeText = 'Risco alto de chuva e vento'
    } else if (hasRain) {
      badgeText = 'Risco alto de chuva'
    } else if (hasWind) {
      badgeText = 'Risco alto de ventos fortes'
    } else {
      badgeText = 'Risco alto'
    }
  } else if (level === 'moderate') {
    if (hasRain && hasWind) {
      badgeText = 'Risco moderado de chuva e vento'
    } else if (hasRain) {
      badgeText = 'Risco moderado de chuva'
    } else if (hasWind) {
      badgeText = 'Risco moderado de vento'
    } else {
      badgeText = 'Risco moderado'
    }
  } else if (level === 'low') {
    if (hasWind) {
      badgeText = 'Risco leve de vento'
    } else if (hasRain) {
      badgeText = 'Risco leve de chuva'
    } else {
      badgeText = 'Risco baixo'
    }
  }

  let shortSummary: string | null = null
  let shortAction: string | null = null
  if (primaryHazard) {
    shortSummary = primaryHazard.summary
    shortAction = primaryHazard.advice
  } else if (level === 'none') {
    const stableSuggestion = buildStableDaySuggestion({
      tempAvg: params.todayTemperatureStats?.average ?? null,
      tempMax: params.todayTemperatureStats?.max ?? null,
      rainProbability: params.todayRainStats?.rainProbability ?? null,
      totalRainMm: params.todayRainStats?.totalRainMm ?? 0,
      windSpeed: params.todayWindStats?.displayWindSpeed ?? null,
    })
    if (stableSuggestion) {
      shortSummary = stableSuggestion.summary
      shortAction = stableSuggestion.action
    } else {
      shortSummary = 'Dia estável, sem alertas climáticos relevantes.'
      shortAction = null
    }
    badgeText = 'Estado estável'
  } else if (hasRain && hasWind) {
    shortSummary = 'Risco combinado de chuva e vento em alguns períodos do dia.'
    shortAction = 'Revise cronograma externo e defina planos de abrigo rápidos.'
  }

  return {
    level,
    badgeText,
    hazards,
    primaryHazard,
    hasRain,
    hasWind,
    shortSummary,
    shortAction,
  }
}

const RAIN_PROBABILITY_KEYS = ['rain_chance', 'precipitation_probability']
const RAIN_MM_KEYS = ['rain_mm', 'rain', 'rain_sum', 'precipitation', 'precipitation_sum']
const RAIN_RECENT_WINDOW_MS = 3 * 60 * 60 * 1000
const RAIN_ANIM_HIGH_PROB = WEATHER_THRESHOLDS.rain.chanceAlert // usa o mesmo corte do alerta principal
const RAIN_ANIM_LOW_PROB = WEATHER_THRESHOLDS.rain.chanceMonitor // faixa de monitoramento = animação suave
const RAIN_ANIM_MIN_INTENSITY_MM = WEATHER_THRESHOLDS.rain.mmLight // chuva mínima relevante
const RAIN_ANIM_RECENT_MM = WEATHER_THRESHOLDS.rain.mmLight * 2 // dobra o mínimo para considerar acumulado recente
const WIND_DIRECTION_PATTERNS = [/wind[_-]?dir/i, /wind[_-]?direction/i]
const WIND_SPEED_10M_KEYS = ['wind_speed', 'wind_speed_10m']
const WIND_GUST_KEYS = ['wind_gust', 'wind_gusts', 'wind_gusts_10m']
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000
const MIN_WIND_KMH = 0 // piso mínimo para qualquer leitura de vento exibida
const MAX_WIND_SPEED_KMH = 80 // máximo plausível de vento sustentado a 10 m
const MAX_WIND_GUST_KMH = 120 // limite físico para rajadas (filtragem agressiva)
const SOFT_MAX_GUST_KMH = 70 // teto "perceptivo" usado para discretizar rajadas
const MIN_DISPLAY_GUST_KMH = 20 // abaixo disso não mostramos rajada no card
const MAX_SINGLE_RAIN_MM = 200
const MAX_DAILY_RAIN_MM = 500
const DEW_POINT_PATTERN = /dew[_-]?point(?:[_-]?\d+m)?/i
const MIN_DEWPOINT_SAMPLES = 3

type TodayRainStats = {
  totalSlots: number
  rainySlots: number
  totalRainMm: number
  totalRainMmLast3h: number | null
  rainProbability: number | null
  rainProbabilityCount: number
  hasRainEvents: boolean
  hasSufficientSamples: boolean
}

type TodayWindStats = {
  currentWindSpeed: number | null
  currentWindGust: number | null
  maxWindSpeed: number | null
  maxWindGust: number | null
  dominantDirection: string | null
  gustsValidCount: number
  medianSpeed: number | null
  displayWindSpeed: number | null
  medianRecentSpeed: number | null
  recentSpeedsCount: number
  hasSufficientSamples: boolean
}

type TodayTemperatureStats = {
  min: number | null
  max: number | null
  amplitude: number | null
  average: number | null
  count: number
}

type TodayDewPointStats = {
  average: number | null
  min: number | null
  count: number
}

type StatsContext<T> = {
  stats: T | null
  hasCoverage: boolean
  isFallback: boolean
  fallbackSourceLabel: string | null
  isDataSparse: boolean
}

type HazardContext = {
  isDataSparse?: boolean
  fallbackSourceLabel?: string | null
}

function createRainFallbackStats(
  probability?: number | null,
  totalMm?: number | null,
): TodayRainStats | null {
  const safeProbability =
    typeof probability === 'number' && Number.isFinite(probability)
      ? Math.max(0, Math.min(100, probability))
      : null
  const safeTotal =
    typeof totalMm === 'number' && Number.isFinite(totalMm)
      ? Math.min(Math.max(totalMm, 0), MAX_DAILY_RAIN_MM)
      : null
  if (safeProbability === null && safeTotal === null) {
    return null
  }
  const normalizedTotal = safeTotal ?? 0
  return {
    totalSlots: 0,
    rainySlots: normalizedTotal >= 0.1 ? 1 : 0,
    totalRainMm: normalizedTotal,
    totalRainMmLast3h: null,
    rainProbability: safeProbability,
    rainProbabilityCount: 0,
    hasRainEvents: normalizedTotal > 0,
    hasSufficientSamples: false,
  }
}

function createWindFallbackStats(
  speed?: number | null,
  gust?: number | null,
  direction?: string | null,
): TodayWindStats | null {
  const safeSpeed =
    typeof speed === 'number' && Number.isFinite(speed)
      ? Math.min(Math.max(speed, MIN_WIND_KMH), MAX_WIND_SPEED_KMH)
      : null
  const safeGust =
    typeof gust === 'number' && Number.isFinite(gust)
      ? Math.min(Math.max(gust, MIN_WIND_KMH), MAX_WIND_GUST_KMH)
      : null
  if (safeSpeed === null && safeGust === null) {
    return null
  }
  const fallbackSpeed =
    safeSpeed ?? (safeGust !== null ? Math.min(safeGust, MAX_WIND_SPEED_KMH) : null)
  return {
    currentWindSpeed: fallbackSpeed,
    currentWindGust: safeGust,
    maxWindSpeed: fallbackSpeed,
    maxWindGust: safeGust,
    dominantDirection: direction ?? null,
    gustsValidCount: safeGust !== null ? MIN_TODAY_WIND_SAMPLES : 0,
    medianSpeed: fallbackSpeed,
    displayWindSpeed: fallbackSpeed,
    medianRecentSpeed: fallbackSpeed,
    recentSpeedsCount: fallbackSpeed !== null ? MIN_TODAY_WIND_SAMPLES : 0,
    hasSufficientSamples: false,
  }
}

const EMPTY_TODAY_WIND_STATS: TodayWindStats = {
  currentWindSpeed: null,
  currentWindGust: null,
  maxWindSpeed: null,
  maxWindGust: null,
  dominantDirection: null,
  gustsValidCount: 0,
  medianSpeed: null,
  displayWindSpeed: null,
  medianRecentSpeed: null,
  recentSpeedsCount: 0,
  hasSufficientSamples: false,
}

function describeTodayRainStatus(stats: TodayRainStats) {
  const { totalSlots, rainySlots, totalRainMm, rainProbability } = stats
  if (!totalSlots) {
    return 'Sem dados de chuva para hoje.'
  }
  if (totalRainMm > 0) {
    return 'Chuva registrada hoje.'
  }
  if (rainProbability !== null && rainProbability > 0) {
    return 'Chance de chuva observada hoje.'
  }
  if (rainySlots === 0) {
    return 'Dia seco até agora.'
  }
  return 'Monitorar chuva hoje.'
}

const SPARKLINE_VIEW_WIDTH = 100
const SPARKLINE_HEIGHT = 56
const MAX_SPARKLINE_POINTS = 72
const MAX_HISTORY_PAGES = 5
const MIN_HISTORY_POINTS = 48
const MAX_CHART_POINTS = 360
const HISTORICAL_DAYS_WINDOW = 30
const HISTORICAL_WINDOW_MS = HISTORICAL_DAYS_WINDOW * 24 * 60 * 60 * 1000
const SPARKLINE_SMOOTH_PASSES = 5
const SPARKLINE_TENSION = 0.5
const SPARKLINE_VERTICAL_PADDING = 0.08

type SparklinePoint = {
  timestamp: number
  temperature: number
}

type SparklineData = {
  pathD: string
  stops: { offset: number; color: string }[]
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')
  const bigint = parseInt(normalized, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  const toHex = (value: number) => {
    const clipped = Math.max(0, Math.min(255, Math.round(value)))
    const withPadding = clipped.toString(16).padStart(2, '0')
    return withPadding
  }
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

function interpolateColor(start: string, end: string, factor: number) {
  const startRgb = hexToRgb(start)
  const endRgb = hexToRgb(end)
  return rgbToHex({
    r: startRgb.r + (endRgb.r - startRgb.r) * factor,
    g: startRgb.g + (endRgb.g - startRgb.g) * factor,
    b: startRgb.b + (endRgb.b - startRgb.b) * factor,
  })
}

function tempToColor(temp: number, isDark: boolean) {
  const cold = isDark ? '#93c5fd' : '#3b82f6'
  const warm = isDark ? '#fde047' : '#facc15'
  const hot = isDark ? '#fb7185' : '#ef4444'
  const COOL_MAX = 19
  const WARM_MIN = 25
  if (temp <= COOL_MAX) {
    return cold
  }
  if (temp < WARM_MIN) {
    const ratio = Math.min(
      1,
      Math.max(0, (temp - COOL_MAX) / (WARM_MIN - COOL_MAX)),
    )
    return interpolateColor(cold, warm, ratio)
  }
  return hot
}

function downsampleSparklinePoints(points: SparklinePoint[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points
  }
  const step = Math.ceil(points.length / maxPoints)
  const sampled: SparklinePoint[] = []
  for (let index = 0; index < points.length; index += step) {
    sampled.push(points[index])
  }
  const last = points[points.length - 1]
  const lastSample = sampled[sampled.length - 1]
  if (last && lastSample && last.timestamp !== lastSample.timestamp) {
    sampled.push(last)
  }
  return sampled
}

function downsampleChartPoints<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points
  }
  const step = Math.ceil(points.length / maxPoints)
  const sampled: T[] = []
  for (let index = 0; index < points.length; index += step) {
    sampled.push(points[index])
  }
  const last = points[points.length - 1]
  const lastSample = sampled[sampled.length - 1]
  if (last && lastSample && last !== lastSample) {
    sampled.push(last)
  }
  return sampled
}

function mergeNearbyPoints(
  seriesId: MetricSeriesId,
  points: Array<ChartPoint>,
  window: ChartHistoryValue,
): Array<ChartPoint> {
  if (window === '3h' || window === '6h') {
    return points
  }
  if (!points.length) {
    return points
  }
  const MIN_POINTS_TO_MERGE = 120
  if (points.length < MIN_POINTS_TO_MERGE) {
    return points
  }

  const eps = MERGE_EPS_BY_SERIES[seriesId] ?? 0.3
  const deltaMap: Record<ChartHistoryValue, number> = {
    '3h': 0,
    '6h': 0,
    '24h': 30 * 60 * 1000,
  }
  const maxDeltaMs =
    deltaMap[window] ?? 0
  const sorted = [...points].sort((a, b) => {
    const aTime = a.timestamp ? new Date(a.timestamp).getTime() : Number(a.x)
    const bTime = b.timestamp ? new Date(b.timestamp).getTime() : Number(b.x)
    return aTime - bTime
  })
  const merged: ChartPoint[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const last = merged[merged.length - 1]
    if (last.y == null || current.y == null) {
      merged.push(current)
      continue
    }
    const diff = Math.abs(Number(current.y) - Number(last.y))
    const lastTime = last.timestamp ? new Date(last.timestamp).getTime() : Number(last.x)
    const currentTime = current.timestamp ? new Date(current.timestamp).getTime() : Number(current.x)
    const delta = currentTime - lastTime
    if (diff <= eps && delta <= maxDeltaMs) {
      const averagedY = (Number(last.y) + Number(current.y)) / 2
      merged[merged.length - 1] = {
        ...current,
        y: averagedY,
      }
    } else {
      merged.push(current)
    }
  }
  return merged
}

function smoothSparklinePoints(points: SparklinePoint[], passes = 1) {
  if (points.length <= 2 || passes <= 0) {
    return points
  }
  let current = points.map((point) => ({ ...point }))
  for (let pass = 0; pass < passes; pass++) {
    current = current.map((point, index, arr) => {
      if (index === 0 || index === arr.length - 1) {
        return point
      }
      const prev = arr[index - 1]
      const next = arr[index + 1]
      return {
        ...point,
        temperature: (prev.temperature + point.temperature + next.temperature) / 3,
      }
    })
  }
  return current
}

function buildSmoothPath(coordinates: { x: number; y: number }[], tension = 0.4) {
  if (coordinates.length === 0) {
    return ''
  }
  if (coordinates.length === 1) {
    return `M${coordinates[0].x},${coordinates[0].y}`
  }
  const pathSegments: string[] = []
  const len = coordinates.length
  pathSegments.push(`M${coordinates[0].x},${coordinates[0].y}`)
  for (let i = 0; i < len - 1; i += 1) {
    const p0 = coordinates[Math.max(i - 1, 0)]
    const p1 = coordinates[i]
    const p2 = coordinates[i + 1]
    const p3 = coordinates[Math.min(i + 2, len - 1)]
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6
    pathSegments.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`)
  }
  return pathSegments.join(' ')
}

function densifySparklinePoints(points: SparklinePoint[], targetCount: number) {
  if (points.length === 0) {
    return points
  }
  const filled = [...points]
  while (filled.length < targetCount) {
    if (filled.length === 1) {
      const onlyPoint = filled[0]
      filled.push({
        timestamp: onlyPoint.timestamp + 1,
        temperature: onlyPoint.temperature,
      })
      continue
    }
    let insertIndex = 0
    let maxGap = 0
    for (let i = 0; i < filled.length - 1; i += 1) {
      const gap = filled[i + 1].timestamp - filled[i].timestamp
      if (gap > maxGap) {
        maxGap = gap
        insertIndex = i
      }
    }
    if (maxGap <= 0) {
      const last = filled[filled.length - 1]
      filled.push({
        timestamp: last.timestamp + 1,
        temperature: last.temperature,
      })
      continue
    }
    const first = filled[insertIndex]
    const second = filled[insertIndex + 1]
    filled.splice(insertIndex + 1, 0, {
      timestamp: first.timestamp + maxGap / 2,
      temperature: (first.temperature + second.temperature) / 2,
    })
  }
  return filled
}

type WeatherAnimationSelection = {
  isDaytime: boolean
  cloudCover: number | null
  hasRain: boolean
}

const WEATHER_ANIMATIONS = {
  day: {
    broken: weatherDayBroken,
    few: weatherDayFew,
    rain: weatherDayRain,
  },
  night: {
    clear: weatherNightClear,
    shower: weatherNightShowers,
  },
} as const

function parseMetaTime(reference: Date, value?: string) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }
  const [hoursPart, minutesPart] = value.split(':')
  const hours = Number(hoursPart)
  const minutes = Number(minutesPart)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }
  const normalized = new Date(reference)
  normalized.setHours(hours, minutes, 0, 0)
  return normalized
}

function determineDaytime(reference: Date, sunrise?: string, sunset?: string) {
  const sunriseTime = parseMetaTime(reference, sunrise)
  const sunsetTime = parseMetaTime(reference, sunset)
  if (sunriseTime && sunsetTime) {
    return reference >= sunriseTime && reference <= sunsetTime
  }
  const hour = reference.getHours()
  return hour >= 6 && hour < 20
}

function pickWeatherAnimation(options: WeatherAnimationSelection) {
  if (options.isDaytime) {
    if (options.hasRain) {
      return WEATHER_ANIMATIONS.day.rain
    }
    if (options.cloudCover !== null && options.cloudCover >= 60) {
      return WEATHER_ANIMATIONS.day.broken
    }
    return WEATHER_ANIMATIONS.day.few
  }
  return options.hasRain ? WEATHER_ANIMATIONS.night.shower : WEATHER_ANIMATIONS.night.clear
}

type ChartDataPoint = {
  time: string
  temperature: number | null
  humidity: number | null
  wind: number | null
  timestamp: string
  dateTimeLabel: string
  timestampMs: number
  localDate: string
  dateLabel: string
  timeLabel: string
}

type ChartPoint = {
  x: string | number
  y: number | null
  timestamp?: string
}

type ChartSeriesDatum = {
  x: string
  y: number
  timestamp: string
}

type MetricSeriesId = 'temperature' | 'humidity' | 'wind'

const metricSeriesConfig = [
  { id: 'Temperatura', key: 'temperature', color: '#EF4444' },
  { id: 'Umidade', key: 'humidity', color: '#38BDF8' },
  { id: 'Vento', key: 'wind', color: '#22C55E' },
] as const

const MERGE_EPS_BY_SERIES: Record<MetricSeriesId, number> = {
  temperature: 0.3,
  humidity: 2,
  wind: 1,
}

type ChartTooltipProps = PointTooltipProps<LineSeries> & {
  isDark: boolean
  dataPoint?: ChartDataPoint | null
}

function getTemperatureColor(isDark: boolean) {
  return isDark ? '#EF4444' : '#EF4444'
}

function getHumidityColor(isDark: boolean) {
  return isDark ? '#38BDF8' : '#38BDF8'
}

function getWindColor(isDark: boolean) {
  return isDark ? '#22C55E' : '#22C55E'
}

function getMetricColor(metricId: string, isDark: boolean) {
  switch (metricId) {
    case 'Temperatura':
      return getTemperatureColor(isDark)
    case 'Umidade':
      return getHumidityColor(isDark)
    case 'Vento':
      return getWindColor(isDark)
    default:
      return getTemperatureColor(isDark)
  }
}

function ChartTooltip({ point, isDark, dataPoint }: ChartTooltipProps) {
  if (!point) {
    return null
  }
  const timestampValue = dataPoint?.timestamp ?? (point.data as { timestamp?: string }).timestamp
  const dateLabel = timestampValue
    ? new Date(timestampValue).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—'
  const timeLabel = timestampValue
    ? new Date(timestampValue).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : String(point.data.x ?? '—')
  const headerLeft = dateLabel
  const headerRight = timeLabel

  const containerClasses = cn(
    'rounded-xl px-3 py-2 text-xs leading-snug',
    getChartTooltipSurfaceClasses(isDark),
  )

  const formatValue = (value: number, key: string) => {
    if (key === 'humidity' || key === 'wind') {
      return Math.round(value).toString()
    }
    return value.toFixed(1)
  }

  const units = (metricId: string) =>
    metricId === 'Temperatura' ? '°C' : metricId === 'Umidade' ? '%' : ' km/h'

  type TooltipMetric = {
    id: string
    value: number
    color: string
  }

  const metricLines: TooltipMetric[] = metricSeriesConfig
    .map((metric) => {
      const value = dataPoint?.[metric.key as keyof ChartDataPoint]
      if (value === undefined || value === null) {
        return null
      }
      return {
        id: metric.id,
        value,
        color: getMetricColor(metric.id, isDark),
      }
    })
    .filter(Boolean) as TooltipMetric[]

  if (!metricLines.length) {
    const fallbackMetric = metricSeriesConfig.find((metric) => metric.id === point.seriesId)
    const fallbackValue = typeof point.data.y === 'number' ? point.data.y : undefined
    if (fallbackMetric && fallbackValue !== undefined) {
      metricLines.push({
        id: fallbackMetric.id,
        value: fallbackValue,
        color: fallbackMetric.color,
      })
    }
  }

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between gap-3 text-[11px] font-medium tabular-nums opacity-80">
        <span>{headerLeft}</span>
        <span>{headerRight}</span>
      </div>
      <div className="mt-2 space-y-1">
        {metricLines.map((metric) => (
          <div key={metric.id} className="flex items-center justify-between gap-3 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: metric.color }} />
              <span className="font-medium">{metric.id}</span>
            </div>
            <span className="font-semibold tabular-nums" style={{ color: metric.color }}>
              {formatValue(metric.value, metric.id.toLowerCase())}
              {units(metric.id)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
function getChartTooltipSurfaceClasses(isDark: boolean) {
  return isDark
    ? 'bg-zinc-900/85 border border-zinc-700 text-slate-50 shadow-lg shadow-black/40'
    : 'bg-white/85 border border-slate-200 text-slate-900 shadow-lg shadow-slate-300/60'
}

type PeriodId = 0 | 1 | 2 | 3

type PeriodLabel = 'Madrugada' | 'Manhã' | 'Tarde' | 'Noite'

type HistoricalBucket = {
  date: string
  periodId: PeriodId
  periodLabel: PeriodLabel
  minTemp: number | null
  maxTemp: number | null
  tempAmp: number | null
  rainSum: number | null
  maxWind: number | null
  maxGust: number | null
}

type DominantLabel = 'chuva' | 'vento' | 'temperatura' | 'estavel'

type CalendarBucket = {
  date: string
  periodId: PeriodId
  periodLabel: PeriodLabel
  dominantLabel: DominantLabel
  intensity: number
  minTemp: number | null
  maxTemp: number | null
  tempAmp: number | null
  rainSum: number | null
  maxWind: number | null
  maxGust: number | null
  tempScore?: number
  windScore?: number
  rainScore?: number
}

const PERIOD_LABELS: Record<PeriodId, PeriodLabel> = {
  0: 'Madrugada',
  1: 'Manhã',
  2: 'Tarde',
  3: 'Noite',
}
const PERIOD_IDS: PeriodId[] = [0, 1, 2, 3] as const

// Vento (km/h) - vento efetivo baseado em maxWind + maxGust
const HEATMAP_WIND_GUST_OFFSET_KMH = 5
const HEATMAP_SANITY_MAX_WIND_KMH = 120
const HEATMAP_SANITY_MAX_GUST_KMH = 180

const HEATMAP_SANITY_MAX_BUCKET_RAIN_MM = 150

// Chuva diária para o heatmap histórico (impacta buckets/cores)
const HEATMAP_RAINY_DAY_THRESHOLD_MM = WEATHER_THRESHOLDS.rain.mmLight
// Chuva diária significativa usada apenas no texto "Choveu em N de X dias"
const RAINY_DAY_TEXT_THRESHOLD_MM = WEATHER_THRESHOLDS.rain.mmHeavy

// Threshold de estabilidade: abaixo disso o bucket é "estável" (cinza)
const HEATMAP_STABLE_THRESHOLD = 0.15

type HeatmapLevel = 'none' | 'low' | 'moderate' | 'strong'

function levelToScore(level: HeatmapLevel): number {
  switch (level) {
    case 'strong':
      return 1
    case 'moderate':
      return 0.66
    case 'low':
      return 0.33
    default:
      return 0
  }
}

function getRainHeatmapLevel(totalRainMm: number): HeatmapLevel {
  const { rain } = WEATHER_THRESHOLDS
  if (totalRainMm >= rain.mmHeavy) {
    return 'strong'
  }
  if (totalRainMm >= rain.mmLight) {
    return 'moderate'
  }
  if (totalRainMm > 0) {
    return 'low'
  }
  return 'none'
}

function getWindHeatmapLevel(effectiveWind: number, gust: number): HeatmapLevel {
  const { wind } = WEATHER_THRESHOLDS
  if (gust >= wind.gustStrong || effectiveWind >= wind.speedStrong) {
    return 'strong'
  }
  if (effectiveWind >= wind.speedModerate) {
    return 'moderate'
  }
  if (effectiveWind > 0) {
    return 'low'
  }
  return 'none'
}

function getPeriodId(date: Date): PeriodId {
  const hour = date.getHours()
  if (hour < 6) {
    return 0
  }
  if (hour < 12) {
    return 1
  }
  if (hour < 18) {
    return 2
  }
  return 3
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildHistoricalBucketsFromLogs(logs: WeatherLog[]): HistoricalBucket[] {
  // Apenas o heatmap histórico e o texto "Choveu em N de X dias" usam maxWind/maxGust/rainSum; cards e gráficos permanecem baseados em latest/today/aggregated metrics.
  if (!logs.length) {
    return []
  }
  const bucketMap = new Map<string, HistoricalBucket>()
  const dateSet = new Set<string>()

  logs.forEach((log) => {
    const timestamp = log.timestamp ?? ''
    const parsed = new Date(timestamp)
    if (Number.isNaN(parsed.getTime())) {
      return
    }
    const dateKey = formatLocalDateKey(parsed)
    dateSet.add(dateKey)
    const periodId = getPeriodId(parsed)
    const key = `${dateKey}-${periodId}`
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        date: dateKey,
        periodId,
        periodLabel: PERIOD_LABELS[periodId],
        minTemp: null,
        maxTemp: null,
        tempAmp: null,
        rainSum: null,
        maxWind: null,
        maxGust: null,
      })
    }
    const bucket = bucketMap.get(key)!
    const temperature = readMetricValue(log.metrics, ['temperature', 'temperature_2m'])
    if (temperature !== null) {
      bucket.minTemp = bucket.minTemp === null ? temperature : Math.min(bucket.minTemp, temperature)
      bucket.maxTemp = bucket.maxTemp === null ? temperature : Math.max(bucket.maxTemp, temperature)
    }
    const rainValue = readMetricValue(log.metrics, RAIN_MM_KEYS)
    if (rainValue !== null && rainValue <= HEATMAP_SANITY_MAX_BUCKET_RAIN_MM) {
      bucket.rainSum = (bucket.rainSum ?? 0) + Math.max(rainValue, 0)
    }
    const windValue = readMetricValue(log.metrics, WIND_SPEED_10M_KEYS)
    if (windValue !== null && windValue <= HEATMAP_SANITY_MAX_WIND_KMH) {
      bucket.maxWind = bucket.maxWind === null ? windValue : Math.max(bucket.maxWind, windValue)
    }
    const gustValue = readMetricValue(log.metrics, WIND_GUST_KEYS)
    if (gustValue !== null && gustValue <= HEATMAP_SANITY_MAX_GUST_KMH) {
      bucket.maxGust = bucket.maxGust === null ? gustValue : Math.max(bucket.maxGust, gustValue)
    }
  })

  return Array.from(dateSet)
    .sort()
    .flatMap((date) =>
      PERIOD_IDS.map((periodId) => {
        const key = `${date}-${periodId}`
        const existing = bucketMap.get(key)
        if (!existing) {
          return {
            date,
            periodId,
            periodLabel: PERIOD_LABELS[periodId],
            minTemp: null,
            maxTemp: null,
            tempAmp: null,
            rainSum: null,
            maxWind: null,
            maxGust: null,
          }
        }
        const tempAmp =
          existing.minTemp !== null && existing.maxTemp !== null
            ? Math.max(existing.maxTemp - existing.minTemp, 0)
            : null
        return {
          ...existing,
          tempAmp,
        }
      }),
    )
  // Exemplo mental: se um bucket recebe ventos [25, 130] km/h e chuvas [0.8, 200] mm, apenas 25 km/h e 0.8 mm são considerados (leituras absurdas ignoradas); maxGust segue a mesma regra, garantindo que buildCalendarBuckets trabalhe só com dados plausíveis.
}

// Heatmap scores agora são relativos aos percentis da própria janela de 30 dias por período,
// evitando que faixas como "Noite" fiquem sempre cinza e mantendo coerência entre linhas.
function buildCalendarBuckets(historicalBuckets: HistoricalBucket[]): CalendarBucket[] {
  if (!historicalBuckets.length) {
    return []
  }
  const sortedTempAmps: number[] = []
  const periodTempAmps = PERIOD_IDS.map(() => [] as number[])

  historicalBuckets.forEach((bucket) => {
    const periodIndex = bucket.periodId
    const amp = bucket.tempAmp ?? 0
    if (amp > 0.5) {
      sortedTempAmps.push(amp)
      periodTempAmps[periodIndex].push(amp)
    }
  })

  sortedTempAmps.sort((a, b) => a - b)
  periodTempAmps.forEach((list) => list.sort((a, b) => a - b))

  const globalTempPercentiles = {
    p30: getPercentile(sortedTempAmps, 30),
    p85: getPercentile(sortedTempAmps, 85),
  }
  const periodTempPercentiles = periodTempAmps.map((values) => ({
    p30: getPercentile(values, 30),
    p85: getPercentile(values, 85),
  }))
  // Percentis são calculados por período para evitar que, por exemplo, a linha "Noite" compare seus valores suaves com extremos diurnos.
  const pickPercentiles = (
    perPeriod: Array<{ p30: number; p85: number }>,
    global: { p30: number; p85: number },
    periodIndex: PeriodId,
  ) => {
    const stats = perPeriod[periodIndex]
    if (stats && stats.p85 > 0) {
      return stats
    }
    return global
  }

  const buckets = historicalBuckets.map((bucket) => {
    const baseWind = bucket.maxWind ?? 0
    const gust = bucket.maxGust ?? 0
    const gustAdjusted = Math.max(gust - HEATMAP_WIND_GUST_OFFSET_KMH, 0)
    const effectiveWind = Math.max(baseWind, gustAdjusted)
    const tempBounds = pickPercentiles(periodTempPercentiles, globalTempPercentiles, bucket.periodId)

    const tempScore = percentileScore(bucket.tempAmp ?? 0, tempBounds.p30, tempBounds.p85)
    const windScore = levelToScore(getWindHeatmapLevel(effectiveWind, gust))
    const rainScore = levelToScore(getRainHeatmapLevel(bucket.rainSum ?? 0))

    const maxScore = Math.max(tempScore, rainScore, windScore)
    let dominantLabel: DominantLabel
    let intensity: number
    if (maxScore < HEATMAP_STABLE_THRESHOLD) {
      dominantLabel = 'estavel'
      intensity = 0
    } else {
      const rainEligible = rainScore >= 0.25
      const windEligible = windScore >= 0.25
      const tempEligible = tempScore >= 0.25
      if (rainEligible && rainScore >= windScore && rainScore >= tempScore) {
        dominantLabel = 'chuva'
      } else if (windEligible && windScore >= tempScore && windScore >= rainScore) {
        dominantLabel = 'vento'
      } else if (tempEligible && tempScore >= rainScore && tempScore >= windScore) {
        dominantLabel = 'temperatura'
      } else if (rainEligible && rainScore >= windScore - 0.05) {
        dominantLabel = 'chuva'
      } else if (windEligible && windScore >= tempScore - 0.05) {
        dominantLabel = 'vento'
      } else if (tempEligible) {
        dominantLabel = 'temperatura'
      } else {
        dominantLabel = 'estavel'
      }
      intensity = maxScore
    }
    return {
      date: bucket.date,
      periodId: bucket.periodId,
      periodLabel: bucket.periodLabel,
      dominantLabel,
      intensity,
      minTemp: bucket.minTemp,
      maxTemp: bucket.maxTemp,
      tempAmp: bucket.tempAmp,
      rainSum: bucket.rainSum,
      maxWind: bucket.maxWind,
      maxGust: bucket.maxGust,
      tempScore,
      windScore,
      rainScore,
    }
  })

  return buckets.sort((a, b) => {
    if (a.date === b.date) {
      return a.periodId - b.periodId
    }
    return a.date.localeCompare(b.date)
  })
}

function computeHeatIndex(tempC: number, humidity: number) {
  const tempF = tempC * (9 / 5) + 32
  const hiF =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * humidity -
    0.22475541 * tempF * humidity -
    6.83783e-3 * tempF * tempF -
    5.481717e-2 * humidity * humidity +
    1.22874e-3 * tempF * tempF * humidity +
    8.5282e-4 * tempF * humidity * humidity -
    1.99e-6 * tempF * tempF * humidity * humidity
  const adjustedHiF =
    humidity < 13 && tempF >= 80 && tempF <= 112
      ? hiF - ((13 - humidity) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17)
      : humidity > 85 && tempF >= 80 && tempF <= 87
      ? hiF + ((humidity - 85) / 10) * ((87 - tempF) / 5)
      : hiF
  const hiC = ((adjustedHiF - 32) * 5) / 9
  return Number.isFinite(hiC) ? hiC : tempC
}

type HeatComfortDescriptor = {
  label: string
  detail: string | null
  level: 'ok' | 'attention' | 'risk'
}

function describeHeatComfort(heatIndex: number | null): HeatComfortDescriptor {
  if (heatIndex === null) {
    return {
      label: 'Sem dados recentes',
      detail: 'Aguardando novas leituras para calcular o conforto.',
      level: 'ok',
    }
  }
  if (heatIndex < HEAT_INDEX_OK) {
    return {
      label: 'Conforto adequado',
      detail: 'Condições agradáveis para atividades normais.',
      level: 'ok',
    }
  }
  if (heatIndex < HEAT_INDEX_ATTENTION) {
    return {
      label: 'Atenção ao calor',
      detail: 'Hidrate-se e reduza esforço prolongado.',
      level: 'attention',
    }
  }
  return {
    label: 'Risco de calor',
    detail: 'Evite sol forte e prefira locais frescos.',
    level: 'risk',
  }
}

type DailyWindDescriptor = {
  label: string
  detail: string
  level: 'low' | 'moderate' | 'high'
  value: number | null
}

type DailyRainDescriptor = {
  label: string
  detail: string
  level: 'low' | 'moderate' | 'high'
  probability: number
  totalMm: number
}

type PressureDescriptor = {
  label: string
  detail: string
  average: number | null
  trend: number | null
}

type TomorrowForecastSummary = {
  hasData: boolean
  tempMin?: number
  tempMax?: number
  rainProbMax?: number
  rainMmTotal?: number
  windGustMax?: number
  windSpeedMax?: number
  windDir?: string | null
  shortText?: string
}

// describeDailyWindRisk:
// - Usa os máximos de todayWindStats (rajadas e sustentado) com fallback nos agregados de vento.
// - Faixas: <40 km/h (baixo), 40-70 (monitorar), >70 (alto), seguindo os thresholds de alertas (STORM_*).
function describeDailyWindRisk(
  stats: TodayWindStats,
  fallbackWind: number | null,
): DailyWindDescriptor {
  const gust = stats.maxWindGust ?? stats.currentWindGust ?? null
  const sustained =
    stats.maxWindSpeed ??
    stats.displayWindSpeed ??
    stats.medianRecentSpeed ??
    fallbackWind ??
    null
  const reference = gust ?? sustained ?? 0
  let level: DailyWindDescriptor['level'] = 'low'
  let label = 'Vento calmo'
  const directionDisplay = getWindDirectionDisplay(stats.dominantDirection)
  let detail = directionDisplay.label
    ? `Direção ${directionDisplay.label}`
    : `Rajadas abaixo de ${WIND_GUST_MONITOR_KMH} km/h.`
  if (reference >= WIND_GUST_HIGH_KMH || (sustained ?? 0) >= WIND_SPEED_HIGH_KMH) {
    level = 'high'
    label = 'Risco alto de vento'
    detail = 'Rajadas fortes exigem atenção e planejamento.'
  } else if (
    reference >= WIND_GUST_MONITOR_KMH ||
    (sustained ?? 0) >= WIND_SPEED_MONITOR_KMH
  ) {
    level = 'moderate'
    label = 'Monitorar condições de vento'
    detail = directionDisplay.label
      ? `Rajadas moderadas vindas de ${directionDisplay.label}.`
      : 'Rajadas moderadas no período.'
  }
  return {
    detail,
    label,
    level,
    value: gust ?? sustained ?? fallbackWind ?? null,
  }
}

// describeDailyRainRisk:
// - Usa todayRainStats (probabilidade e mm) e os campos latestRainChance/aggregatedMetrics.rainChance como fallback.
// - Faixas: prob >=60% ou >=25mm (alto), prob >=30% ou >=10mm (monitorar), caso contrário baixo.
function describeDailyRainRisk(
  stats: TodayRainStats,
  latestRainChance: number | null,
  aggregatedRainChance: number | null,
): DailyRainDescriptor {
  const rawProbability =
    stats.rainProbability ??
    latestRainChance ??
    aggregatedRainChance ??
    0
  const probability = Math.max(0, Math.min(100, rawProbability))
  const totalMm = stats.totalRainMm ?? 0
  let level: DailyRainDescriptor['level'] = 'low'
  let label = 'Dia predominantemente seco'
  let detail = 'Sem registros relevantes de chuva.'
  if (probability >= RAIN_PROBABILITY_ALERT || totalMm >= DAILY_RAIN_HIGH_MM) {
    level = 'high'
    label = 'Risco alto de chuva'
    detail = `Acumulado de ${totalMm.toFixed(1)} mm hoje; mantenha plano B.`
  } else if (
    probability >= RAIN_PROBABILITY_MONITOR ||
    totalMm >= DAILY_RAIN_WARN_MM
  ) {
    level = 'moderate'
    label = 'Monitorar chuva hoje'
    detail = `Acumulado de ${totalMm.toFixed(1)} mm e chance de ${Math.round(probability)}%.`
  }
  return {
    detail,
    label,
    level,
    probability: Math.round(probability),
    totalMm,
  }
}

function describePressureStability(
  averagePressure: number | null,
  trend: number | null,
): PressureDescriptor {
  if (averagePressure === null) {
    return {
      average: null,
      detail: 'Sem leituras de pressão.',
      label: 'Pressão indisponível',
      trend,
    }
  }
  const trendValue = trend ?? 0
  const absTrend = Math.abs(trendValue)
  if (absTrend <= PRESSURE_TREND_STABLE_MAX) {
    return {
      average: averagePressure,
      detail: 'Variação mínima: condições estáveis.',
      label: 'Pressão estável',
      trend,
    }
  }
  if (absTrend >= PRESSURE_TREND_ALERT_MIN) {
    return {
      average: averagePressure,
      detail: trendValue > 0 ? 'Pressão caindo: atenção a instabilidades.' : 'Pressão subindo: tendência de tempo firme.',
      label: trendValue > 0 ? 'Queda de pressão' : 'Alta de pressão',
      trend,
    }
  }
  return {
    average: averagePressure,
    detail: trendValue > 0 ? 'Leve queda de pressão.' : 'Leve alta de pressão.',
    label: 'Mudança moderada',
    trend,
  }
}

type StormRiskLabel = {
  text: string
  level: 'stable' | 'watch' | 'high'
  rainProb: number | null
  gust: number | null
}

function describeStormRisk(rainProb: number | null, gust: number | null): StormRiskLabel {
  const safeRain = rainProb ?? 0
  const safeGust = gust ?? 0
  if (safeRain >= STORM_RAIN_HIGH || safeGust >= STORM_GUST_HIGH) {
    return { text: 'Risco alto de tempestade', level: 'high', rainProb, gust }
  }
  if (safeRain >= STORM_RAIN_WARN || safeGust >= STORM_GUST_WARN) {
    return { text: 'Monitorar condições', level: 'watch', rainProb, gust }
  }
  return { text: 'Estado estável', level: 'stable', rainProb, gust }
}

function computeDewPointFromTempAndHumidity(
  temperatureC: number | null | undefined,
  humidityPercent: number | null | undefined,
): number | null {
  if (temperatureC === null || temperatureC === undefined) {
    return null
  }
  if (humidityPercent === null || humidityPercent === undefined) {
    return null
  }
  if (!Number.isFinite(temperatureC) || !Number.isFinite(humidityPercent)) {
    return null
  }
  if (humidityPercent <= 0 || humidityPercent > 100) {
    return null
  }
  const rh = humidityPercent / 100
  const A = 17.27
  const B = 237.7
  const gamma = (A * temperatureC) / (B + temperatureC) + Math.log(rh)
  const dewPoint = (B * gamma) / (A - gamma)
  if (!Number.isFinite(dewPoint)) {
    return null
  }
  return Math.max(-40, Math.min(35, dewPoint))
}

function getDewPointForLog(log: WeatherLog | null | undefined): number | null {
  if (!log) {
    return null
  }
  const explicit = findMetricValue(log.metrics, [DEW_POINT_PATTERN])
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return explicit
  }
  const temperature = readMetricValue(log.metrics, METRIC_KEYS.temperature)
  const humidity = readMetricValue(log.metrics, METRIC_KEYS.humidity)
  return computeDewPointFromTempAndHumidity(temperature, humidity)
}

function Dashboard() {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }
    return localStorage.getItem('gdash-token')
  })
  const [loginState, setLoginState] = useState<LoginForm>({
    email: '',
    password: '',
  })
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  const [weatherLogs, setWeatherLogs] = useState<WeatherLog[]>([])
  const [users, setUsers] = useState<SafeUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [remoteInsights, setRemoteInsights] = useState<WeatherInsightsPayload | null>(null)
  const [currentUser, setCurrentUser] = useState<SafeUser | null>(null)
  const refreshTimeoutRef = useRef<number | null>(null)
  const [chartWindowSelection, setChartWindowSelection] = useState<ChartHistoryValue>('24h')
  const chartWindow = useDeferredValue(chartWindowSelection)
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark')
  const sparklineContainerRef = useRef<HTMLDivElement | null>(null)
  const [sparklineRenderWidth, setSparklineRenderWidth] = useState(SPARKLINE_VIEW_WIDTH)
  const [, setHeatmapColumns] = useState(0)
  const liveUpdateTimeoutRef = useRef<number | null>(null)
  const handleVisibleColumnsChange = useCallback((cols: number) => {
    setHeatmapColumns(cols)
  }, [])
  const [refreshHint, setRefreshHint] = useState<{
    text: string
    tone: 'info' | 'success'
    timeLabel?: string
  } | null>(null)
  const scheduleRefreshHint = useCallback((text: string, tone: 'info' | 'success', timeLabel?: string) => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current)
    }
    setRefreshHint({ text, tone, timeLabel })
    refreshTimeoutRef.current = window.setTimeout(() => {
      setRefreshHint(null)
      refreshTimeoutRef.current = null
    }, 5000)
  }, [])

  const isDark = themeMode === 'dark'
  const toggleTheme = () => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))

  const backgroundStyle = useMemo<CSSProperties>(() => {
    const backgroundImageUrl = isDark ? bgDark : bgLight
    const overlay = isDark
      ? 'linear-gradient(180deg, rgba(2,4,12,0.55) 0%, rgba(3,6,18,0.48) 40%, rgba(4,9,20,0.35) 100%)'
      : 'linear-gradient(180deg, rgba(248,250,255,0.16) 0%, rgba(238,244,255,0.12) 45%, rgba(235,243,255,0.08) 100%)'
    return {
      // Uma única camada translúcida para revelar as nuvens e manter contraste dos cards.
      minHeight: '100vh',
      backgroundImage: `${overlay}, url(${backgroundImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
      backgroundColor: isDark ? '#01030a' : '#f5f8fd',
    }
  }, [isDark])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [isDark])

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [])

  const [userForm, setUserForm] = useState<UserForm>({
    name: '',
    email: '',
    password: '',
  })
  const [userMessage, setUserMessage] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [creatingUser, setCreatingUser] = useState(false)
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  const clearSession = useCallback(() => {
    setToken(null)
    setUsers([])
    setWeatherLogs([])
    setAuthError(null)
    setUserMessage(null)
    setUserError(null)
    setExportMessage(null)
    setRemoteInsights(null)
    setCurrentUser(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('gdash-token')
    }
  }, [
    setToken,
    setUsers,
    setWeatherLogs,
    setAuthError,
    setUserMessage,
    setUserError,
    setExportMessage,
    setRemoteInsights,
    setCurrentUser,
  ])

  const { toast } = useToast()

  const handleAuthFailure = useCallback(() => {
    clearSession()
    setAuthError('Sessão expirada, faça login novamente.')
  }, [clearSession])

  const totalLogs = remoteInsights?.totalLogs ?? weatherLogs.length
  const isAdminUser = Boolean(currentUser?.isAdmin)

  const fetchWeatherLogsPage = useCallback(
    async (pageNumber: number) => {
      if (!token) {
        return null
      }
      return apiWeatherLogs(token, { page: pageNumber, limit: LOGS_PAGE_SIZE })
    },
    [token],
  )

  const loadWeather = useCallback(async (fetchAll = false) => {
    if (!token) {
      return
    }
    scheduleRefreshHint('Atualizando...', 'info')
    try {
      const aggregatedLogs: WeatherLog[] = []
      let page = 1
      const targetPages = fetchAll ? Number.POSITIVE_INFINITY : MAX_HISTORY_PAGES
      while (page <= targetPages) {
        const response = await fetchWeatherLogsPage(page)
        if (!response || !response.items.length) {
          break
        }
        aggregatedLogs.push(...response.items)
        const isLastPage = response.items.length < LOGS_PAGE_SIZE
        const hasEnoughPoints = !fetchAll && aggregatedLogs.length >= MIN_HISTORY_POINTS
        if (isLastPage || hasEnoughPoints) {
          break
        }
        page += 1
      }
      setWeatherLogs(aggregatedLogs)
      const nowLabel = formatTime(new Date().toISOString())
      scheduleRefreshHint('Atualizado', 'success', nowLabel)
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      }
    }
  }, [fetchWeatherLogsPage, handleAuthFailure, scheduleRefreshHint, token])

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      setCurrentUser(null)
      return
    }
    try {
      const profile = await apiCurrentUser(token)
      setCurrentUser(profile)
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      }
    }
  }, [handleAuthFailure, token])

  const loadUsers = useCallback(async () => {
    if (!token) {
      return
    }
    setLoadingUsers(true)
    try {
      const payload = await apiUsers(token)
      setUsers(payload.items)
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      } else if ((error as ApiError).status === 403) {
        setUserError('Sem permissao para listar usuarios.')
      }
    } finally {
      setLoadingUsers(false)
    }
  }, [handleAuthFailure, token])

  const loadInsights = useCallback(async () => {
    if (!token) {
      return
    }
    try {
      const data = await apiInsights(token)
      setRemoteInsights(data)
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      }
    }
  }, [handleAuthFailure, token])

  useEffect(() => {
    if (token) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('gdash-token', token)
      }
      loadWeather(true)
      loadInsights()
    } else {
      setWeatherLogs([])
      setUsers([])
      setRemoteInsights(null)
      setCurrentUser(null)
    }
  }, [loadInsights, loadWeather, token])

  useEffect(() => {
    if (!token) {
      return
    }
    loadCurrentUser()
  }, [loadCurrentUser, token])

  useEffect(() => {
    if (!token || !isAdminUser) {
      setUsers([])
      return
    }
    loadUsers()
  }, [isAdminUser, loadUsers, token])

  useEffect(() => {
    if (!sparklineContainerRef.current) {
      return
    }
    const width = sparklineContainerRef.current.offsetWidth
    if (width > 0) {
      setSparklineRenderWidth(Math.max(width, SPARKLINE_VIEW_WIDTH))
    }
  }, [])

  useEffect(() => {
    if (!token) {
      return
    }
    const socket = io(`${API_ORIGIN}/weather`, {
      auth: { token },
    })
    socket.on('weather.log.created', () => {
      if (liveUpdateTimeoutRef.current !== null) {
        return
      }
      liveUpdateTimeoutRef.current = window.setTimeout(() => {
        loadWeather()
        loadInsights()
        liveUpdateTimeoutRef.current = null
      }, 400)
    })
    return () => {
      if (liveUpdateTimeoutRef.current) {
        window.clearTimeout(liveUpdateTimeoutRef.current)
        liveUpdateTimeoutRef.current = null
      }
      socket.disconnect()
    }
  }, [token, loadInsights, loadWeather])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthError(null)
    try {
      const { access_token } = await apiLogin(loginState.email.trim(), loginState.password)
      setToken(access_token)
      setLoginState({ email: '', password: '' })
    } catch (error) {
      setAuthError((error as Error).message ?? 'Não foi possível autenticar.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    clearSession()
  }

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!token) {
      return
    }
    setExportMessage(null)
    setExporting(format)
    try {
      const { blob, filename } = await apiExportWeather(token, format)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setExportMessage(`Exportação ${format.toUpperCase()} gerada.`)
      toast(`Exportação ${format.toUpperCase()} gerada.`, 'success')
    } catch (error) {
      setExportMessage((error as Error).message)
      toast(`Falha na exportação: ${(error as Error).message}`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const handleSubmitUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      return
    }
    if (!isAdminUser) {
      setUserError('Apenas administradores podem gerenciar usuarios.')
      return
    }
    const editingId = editingUserId
    setCreatingUser(true)
    setUserMessage(null)
    setUserError(null)
    try {
      if (editingId) {
        const updatePayload: Partial<UserForm> = {
          name: userForm.name.trim(),
          email: userForm.email.trim(),
        }
        if (userForm.password.trim()) {
          updatePayload.password = userForm.password
        }
        await apiUpdateUser(token, editingId, updatePayload)
        setUserMessage('Usuario atualizado com sucesso.')
        toast('Usuario atualizado com sucesso.', 'success')
        setEditingUserId(null)
        if (currentUser?.id === editingId) {
          await loadCurrentUser()
        }
      } else {
        await apiCreateUser(token, {
          name: userForm.name.trim(),
          email: userForm.email.trim(),
          password: userForm.password,
        })
        setUserMessage('Usuario criado com sucesso.')
        toast('Usuario criado com sucesso.', 'success')
      }
      setUserForm({ name: '', email: '', password: '' })
      loadUsers()
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      } else {
        const fallbackMessage = editingId
          ? 'Nao foi possivel atualizar o usuario.'
          : 'Nao foi possivel criar o usuario.'
        const message = (error as Error).message ?? fallbackMessage
        setUserError(message)
        toast(message, 'error')
      }
    } finally {
      setCreatingUser(false)
    }
  }

  const handleCancelUserEdit = () => {
    setEditingUserId(null)
    setUserForm({ name: '', email: '', password: '' })
    setUserMessage(null)
    setUserError(null)
  }

  const handleDeleteUser = async (id: string) => {
    if (!token) {
      return
    }
    if (!isAdminUser) {
      setUserError('Apenas administradores podem remover usuarios.')
      return
    }
    setDeletingUser(id)
    setUserMessage(null)
    setUserError(null)
    if (currentUser?.id === id) {
      setUserError('Você não pode remover sua própria conta aqui.')
      setDeletingUser(null)
      return
    }
    try {
      await apiDeleteUser(token, id)
      setUserMessage('Usuario removido.')
      toast('Usuario removido.', 'success')
      if (editingUserId === id) {
        setEditingUserId(null)
        setUserForm({ name: '', email: '', password: '' })
      }
      loadUsers()
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      } else {
        setUserError((error as Error).message ?? 'Falha ao remover o usuario.')
        toast((error as Error).message ?? 'Falha ao remover o usuario.', 'error')
      }
    } finally {
      setDeletingUser(null)
    }
  }

  const handleToggleUserAdmin = async (id: string, nextValue: boolean, targetName: string) => {
    if (!token || !isAdminUser) {
      setUserError('Apenas administradores podem alterar permissoes.')
      return
    }
    if (currentUser?.id === id && !nextValue) {
      setUserError('Voce nao pode remover sua propria permissao admin.')
      return
    }
    setUserMessage(null)
    setUserError(null)
    try {
      await apiUpdateUser(token, id, { isAdmin: nextValue })
        toast(
          nextValue
            ? `Permissao admin concedida para ${targetName}.`
            : `Permissao admin removida de ${targetName}.`,
          'success',
        )
      if (currentUser?.id === id) {
        await loadCurrentUser()
      }
      loadUsers()
    } catch (error) {
      if ((error as ApiError).status === 401) {
        handleAuthFailure()
      } else {
        const fallback = 'Nao foi possivel atualizar a permissao.'
        const message = (error as Error).message ?? fallback
        setUserError(message)
        toast(message, 'error')
      }
    }
  }

  const effectiveLogs = useMemo(() => getEffectiveLogs(weatherLogs), [weatherLogs])
  const historicalLogs = useMemo(() => {
    if (!effectiveLogs.length) {
      return []
    }
    const nowMs = Date.now()
    const cutoff = nowMs - HISTORICAL_WINDOW_MS
    return effectiveLogs.filter((log) => {
      const timestampMs = parseTimestampMs(log.timestamp)
      return timestampMs !== null && timestampMs >= cutoff
    })
  }, [effectiveLogs])
  useEffect(() => {
    if (!DEBUG_LOGS || !weatherLogs.length) {
      return
    }
    const allTs = weatherLogs
      .map((log) => parseTimestampMs(log.timestamp))
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b)
    const effTs = effectiveLogs
      .map((log) => parseTimestampMs(log.timestamp))
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b)
    console.group('[Nimbus] Debug de logs')
    console.log('Total bruto:', weatherLogs.length)
    if (allTs.length > 0) {
      console.log('Intervalo bruto:', new Date(allTs[0]).toISOString(), '→', new Date(allTs[allTs.length - 1]).toISOString())
    }
    console.log('Total efetivo (<= agora):', effectiveLogs.length)
    if (effTs.length > 0) {
      console.log('Intervalo efetivo:', new Date(effTs[0]).toISOString(), '→', new Date(effTs[effTs.length - 1]).toISOString())
    } else {
      console.log('Nenhum log efetivo (<= agora).')
    }
    console.groupEnd()
  }, [weatherLogs, effectiveLogs])
  const latestLog = effectiveLogs[effectiveLogs.length - 1] ?? weatherLogs[0]
  // todayLogs filtra apenas registros do mesmo dia local do último log disponível.
  const todayLogs = useMemo(() => {
    if (!latestLog?.timestamp) {
      return []
    }
    return effectiveLogs.filter((log) =>
      isSameLocalDay(log.timestamp, latestLog.timestamp, DASHBOARD_TIMEZONE),
    )
  }, [effectiveLogs, latestLog])
  // todayWindStats calcula velocidade/rajadas a 10 m e mantém apenas valores "perceptíveis".
  const todayWindStats = useMemo<TodayWindStats>(() => {
    if (!todayLogs.length) {
      return EMPTY_TODAY_WIND_STATS
    }
    const validSpeeds10m: number[] = []
    const gustsValid: number[] = []
    const directionAngles: number[] = []
    const recentSpeeds: number[] = []
    const latestTs = latestLog ? parseTimestampMs(latestLog.timestamp) : null
    const recentCutoff = latestTs !== null ? latestTs - RECENT_WINDOW_MS : null
    for (const log of todayLogs) {
      const metrics = log.metrics
      const speed = readMetricValue(metrics, WIND_SPEED_10M_KEYS)
      if (
        typeof speed === 'number' &&
        Number.isFinite(speed) &&
        speed >= MIN_WIND_KMH &&
        speed <= MAX_WIND_SPEED_KMH
      ) {
        validSpeeds10m.push(speed)
        const logTs = parseTimestampMs(log.timestamp)
        if (recentCutoff !== null && logTs !== null && logTs >= recentCutoff) {
          recentSpeeds.push(speed)
        }
      }
      const gust = readMetricValue(metrics, WIND_GUST_KEYS)
      if (
        typeof gust === 'number' &&
        Number.isFinite(gust) &&
        gust >= MIN_WIND_KMH &&
        gust <= MAX_WIND_GUST_KMH
      ) {
        gustsValid.push(gust)
      }
      const direction = findMetricValue(metrics, WIND_DIRECTION_PATTERNS)
      if (typeof direction === 'number') {
        directionAngles.push(direction)
      }
    }
    const hasValidSpeeds = validSpeeds10m.length > 0
    const maxWindSpeed = hasValidSpeeds ? Math.max(...validSpeeds10m) : null
    const medianRecentSpeed = recentSpeeds.length ? computeMedian(recentSpeeds) : null
    const medianAll = hasValidSpeeds ? computeMedian(validSpeeds10m) : null
    let displayWindSpeed: number | null = null
    let medianSpeed: number | null = null
    if (!hasValidSpeeds) {
      displayWindSpeed = 0
      medianSpeed = null
    } else if (medianRecentSpeed !== null) {
      displayWindSpeed = medianRecentSpeed
      medianSpeed = medianRecentSpeed
    } else {
      displayWindSpeed = medianAll === null ? 0 : medianAll
      medianSpeed = medianAll
    }
    const rawMaxGust = gustsValid.length ? Math.max(...gustsValid) : null
    let gustP95: number | null = null
    if (gustsValid.length >= 5) {
      const sorted = [...gustsValid].sort((a, b) => a - b)
      const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))
      gustP95 = sorted[index]
    } else {
      gustP95 = rawMaxGust
    }
    let displayGust: number | null = null
    if (typeof gustP95 === 'number') {
      const rounded = Math.round(gustP95)
      const clamped = Math.min(SOFT_MAX_GUST_KMH, Math.max(MIN_WIND_KMH, rounded))
      displayGust = clamped < MIN_DISPLAY_GUST_KMH ? null : clamped
    }
    let currentWindSpeed: number | null = null
    let currentWindGust: number | null = null
    for (let index = todayLogs.length - 1; index >= 0; index -= 1) {
      const metrics = todayLogs[index].metrics
      if (currentWindSpeed === null) {
        const speed = readMetricValue(metrics, WIND_SPEED_10M_KEYS)
        if (
          typeof speed === 'number' &&
          Number.isFinite(speed) &&
          speed >= MIN_WIND_KMH &&
          speed <= MAX_WIND_SPEED_KMH
        ) {
          currentWindSpeed = speed
        }
      }
      if (currentWindGust === null) {
        const gust = readMetricValue(metrics, WIND_GUST_KEYS)
        if (
          typeof gust === 'number' &&
          Number.isFinite(gust) &&
          gust >= MIN_WIND_KMH &&
          gust <= MAX_WIND_GUST_KMH
        ) {
          currentWindGust = gust
        }
      }
      if (currentWindSpeed !== null && currentWindGust !== null) {
        break
      }
    }
    const hasSufficientSamples =
      validSpeeds10m.length >= MIN_TODAY_WIND_SAMPLES ||
      gustsValid.length >= MIN_TODAY_WIND_SAMPLES
    return {
      currentWindSpeed,
      currentWindGust,
      maxWindSpeed,
      maxWindGust: displayGust,
      dominantDirection: computeDominantWindDirection(directionAngles) ?? null,
      gustsValidCount: gustsValid.length,
      medianSpeed,
      displayWindSpeed,
      medianRecentSpeed,
      recentSpeedsCount: recentSpeeds.length,
      hasSufficientSamples,
    }
  }, [todayLogs, latestLog])


  // todayRainStats soma precipitação e registra o maior percentual do dia.
  const todayRainStats = useMemo<TodayRainStats>(() => {
    if (!todayLogs.length) {
      return {
        totalSlots: 0,
        rainySlots: 0,
        totalRainMm: 0,
        totalRainMmLast3h: null,
        rainProbability: null,
        rainProbabilityCount: 0,
        hasRainEvents: false,
        hasSufficientSamples: false,
      }
    }
    let totalSlots = 0
    let rainySlots = 0
    let totalRainMm = 0
    let maxProbability: number | null = null
    let probabilityCount = 0
    let totalRainMmLast3h = 0
    const nowMs = parseTimestampMs(latestLog?.timestamp)
    const cutoffMs = typeof nowMs === 'number' ? nowMs - RAIN_RECENT_WINDOW_MS : null
    for (const log of todayLogs) {
      const metrics = log.metrics
      const rainValue = readMetricValue(metrics, RAIN_MM_KEYS)
      if (typeof rainValue === 'number' && Number.isFinite(rainValue) && rainValue >= 0) {
        totalSlots += 1
        const clampedRain = Math.min(MAX_SINGLE_RAIN_MM, rainValue)
        totalRainMm += clampedRain
        if (clampedRain >= 0.1) {
          rainySlots += 1
        }
        if (cutoffMs !== null && nowMs !== null) {
          const ts = parseTimestampMs(log.timestamp)
          if (ts !== null && ts >= cutoffMs && ts <= nowMs) {
            totalRainMmLast3h += clampedRain
          }
        }
      }
      const probability = readMetricValue(metrics, RAIN_PROBABILITY_KEYS)
      if (typeof probability === 'number' && Number.isFinite(probability)) {
        const clamped = Math.min(100, Math.max(0, probability))
        maxProbability = maxProbability === null ? clamped : Math.max(maxProbability, clamped)
        probabilityCount += 1
      }
    }
    totalRainMm = Math.min(Math.max(totalRainMm, 0), MAX_DAILY_RAIN_MM)
    const totalRainMmRecent =
      cutoffMs !== null ? Math.min(Math.max(totalRainMmLast3h, 0), MAX_DAILY_RAIN_MM) : null
    const hasRainEvents = totalRainMm > 0.1
    const probFromRain =
      totalSlots > 0 ? Math.round((100 * rainySlots) / totalSlots) : null
    let rainProbability = maxProbability ?? probFromRain
    if (rainProbability === null && totalSlots > 0 && rainySlots === 0) {
      rainProbability = 0
    }
    const rainProbabilityCount =
      maxProbability !== null ? probabilityCount : totalSlots
    const hasSufficientSamples =
      totalSlots >= MIN_TODAY_RAIN_SAMPLES || rainProbabilityCount >= MIN_TODAY_RAIN_SAMPLES
    return {
      totalSlots,
      rainySlots,
      totalRainMm,
      totalRainMmLast3h: totalRainMmRecent,
      rainProbability,
      rainProbabilityCount,
      hasRainEvents,
      hasSufficientSamples,
    }
  }, [latestLog, todayLogs])

  const todayTemperatureStats = useMemo<TodayTemperatureStats>(() => {
    if (!todayLogs.length) {
      return EMPTY_TODAY_TEMPERATURE_STATS
    }
    const values = todayLogs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.temperature))
      .filter((value): value is number => value !== null)
    if (!values.length) {
      return EMPTY_TODAY_TEMPERATURE_STATS
    }
    const min = Math.min(...values)
    const max = Math.max(...values)
    const sum = values.reduce((acc, value) => acc + value, 0)
    const average = sum / values.length
    return {
      min,
      max,
      amplitude: max - min,
      average,
      count: values.length,
    }
  }, [todayLogs])

  const todayDewPointStats = useMemo<TodayDewPointStats>(() => {
    const values = todayLogs
      .map((log) => getDewPointForLog(log))
      .filter((value): value is number => value !== null)
    if (!values.length) {
      return EMPTY_TODAY_DEW_STATS
    }
    const min = Math.min(...values)
    const sum = values.reduce((acc, value) => acc + value, 0)
    const average = sum / values.length
    return {
      average,
      min,
      count: values.length,
    }
  }, [todayLogs])
  const latestMetrics = useMemo<Record<GraphKey, number | null>>(() => {
    const keys = Object.keys(METRIC_KEYS) as GraphKey[]
    const latest: Partial<Record<GraphKey, number | null>> = {}
    keys.forEach((key) => {
      latest[key] = readMetricValue(latestLog?.metrics, METRIC_KEYS[key])
    })
    return latest as Record<GraphKey, number | null>
  }, [latestLog])
  const latestTemp = latestMetrics.temperature
  const latestHumidity = latestMetrics.humidity
  const windSpeed = todayWindStats.displayWindSpeed
  const tomorrowLocalDayKey = useMemo(() => {
    if (!latestLog?.timestamp) {
      return null
    }
    const latestDate = new Date(latestLog.timestamp)
    if (Number.isNaN(latestDate.getTime())) {
      return null
    }
    const tomorrowDate = new Date(latestDate.getTime() + TOMORROW_OFFSET_MS)
    return formatLocalDayKey(tomorrowDate, DASHBOARD_TIMEZONE)
  }, [latestLog])
  const tomorrowForecast = useMemo<TomorrowForecastSummary>(() => {
    // tomorrowForecast:
    // - baseia-se nos logs cujo dia local (DASHBOARD_TIMEZONE) coincide com tomorrowLocalDayKey,
    //   que representa a data imediatamente seguinte à última leitura disponível (latestLog.timestamp + TOMORROW_OFFSET_MS).
    // - extrai tempMin/tempMax a partir de METRIC_KEYS.temperature, rainProbMax de METRIC_KEYS.rain,
    //   rainMmTotal dos RAIN_MM_KEYS totais, e rajadas/direção das métricas de vento encontradas no log.
    // - shortText resume os destaques (calor, chuva, vento) com base nos thresholds definidos abaixo.
    if (!tomorrowLocalDayKey) {
      return { hasData: false }
    }
    const candidateLogs = weatherLogs.filter((log) => {
      const key = formatLocalDayKey(log.timestamp, DASHBOARD_TIMEZONE)
      return key !== null && key === tomorrowLocalDayKey
    })
    if (!candidateLogs.length) {
      return { hasData: false }
    }
    const tempValues = candidateLogs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.temperature))
      .filter((value): value is number => typeof value === 'number')
    const rainProbValues = candidateLogs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.rain))
      .filter((value): value is number => typeof value === 'number')
    const rainAmounts = candidateLogs
      .map((log) => readMetricValue(log.metrics, RAIN_MM_KEYS))
      .filter((value): value is number => typeof value === 'number')
    const gustValues: number[] = []
    const speedValues: number[] = []
    const directionAngles: number[] = []
    for (const log of candidateLogs) {
      const gust = readMetricValue(log.metrics, WIND_GUST_KEYS)
      if (
        typeof gust === 'number' &&
        Number.isFinite(gust) &&
        gust >= MIN_WIND_KMH &&
        gust <= MAX_WIND_GUST_KMH
      ) {
        gustValues.push(gust)
      }
      const sustained = readMetricValue(log.metrics, WIND_SPEED_10M_KEYS)
      if (
        typeof sustained === 'number' &&
        Number.isFinite(sustained) &&
        sustained >= MIN_WIND_KMH &&
        sustained <= MAX_WIND_SPEED_KMH
      ) {
        speedValues.push(sustained)
      }
      const direction = findMetricValue(log.metrics, WIND_DIRECTION_PATTERNS)
      if (typeof direction === 'number' && Number.isFinite(direction)) {
        directionAngles.push(direction)
      }
    }
    const tempMin = tempValues.length ? Math.min(...tempValues) : undefined
    const tempMax = tempValues.length ? Math.max(...tempValues) : undefined
    const rainProbMax =
      rainProbValues.length > 0
        ? Math.max(...rainProbValues.map((value) => Math.max(0, Math.min(100, value))))
        : undefined
    const rawRainMmTotal =
      rainAmounts.length > 0
        ? rainAmounts.reduce((acc, value) => acc + Math.max(0, value), 0)
        : undefined
    const rainMmTotal = rawRainMmTotal ?? undefined
    const windSpeedMax = speedValues.length ? Math.max(...speedValues) : undefined
    const rawWindGustMax = gustValues.length ? Math.max(...gustValues) : undefined
    const windGustMax = rawWindGustMax ?? undefined
    const windDir =
      directionAngles.length > 0 ? computeDominantWindDirection(directionAngles) ?? null : null
    const shortText = (() => {
      if (!candidateLogs.length) {
        return 'Sem dados de previsão para amanhã.'
      }
      const { rain, wind } = WEATHER_THRESHOLDS
      const highRain = rainProbMax !== undefined && rainProbMax >= rain.chanceAlert
      const windy = windGustMax !== undefined && windGustMax >= wind.gustStrong
      if (highRain && windy) {
        return 'Pancadas de chuva e rajadas fortes; atenção em áreas abertas.'
      }
      if (highRain) {
        return 'Chuva provável; considere levar guarda-chuva.'
      }
      if (windy) {
        return 'Rajadas moderadas previstas; fixe objetos leves.'
      }
      if (tempMax !== undefined && tempMax >= 30) {
        return 'Dia quente e seco, bom para atividades ao ar livre.'
      }
      return 'Dia relativamente estável, sem extremos esperados.'
    })()
    return {
      hasData: true,
      tempMin,
      tempMax,
      rainProbMax,
      rainMmTotal,
      windGustMax,
      windSpeedMax,
      windDir,
      shortText,
    }
  }, [tomorrowLocalDayKey, weatherLogs])

  useEffect(() => {
    if (!import.meta.env.DEV || !tomorrowForecast.hasData) {
      return
    }
    console.debug('[tomorrowForecast]', {
      tomorrowLocalDayKey,
      tempMin: tomorrowForecast.tempMin,
      tempMax: tomorrowForecast.tempMax,
      rainProbMax: tomorrowForecast.rainProbMax,
      rainMmTotal: tomorrowForecast.rainMmTotal,
      windGustMax: tomorrowForecast.windGustMax,
      windSpeedMax: tomorrowForecast.windSpeedMax,
      windDirection: tomorrowForecast.windDir,
    })
  }, [
    tomorrowForecast.hasData,
    tomorrowForecast.tempMin,
    tomorrowForecast.tempMax,
    tomorrowForecast.rainProbMax,
    tomorrowForecast.rainMmTotal,
    tomorrowForecast.windGustMax,
    tomorrowForecast.windSpeedMax,
    tomorrowForecast.windDir,
    tomorrowLocalDayKey,
  ])

  const temperatureLabel = (() => {
    if (!tomorrowForecast.hasData) return null
    if (tomorrowForecast.tempMin !== undefined && tomorrowForecast.tempMax !== undefined) {
      return `Amanhã: ${tomorrowForecast.tempMin.toFixed(1)}°–${tomorrowForecast.tempMax.toFixed(1)}°`
    }
    if (tomorrowForecast.tempMin !== undefined) {
      return `Mín ${tomorrowForecast.tempMin.toFixed(1)}°`
    }
    if (tomorrowForecast.tempMax !== undefined) {
      return `Máx ${tomorrowForecast.tempMax.toFixed(1)}°`
    }
    return null
  })()

  const rainLabel = (() => {
    if (!tomorrowForecast.hasData) {
      return null
    }
    const safeRainMmTotal = tomorrowForecast.rainMmTotal ?? undefined
    const displayRainMmTotal =
      safeRainMmTotal != null ? Math.min(safeRainMmTotal, TOMORROW_RAIN_SANITY_MM) : undefined
    const probabilityText =
      tomorrowForecast.rainProbMax != null ? `${Math.round(tomorrowForecast.rainProbMax)}%` : null
    const mmText = displayRainMmTotal != null ? `${displayRainMmTotal.toFixed(1)} mm` : null
    if (probabilityText && mmText) {
      return `Chuva ${probabilityText} · ${mmText}`
    }
    if (probabilityText) {
      return `Chuva ${probabilityText}`
    }
    if (mmText) {
      return `Chuva ${mmText}`
    }
    return null
  })()

  const windLabel = (() => {
    if (!tomorrowForecast.hasData) {
      return null
    }
    const safeWindGustMax = tomorrowForecast.windGustMax ?? undefined
    const safeWindSpeedMax = tomorrowForecast.windSpeedMax ?? undefined
    const displayWindGustMax =
      safeWindGustMax != null ? Math.min(safeWindGustMax, TOMORROW_WIND_SANITY_KMH) : undefined
    const displayWindSpeedMax =
      safeWindSpeedMax != null ? Math.min(safeWindSpeedMax, MAX_WIND_SPEED_KMH) : undefined
    const reference = displayWindGustMax ?? displayWindSpeedMax
    if (reference == null) {
      return null
    }
    const gustText = `${reference.toFixed(0)} km/h`
    const { wind } = WEATHER_THRESHOLDS
    const descriptor =
      reference >= wind.gustStrong
        ? 'Rajadas fortes'
        : reference >= wind.speedModerate
        ? 'Rajadas moderadas'
        : 'Rajadas leves'
    const directionInfo = getWindDirectionDisplay(tomorrowForecast.windDir)
    const directionText = directionInfo.label ? ` vindas de ${directionInfo.label}` : ''
    return `${descriptor} de ${gustText}${directionText}`
  })()

  const tomorrowSummary = (() => {
    if (!tomorrowForecast.hasData) {
      return 'Sem dados suficientes para prever o clima de amanhã. Tente novamente mais tarde.'
    }
    const { rain, wind } = WEATHER_THRESHOLDS
    if (
      tomorrowForecast.windGustMax !== undefined &&
      tomorrowForecast.windGustMax >= wind.gustStrong
    ) {
      return 'Rajadas fortes previstas para amanhã: atenção redobrada em áreas abertas e deslocamentos.'
    }
    if (
      tomorrowForecast.rainProbMax !== undefined &&
      tomorrowForecast.rainProbMax >= rain.chanceAlert
    ) {
      return 'Chuva provável ao longo de amanhã: planeje rotas cobertas e tenha capa ou guarda-chuva por perto.'
    }
    if (
      tomorrowForecast.rainProbMax !== undefined &&
      tomorrowForecast.rainProbMax >= rain.chanceMonitor
    ) {
      return 'Chance maior de chuva ao longo de amanhã: considere capa ou guarda-chuva.'
    }
    return 'Amanhã tende a ser estável, sem extremos relevantes de chuva ou vento.'
  })()

  // Inventário das métricas com dados consistentes hoje:
  // Temperatura:
  //   - instantâneo: latestMetrics.temperature (METRIC_KEYS.temperature) alimenta gráfico e cards.
  //   - agregados: aggregatedMetrics.averageTemperature/minTemperature/maxTemperature e todayTemperatureStats (médias/amplitudes para heatmap/alertas).
  // Umidade:
  //   - instantâneo: latestMetrics.humidity (METRIC_KEYS.humidity).
  //   - agregados: aggregatedMetrics.averageHumidity e todayDewPointStats (dew point médio/min) usados em conforto e alertas.
  // Vento:
  //   - instantâneo/agregado: latestMetrics.wind, todayWindStats (displayWindSpeed, maxWindSpeed, maxWindGust, dominantDirection) e aggregatedMetrics.maxWindSpeed/averageWind.
  // Chuva:
  //   - chaves RAIN_PROBABILITY_KEYS e RAIN_MM_KEYS alimentam todayRainStats (rainProbability, totalRainMm, totalRainMmLast3h) e aggregatedMetrics.rainChance/rainfallSum.
  // Pressão e elétricos:
  //   - aggregatedMetrics.averagePressure, pressureTrend e lightningPotential abastecem alertas e resumo histórico.
  // Síntese geral:
  //   - dailyAlertSummary (buildDailyAlertSummary) cruza todayRainStats/todayWindStats/todayTemperatureStats para badge, summary e ações.
  // Observação sobre o card antigo:
  //   - Mostrava Conforto térmico, Risco de tempestade, Índice UV, Horas de luz, Radiação solar e Umidade do solo.
  //   - UV (aggregatedMetrics.averageUv/uv_index), horas de luz (sunshineDuration), radiação shortwave e umidade de solo quase nunca chegam com o loader CSV atual, causando valores "—".
  const aggregatedMetrics = useMemo(() => {
    const logs = historicalLogs
    const temps = logs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.temperature))
      .filter((value): value is number => value !== null)
    const humidities = logs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.humidity))
      .filter((value): value is number => value !== null)
    const winds = logs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.wind))
      .filter((value): value is number => value !== null)
    const rainChances = logs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.rain))
      .filter((value): value is number => value !== null)
    const uvIndexes = logs
      .map((log) => parseMetric(log.metrics?.uv_index as string | number | undefined))
      .filter((value): value is number => value !== null)
    const sunshine = logs
      .map((log) => parseMetric(log.metrics?.sunshine_duration as string | number | undefined))
      .filter((value): value is number => value !== null)
    const shortwave = logs
      .map((log) => parseMetric(log.metrics?.shortwave_radiation as string | number | undefined))
      .filter((value): value is number => value !== null)
    const soilMoisture = logs
      .map((log) =>
        readMetricValue(log.metrics, [
          'soil_moisture_0_to_7cm',
          'soil_moisture_0_to_1cm',
          'soil_moisture_1_to_3cm',
          'soil_moisture_3_to_9cm',
        ]),
      )
      .filter((value): value is number => value !== null)
    const dewPoints: number[] = []
    for (const log of logs) {
      const dp = getDewPointForLog(log)
      if (dp !== null) {
        dewPoints.push(dp)
      }
    }
    const pressureValues = logs
      .map((log) =>
        findMetricValue(log.metrics, [/pressure(_|-)?(msl)?/i, /pressure/i]),
      )
      .filter((value): value is number => value !== null)
    const lightningIndexes = logs
      .map((log) =>
        findMetricValue(log.metrics, [/lightning/i, /convective/i, /electricity/i, /storm/i]),
      )
      .filter((value): value is number => value !== null)
    const windDirections = logs
      .map((log) => findMetricValue(log.metrics, [/wind[_-]?dir/i, /wind[_-]?direction/i]))
      .filter((value): value is number => value !== null)
    const rainfallAmounts = logs
      .map((log) => readMetricValue(log.metrics, RAIN_MM_KEYS))
      .filter((value): value is number => value !== null)
    const totalRainfall =
      rainfallAmounts.length > 0
        ? rainfallAmounts.reduce((acc, value) => acc + value, 0)
        : undefined

    const avgTemp =
      temps.length > 0 ? temps.reduce((acc, value) => acc + value, 0) / temps.length : undefined
    const avgHumidity =
      humidities.length > 0 ? humidities.reduce((acc, value) => acc + value, 0) / humidities.length : undefined
    const avgUv =
      uvIndexes.length > 0 ? uvIndexes.reduce((acc, value) => acc + value, 0) / uvIndexes.length : undefined
    const avgSunshine =
      sunshine.length > 0 ? sunshine.reduce((acc, value) => acc + value, 0) / sunshine.length : undefined
    const avgShortwave =
      shortwave.length > 0 ? shortwave.reduce((acc, value) => acc + value, 0) / shortwave.length : undefined
    const avgSoilMoisture =
      soilMoisture.length > 0 ? soilMoisture.reduce((acc, value) => acc + value, 0) / soilMoisture.length : undefined
    const avgDewPoint =
      dewPoints.length > 0 ? dewPoints.reduce((acc, value) => acc + value, 0) / dewPoints.length : undefined
    const avgPressure =
      pressureValues.length > 0
        ? pressureValues.reduce((acc, value) => acc + value, 0) / pressureValues.length
        : undefined

    return {
      averageTemperature: avgTemp ?? remoteInsights?.averageTemperature,
      averageHumidity: avgHumidity ?? remoteInsights?.averageHumidity,
      minTemperature:
        temps.length ? Math.min(...temps) : remoteInsights?.minTemperature,
      maxTemperature:
        temps.length ? Math.max(...temps) : remoteInsights?.maxTemperature,
      maxWindSpeed: winds.length ? Math.max(...winds) : remoteInsights?.maxWindSpeed,
      rainChance: rainChances.length
        ? Math.max(...rainChances)
        : remoteInsights?.rainAlert
        ? 45
        : undefined,
      averageUv: avgUv,
      sunshineDuration: avgSunshine,
      shortwaveRadiation: avgShortwave,
      soilMoistureTop: avgSoilMoisture,
      averageWind: winds.length > 0 ? winds.reduce((acc, value) => acc + value, 0) / winds.length : undefined,
      dewPointAverage: avgDewPoint,
      averagePressure: avgPressure,
      pressureTrend:
        pressureValues.length > 1 ? pressureValues[0] - pressureValues[pressureValues.length - 1] : undefined,
      dominantWindDirection: computeDominantWindDirection(windDirections),
      rainOccurrences: rainfallAmounts.filter((value) => value > 0).length,
      rainfallSum: totalRainfall,
      lightningPotential: lightningIndexes.length ? Math.max(...lightningIndexes) : undefined,
    }
  }, [historicalLogs, remoteInsights])

  const rainDataContext = useMemo<StatsContext<TodayRainStats>>(() => {
    const stats = todayRainStats ?? null
    if (stats && stats.hasSufficientSamples) {
      return {
        stats,
        hasCoverage: true,
        isFallback: false,
        fallbackSourceLabel: null,
        isDataSparse: false,
      }
    }
    if (tomorrowForecast.hasData) {
      const fallback = createRainFallbackStats(
        tomorrowForecast.rainProbMax ?? null,
        tomorrowForecast.rainMmTotal ?? null,
      )
      if (fallback) {
        return {
          stats: fallback,
          hasCoverage: true,
          isFallback: true,
          fallbackSourceLabel: 'previsão de amanhã',
          isDataSparse: true,
        }
      }
    }
    const aggregatedRainTotal =
      typeof aggregatedMetrics.rainfallSum === 'number' && Number.isFinite(aggregatedMetrics.rainfallSum)
        ? Math.min(Math.max(aggregatedMetrics.rainfallSum, 0), DAILY_RAIN_HIGH_MM)
        : null
    const aggregatedFallback = createRainFallbackStats(
      aggregatedMetrics.rainChance ?? null,
      aggregatedRainTotal,
    )
    if (aggregatedFallback) {
      return {
        stats: aggregatedFallback,
        hasCoverage: true,
        isFallback: true,
        fallbackSourceLabel: 'dados agregados',
        isDataSparse: true,
      }
    }
    return {
      stats,
      hasCoverage: false,
      isFallback: false,
      fallbackSourceLabel: null,
      isDataSparse: true,
    }
  }, [
    aggregatedMetrics.rainChance,
    aggregatedMetrics.rainfallSum,
    todayRainStats,
    tomorrowForecast.hasData,
    tomorrowForecast.rainProbMax,
    tomorrowForecast.rainMmTotal,
  ])

  const windDataContext = useMemo<StatsContext<TodayWindStats>>(() => {
    const stats = todayWindStats ?? null
    if (stats && stats.hasSufficientSamples) {
      return {
        stats,
        hasCoverage: true,
        isFallback: false,
        fallbackSourceLabel: null,
        isDataSparse: false,
      }
    }
    if (tomorrowForecast.hasData) {
      const fallback = createWindFallbackStats(
        tomorrowForecast.windSpeedMax ?? null,
        tomorrowForecast.windGustMax ?? null,
        tomorrowForecast.windDir ?? aggregatedMetrics.dominantWindDirection ?? null,
      )
      if (fallback) {
        return {
          stats: fallback,
          hasCoverage: true,
          isFallback: true,
          fallbackSourceLabel: 'previsão de amanhã',
          isDataSparse: true,
        }
      }
    }
    const aggregatedFallback = createWindFallbackStats(
      aggregatedMetrics.averageWind ?? aggregatedMetrics.maxWindSpeed ?? null,
      aggregatedMetrics.maxWindSpeed ?? null,
      aggregatedMetrics.dominantWindDirection ?? null,
    )
    if (aggregatedFallback) {
      return {
        stats: aggregatedFallback,
        hasCoverage: true,
        isFallback: true,
        fallbackSourceLabel: 'dados agregados',
        isDataSparse: true,
      }
    }
    return {
      stats,
      hasCoverage: false,
      isFallback: false,
      fallbackSourceLabel: null,
      isDataSparse: true,
    }
  }, [
    aggregatedMetrics.averageWind,
    aggregatedMetrics.dominantWindDirection,
    aggregatedMetrics.maxWindSpeed,
    todayWindStats,
    tomorrowForecast.hasData,
    tomorrowForecast.windDir,
    tomorrowForecast.windGustMax,
    tomorrowForecast.windSpeedMax,
  ])

  const latestMetricDewPoint = parseMetric(latestLog?.metrics?.dew_point as string | number | undefined)
  const latestMetaDewPoint = parseMetric(latestLog?.meta?.dew_point)
  const dayMinTemperature = todayTemperatureStats.min ?? aggregatedMetrics.minTemperature ?? null
  const dayMaxTemperature = todayTemperatureStats.max ?? aggregatedMetrics.maxTemperature ?? null
  const dayAmplitude =
    dayMinTemperature !== null && dayMaxTemperature !== null
      ? dayMaxTemperature - dayMinTemperature
      : null
  const dayDewPointValue =
    todayDewPointStats.count >= MIN_DEWPOINT_SAMPLES && todayDewPointStats.average != null
      ? todayDewPointStats.average
      : aggregatedMetrics.dewPointAverage ??
        latestMetricDewPoint ??
        latestMetaDewPoint ??
        null
  const latestTodayLog = todayLogs[todayLogs.length - 1] ?? latestLog
  const daySunrise = latestTodayLog?.meta?.sunrise ?? latestLog?.meta?.sunrise ?? null
  const daySunset = latestTodayLog?.meta?.sunset ?? latestLog?.meta?.sunset ?? null

  const latestRainChance = useMemo(() => {
    const fromLatestMetrics =
      typeof latestMetrics.rain === 'number' && Number.isFinite(latestMetrics.rain) ? latestMetrics.rain : null
    const fromLatestLog = readMetricValue(latestLog?.metrics, RAIN_PROBABILITY_KEYS)
    const candidate = fromLatestMetrics ?? fromLatestLog
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      return null
    }
    return Math.min(100, Math.max(0, candidate))
  }, [latestLog, latestMetrics.rain])

  const latestRainMm = useMemo(() => {
    const mm = readMetricValue(latestLog?.metrics, RAIN_MM_KEYS)
    return typeof mm === 'number' && Number.isFinite(mm) ? mm : null
  }, [latestLog])

  const hasRainAnimation = useMemo(() => {
    if (!latestLog) return false

    const prob = latestRainChance
    const mmNow = latestRainMm
    const recentMm = todayRainStats.totalRainMmLast3h ?? null

    const highProb = prob != null && prob >= RAIN_ANIM_HIGH_PROB
    const mediumProbAndRain =
      prob != null &&
      prob >= RAIN_ANIM_LOW_PROB &&
      prob < RAIN_ANIM_HIGH_PROB &&
      mmNow != null &&
      mmNow >= RAIN_ANIM_MIN_INTENSITY_MM

    const recentRain = recentMm != null && recentMm >= RAIN_ANIM_RECENT_MM

    return highProb || mediumProbAndRain || recentRain
  }, [latestLog, latestRainChance, latestRainMm, todayRainStats])

  useEffect(() => {
    if (import.meta.env.NODE_ENV !== 'development') {
      return
    }
    console.debug('Nimbus diagnostics (today)', {
      todayLocal: `Hoje (local): ${formatLocalDayKey(latestLog?.timestamp, DASHBOARD_TIMEZONE) ?? '—'}`,
      wind: {
        current: todayWindStats.currentWindSpeed,
        maxSpeed: todayWindStats.maxWindSpeed,
        maxGust: todayWindStats.maxWindGust,
        gustsCount: todayWindStats.gustsValidCount,
        medianSpeed: todayWindStats.medianSpeed,
        displayWindSpeed: todayWindStats.displayWindSpeed,
        medianRecentSpeed: todayWindStats.medianRecentSpeed,
        recentSpeedsCount: todayWindStats.recentSpeedsCount,
      },
      rain: {
        totalMm: todayRainStats.totalRainMm,
        probability: todayRainStats.rainProbability,
        probabilityCount: todayRainStats.rainProbabilityCount,
        totalSlots: todayRainStats.totalSlots,
        rainySlots: todayRainStats.rainySlots,
        recentMm3h: todayRainStats.totalRainMmLast3h,
        description: describeTodayRainStatus(todayRainStats),
        hasRainEvents: todayRainStats.hasRainEvents,
      },
      humidity: latestHumidity,
    })
    if (import.meta.env.MODE === 'development') {
      console.debug('[Nimbus][DewPoint]', {
        todayCount: todayDewPointStats.count,
        todayAverage: todayDewPointStats.average,
        todayMin: todayDewPointStats.min,
        dayDewPointValue,
      })
      console.debug('[Nimbus][Rain]', {
        hasRainAnimation,
        latestRainChance,
        latestRainMm,
        rainProbability: todayRainStats.rainProbability,
        totalRainMm: todayRainStats.totalRainMm,
        rainySlots: todayRainStats.rainySlots,
        totalRainMmLast3h: todayRainStats.totalRainMmLast3h,
        recentWindowMs: RAIN_RECENT_WINDOW_MS,
      })
    }
  }, [
    latestLog,
    todayWindStats,
    todayRainStats,
    latestHumidity,
    todayDewPointStats,
    dayDewPointValue,
    hasRainAnimation,
    latestRainChance,
    latestRainMm,
  ])
  const availableRainChance = aggregatedMetrics.rainChance ?? latestMetrics.rain ?? null
  const rainChanceForLogic = availableRainChance ?? 0
  const referenceTime = latestLog ? new Date(latestLog.timestamp) : new Date()
  const latestCloudCover = readMetricValue(latestLog?.metrics, ['cloud_cover', 'cloudcover', 'clouds'])
  const isDaytimeNow = determineDaytime(referenceTime, latestLog?.meta?.sunrise, latestLog?.meta?.sunset)
  const weatherAnimation = useMemo(
    () =>
      pickWeatherAnimation({
        isDaytime: isDaytimeNow,
        hasRain: hasRainAnimation,
        cloudCover: latestCloudCover,
      }),
    [isDaytimeNow, hasRainAnimation, latestCloudCover],
  )

  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!effectiveLogs.length) {
      return []
    }
    const option =
      CHART_HISTORY_OPTIONS.find((item) => item.value === chartWindow) ??
      CHART_HISTORY_OPTIONS[2]
    const now = Date.now()
    const since = option.hours ? now - option.hours * 60 * 60 * 1000 : undefined
    const sorted = [...effectiveLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    const filtered = since
      ? sorted.filter((log) => new Date(log.timestamp).getTime() >= since)
      : sorted
    const unique = filtered.filter((log, index) => {
      if (index === 0) {
        return true
      }
      const prev = filtered[index - 1]
      return log.timestamp !== prev.timestamp
    })
    const points = unique.map((log) => {
      const date = new Date(log.timestamp)
      const localDate = date
        .toLocaleDateString('pt-BR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/')
        .reverse()
        .join('-') // from dd/MM/yyyy to yyyy-mm-dd
      return {
        time: date.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        timeLabel: date.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        dateTimeLabel: `${date.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
        })} ${date.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        dateLabel: date.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
        }),
        localDate,
        timestamp: log.timestamp,
        timestampMs: new Date(log.timestamp).getTime(),
        temperature: readMetricValue(log.metrics, METRIC_KEYS.temperature) ?? null,
        humidity: readMetricValue(log.metrics, METRIC_KEYS.humidity) ?? null,
        wind: readMetricValue(log.metrics, METRIC_KEYS.wind) ?? null,
      }
    })
    return points.length > MAX_CHART_POINTS ? downsampleChartPoints(points, MAX_CHART_POINTS) : points
  }, [effectiveLogs, chartWindow])

  const chartSeries = useMemo<LineSeries[]>(() => {
    const base = metricSeriesConfig.map((metric) => {
      const data = chartData
        .map((point) => {
          const value = point[metric.key as keyof ChartDataPoint]
          if (typeof value !== 'number') {
            return null
          }
          return {
            x: point.timeLabel,
            y: value,
            timestamp: point.timestamp,
          }
        })
        .filter((entry): entry is ChartSeriesDatum => entry !== null)

      return {
        id: metric.id,
        key: metric.key,
        color: metric.color,
        data,
      }
    })

    return base.map((series) => {
      const id = series.key as MetricSeriesId
      const mergedData = mergeNearbyPoints(id, series.data as ChartPoint[], chartWindow)
      return {
        ...series,
        data: mergedData,
      }
    })
  }, [chartData, chartWindow])

  const chartDataMap = useMemo(() => {
    const map = new Map<string, ChartDataPoint>()
    chartData.forEach((point) => {
      if (point.timestamp) {
        map.set(point.timestamp, point)
      }
    })
    return map
  }, [chartData])

  const chartTickValues = useMemo(
    () =>
      buildTimeAxisTicks(
        chartSeries[0]?.data as ChartSeriesDatum[] | undefined,
        chartWindow,
      ),
    [chartSeries, chartWindow],
  )

  const chartColorAccessor = useCallback(
    (serie: { id: string | number }) =>
      metricSeriesConfig.find((metric) => metric.id === serie.id)?.color ?? '#38BDF8',
    [],
  )

  const chartTooltipRenderer = useCallback(
    (props: PointTooltipProps<LineSeries>) => (
      <ChartTooltip
        {...props}
        isDark={isDark}
        dataPoint={chartDataMap.get(
          (props.point.data as { timestamp?: string }).timestamp ?? '',
        )}
      />
    ),
    [chartDataMap, isDark],
  )

  function buildTimeAxisTicks(
    points: ChartSeriesDatum[] | undefined,
    windowValue: ChartHistoryValue,
  ): Array<string | number> | undefined {
    if (!points || !points.length) {
      return undefined
    }
    const total = points.length
    const desired = (() => {
      switch (windowValue) {
        case '3h':
          return Math.min(total, total)
        case '6h':
          return Math.ceil(total / 2)
        case '24h':
          return Math.min(8, total)
        default:
          return Math.min(8, total)
      }
    })()
    if (desired >= total || desired <= 0) {
      return undefined
    }
    const step = Math.max(1, Math.floor(total / desired))
    const ticks: Array<string | number> = []
    for (let index = 0; index < total; index += step) {
      ticks.push(points[index].x)
    }
    const last = points[total - 1].x
    if (ticks[ticks.length - 1] !== last) {
      ticks.push(last)
    }
    return ticks
  }

  const sparklineData = useMemo<SparklineData | null>(() => {
    if (!effectiveLogs.length) {
      return null
    }
    const points: SparklinePoint[] = effectiveLogs
      .map((log) => {
        const value = readMetricValue(log.metrics, METRIC_KEYS.temperature)
        if (value === null) {
          return null
        }
        const timestamp = new Date(log.timestamp).getTime()
        if (Number.isNaN(timestamp)) {
          return null
        }
        return { timestamp, temperature: value }
      })
      .filter((entry): entry is SparklinePoint => entry !== null)
      .sort((a, b) => a.timestamp - b.timestamp)

    if (!points.length) {
      return null
    }

    const sampled = downsampleSparklinePoints(points, MAX_SPARKLINE_POINTS)
    const sparklinePoints = densifySparklinePoints(sampled, MAX_SPARKLINE_POINTS)
    const smoothedPoints = smoothSparklinePoints(sparklinePoints, SPARKLINE_SMOOTH_PASSES)
    const temperatures = smoothedPoints.map((point) => point.temperature)
    const minTemp = Math.min(...temperatures)
    const maxTemp = Math.max(...temperatures)
    const isFlat = minTemp === maxTemp
    const span = isFlat ? 1 : maxTemp - minTemp

    const denominator = smoothedPoints.length > 1 ? smoothedPoints.length - 1 : 1
    const verticalPadding = SPARKLINE_HEIGHT * SPARKLINE_VERTICAL_PADDING
    const drawingHeight = SPARKLINE_HEIGHT - verticalPadding * 2
    const coordinates = smoothedPoints.map((point, index) => {
      const ratio = index / denominator
      const x = ratio * sparklineRenderWidth
      const normalized = (point.temperature - minTemp) / span
      const y = verticalPadding + (1 - normalized) * drawingHeight
      return { x, y }
    })
  const pathD = isFlat
      ? `M0,${(SPARKLINE_HEIGHT / 2).toFixed(2)} L${sparklineRenderWidth},${(SPARKLINE_HEIGHT / 2).toFixed(2)}`
      : buildSmoothPath(coordinates, SPARKLINE_TENSION)

    const stops =
      smoothedPoints.length === 1
        ? [
            { offset: 0, color: tempToColor(smoothedPoints[0].temperature, isDark) },
            { offset: 100, color: tempToColor(smoothedPoints[0].temperature, isDark) },
          ]
        : smoothedPoints.map((point, index) => {
            const offset = (index / denominator) * 100
            return { offset, color: tempToColor(point.temperature, isDark) }
          })

    return { pathD, stops }
  }, [effectiveLogs, isDark, sparklineRenderWidth])

  const calendarBuckets = useMemo<CalendarBucket[]>(() => {
    if (!historicalLogs.length) {
      return []
    }
    const historical = buildHistoricalBucketsFromLogs(historicalLogs)
    return buildCalendarBuckets(historical)
  }, [historicalLogs])

  useEffect(() => {
    if (!import.meta.env.PROD && calendarBuckets.length) {
      console.log('[dev] Rain buckets last 31 days:', {
        thresholdsMm: {
          heatmap: HEATMAP_RAINY_DAY_THRESHOLD_MM,
          text: RAINY_DAY_TEXT_THRESHOLD_MM,
        },
        buckets: calendarBuckets.map((bucket) => ({
          date: bucket.date,
          rainSum: bucket.rainSum,
        })),
      })
    }
  }, [calendarBuckets])

  useEffect(() => {
    if (!calendarBuckets.length) {
      setHeatmapColumns(0)
    }
  }, [calendarBuckets.length])

  const calendarDaysCount = useMemo(() => {
    if (!calendarBuckets.length) {
      return 0
    }
    return new Set(calendarBuckets.map((bucket) => bucket.date)).size
  }, [calendarBuckets])

  // Texto do histórico usa um limiar mais alto para considerar o dia como "chuvoso"
  const rainyDaysCountSignificant = useMemo(() => {
    if (calendarBuckets.length === 0) {
      return 0
    }

    const dailyRainByDate = new Map<string, number>()

    for (const bucket of calendarBuckets) {
      const dateKey = bucket.date
      const rain = bucket.rainSum ?? 0
      if (!dateKey || rain <= 0) {
        continue
      }
      const current = dailyRainByDate.get(dateKey) ?? 0
      dailyRainByDate.set(dateKey, current + rain)
    }

    let rainyDays = 0
    for (const totalRain of dailyRainByDate.values()) {
      if (totalRain >= RAINY_DAY_TEXT_THRESHOLD_MM) {
        rainyDays += 1
      }
    }

    return rainyDays
  }, [calendarBuckets])


  const latestTimestamp = latestLog?.timestamp
  const freshnessMinutes = latestTimestamp
    ? Math.max(Math.floor((Date.now() - new Date(latestTimestamp).getTime()) / 60000), 0)
    : null
  const pipelineStatus = useMemo(() => {
    if (!latestLog) {
      return {
        label: 'Sem registros recentes',
        detail: 'Aguardando o primeiro log meteorológico.',
      }
    }
    if (freshnessMinutes === null) {
      return {
        label: 'Sincronizando',
        detail: 'Buscando os últimos dados disponíveis.',
      }
    }
    if (freshnessMinutes >= 20) {
      return {
        label: 'Pipeline pausado',
        detail: 'Mais de 20 minutos desde o último log.',
      }
    }
    if (freshnessMinutes >= 5) {
      return {
        label: 'Pipeline lento',
        detail: 'Dados chegando com leve atraso.',
      }
    }
    return {
      label: 'Pipeline ativo',
      detail: `Último log às ${formatTime(latestTimestamp!)}`,
    }
  }, [freshnessMinutes, latestLog, latestTimestamp])

  const streamingStatus = freshnessMinutes === null
    ? 'Sincronizando'
    : freshnessMinutes >= 20
    ? 'Streaming pausado'
    : freshnessMinutes >= 5
    ? 'Streaming lento'
    : 'Streaming nominal'

  const comfortIndex = useMemo(() => {
    const latestTemp = latestMetrics.temperature
    const latestHumidity = latestMetrics.humidity
    if (
      typeof latestTemp === 'number' &&
      Number.isFinite(latestTemp) &&
      typeof latestHumidity === 'number' &&
      Number.isFinite(latestHumidity)
    ) {
      return computeHeatIndex(latestTemp, latestHumidity)
    }
    const recentLogs = todayLogs.slice(-4)
    const tempValues = recentLogs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.temperature))
      .filter((value): value is number => typeof value === 'number')
    const humidityValues = recentLogs
      .map((log) => readMetricValue(log.metrics, METRIC_KEYS.humidity))
      .filter((value): value is number => typeof value === 'number')
    if (tempValues.length && humidityValues.length) {
      const avgTemp = tempValues.reduce((acc, value) => acc + value, 0) / tempValues.length
      const avgHumidity = humidityValues.reduce((acc, value) => acc + value, 0) / humidityValues.length
      return computeHeatIndex(avgTemp, avgHumidity)
    }
    if (
      typeof aggregatedMetrics.averageTemperature === 'number' &&
      Number.isFinite(aggregatedMetrics.averageTemperature) &&
      typeof aggregatedMetrics.averageHumidity === 'number' &&
      Number.isFinite(aggregatedMetrics.averageHumidity)
    ) {
      return computeHeatIndex(aggregatedMetrics.averageTemperature, aggregatedMetrics.averageHumidity)
    }
    return null
  }, [
    aggregatedMetrics.averageHumidity,
    aggregatedMetrics.averageTemperature,
    latestMetrics.humidity,
    latestMetrics.temperature,
    todayLogs,
  ])
  const comfortDescriptor = useMemo(() => describeHeatComfort(comfortIndex), [comfortIndex])

  const recentRainProb =
    (rainDataContext.hasCoverage ? rainDataContext.stats?.rainProbability ?? null : null) ??
    todayRainStats.rainProbability ??
    latestMetrics.rain ??
    null
  const recentGust =
    (windDataContext.hasCoverage
      ? windDataContext.stats?.maxWindGust ?? windDataContext.stats?.maxWindSpeed ?? null
      : null) ??
    todayWindStats.maxWindGust ??
    todayWindStats.maxWindSpeed ??
    (typeof latestMetrics.wind === 'number' && Number.isFinite(latestMetrics.wind) ? latestMetrics.wind : null)
  const stormRiskLabel = useMemo(
    () => describeStormRisk(recentRainProb, recentGust),
    [recentRainProb, recentGust],
  )

  const dailyAlertSummary = useMemo(
    () =>
      buildDailyAlertSummary({
        todayRainStats,
        todayWindStats,
        todayTemperatureStats,
        rainContext: rainDataContext,
        windContext: windDataContext,
      }),
    [rainDataContext, todayRainStats, todayTemperatureStats, todayWindStats, windDataContext],
  )

  const activityAdvice = useMemo(() => {
    const wind = latestMetrics.wind ?? aggregatedMetrics.maxWindSpeed ?? 0
    const temp = latestMetrics.temperature ?? aggregatedMetrics.averageTemperature ?? null

    if (dailyAlertSummary.hasRain && dailyAlertSummary.level === 'high') {
      return {
        title: 'Chuva intensa hoje',
        detail: 'Hoje não é um bom dia para atividades indoor; leve capa ou guarda-chuva',
        tone: 'destructive',
      }
    }
    if (dailyAlertSummary.hasRain && dailyAlertSummary.level === 'moderate') {
      return {
        title: 'Chance maior de chuva hoje',
        detail: 'Possibilidade de pancadas ao longo do dia — planeje com rotas cobertas.',
        tone: 'warning',
      }
    }
    if (dailyAlertSummary.hasRain && dailyAlertSummary.level === 'low') {
      return {
        title: 'Possibilidade de chuva isolada',
        detail: 'Acompanhe o painel; pode haver pancadas rápidas em pontos específicos.',
        tone: 'muted',
      }
    }

    if (wind >= WEATHER_THRESHOLDS.wind.gustStrong) {
      return {
        title: 'Ventos fortes',
        detail: 'Cuidado com objetos soltos e prefira ambientes abrigados',
        tone: 'warning',
      }
    }
    const rainPct = rainChanceForLogic
    if (temp !== null && temp >= 28 && rainPct <= 30) {
      return {
        title: 'Bom dia para praia ou corrida',
        detail: 'Alta temperatura com pouca chance de chuva combina com atividades externas cedo',
        tone: 'success',
      }
    }
    if (temp !== null && temp <= 18) {
      return {
        title: 'Clima fresco',
        detail: 'Vale usar um agasalho leve e aproveitar o tempo para caminhar',
        tone: 'muted',
      }
    }
    return {
      title: 'Dia estável',
      detail: 'Nenhum alerta detectado; adapte-se conforme suas preferências',
      tone: 'neutral',
    }
  }, [
    aggregatedMetrics.averageTemperature,
    aggregatedMetrics.maxWindSpeed,
    dailyAlertSummary.hasRain,
    dailyAlertSummary.level,
    latestMetrics.temperature,
    latestMetrics.wind,
    rainChanceForLogic,
  ])

  // Micro-indicator now consome dailyAlertSummary/activityAdvice para
  // manter a mesma leitura de risco usada pelos alertas e pelo Climo,
  // evitando divergências com o card de previsão para amanhã.
  const microIndicator = useMemo(() => {
    if (stormRiskLabel.level !== 'stable') {
      return {
        icon: CloudRain,
        label: stormRiskLabel.text ?? 'Alerta ativo',
      }
    }
    if (activityAdvice.tone !== 'neutral') {
      return {
        icon: activityAdvice.tone === 'warning' ? Wind : Thermometer,
        label: activityAdvice.title,
      }
    }
    if (
      latestTemp !== null &&
      aggregatedMetrics.averageTemperature !== undefined
    ) {
      const delta = latestTemp - aggregatedMetrics.averageTemperature
      if (Math.abs(delta) >= 0.8) {
        return {
          icon: delta > 0 ? ArrowUp : ArrowDown,
          label: delta > 0 ? 'Aquecimento em curso' : 'Resfriamento em curso',
        }
      }
    }
    return null
  }, [
    activityAdvice.title,
    activityAdvice.tone,
    aggregatedMetrics.averageTemperature,
    latestTemp,
    stormRiskLabel,
  ])

  const hasSufficientTodayData = useMemo(() => {
    if (!todayLogs.length) {
      return false
    }
    if (todayRainStats.hasSufficientSamples || todayWindStats.hasSufficientSamples) {
      return true
    }
    return (todayTemperatureStats.count ?? 0) > 0
  }, [
    todayLogs.length,
    todayRainStats.hasSufficientSamples,
    todayWindStats.hasSufficientSamples,
    todayTemperatureStats.count,
  ])


  const rainRiskDescriptor = useMemo(
    () =>
      describeDailyRainRisk(
        todayRainStats,
        latestRainChance,
        aggregatedMetrics.rainChance ?? null,
      ),
    [aggregatedMetrics.rainChance, latestRainChance, todayRainStats],
  )

  const windRiskDescriptor = useMemo(
    () =>
      describeDailyWindRisk(
        todayWindStats,
        aggregatedMetrics.maxWindSpeed ?? aggregatedMetrics.averageWind ?? null,
      ),
    [aggregatedMetrics.averageWind, aggregatedMetrics.maxWindSpeed, todayWindStats],
  )

  const pressureDescriptor = useMemo(
    () =>
      describePressureStability(
        aggregatedMetrics.averagePressure ?? null,
        aggregatedMetrics.pressureTrend ?? null,
      ),
    [aggregatedMetrics.averagePressure, aggregatedMetrics.pressureTrend],
  )

  const dayNarrative = useMemo(() => {
    if (!todayLogs.length) {
      return 'Sem dados suficientes para resumir o dia de hoje.'
    }
    const { rain, wind } = WEATHER_THRESHOLDS
    const probability = todayRainStats.rainProbability ?? 0
    const totalRain = todayRainStats.totalRainMm ?? 0
    const maxWindSpeed = todayWindStats.maxWindSpeed ?? todayWindStats.displayWindSpeed ?? 0
    const maxGust = todayWindStats.maxWindGust ?? todayWindStats.currentWindGust ?? 0
    const limitedSamples = todayLogs.length > 0 && todayLogs.length < 3

    if (totalRain >= rain.mmHeavy || (probability >= rain.chanceAlert && totalRain >= rain.mmLight)) {
      return `Dia chuvoso, com cerca de ${totalRain.toFixed(1)} mm acumulados e chance de chuva em torno de ${Math.round(probability)}% ao longo de hoje.`
    }
    if (maxGust >= wind.gustStrong || maxWindSpeed >= wind.speedStrong) {
      const reference = Math.max(maxGust, maxWindSpeed)
      return `Dia ventoso, com rajadas chegando a cerca de ${Math.round(reference)} km/h.`
    }
    const stableText = 'Dia estável, sem chuva relevante ou ventos fortes.'
    return limitedSamples ? `${stableText} Os valores ainda podem mudar ao longo do dia.` : stableText
  }, [
    todayLogs.length,
    todayRainStats.totalRainMm,
    todayRainStats.rainProbability,
    todayWindStats.maxWindSpeed,
    todayWindStats.displayWindSpeed,
    todayWindStats.maxWindGust,
    todayWindStats.currentWindGust,
  ])

  const climoContext = useMemo<ClimoInsightContext>(
    () => ({
      dayNarrative,
      dailyAlertSummary,
      heatComfort: comfortDescriptor,
      tomorrowSummary,
      hasSufficientTodayData,
    }),
    [comfortDescriptor, dailyAlertSummary, dayNarrative, hasSufficientTodayData, tomorrowSummary],
  )

  const rainProbabilityLabel =
    todayRainStats.rainProbability !== null
      ? `${Math.round(todayRainStats.rainProbability)}%`
      : '—'
  const rainAccumulatedLabel =
    todayRainStats.totalRainMm > 0
      ? `Acumulado de ${todayRainStats.totalRainMm.toFixed(1)} mm hoje`
      : rainRiskDescriptor.detail
  const windDisplayValue =
    todayWindStats.displayWindSpeed ?? windRiskDescriptor.value ?? null
  const windValueText =
    windDisplayValue !== null ? `${windDisplayValue.toFixed(1)} km/h` : '—'
  const windDetailText =
    todayWindStats.maxWindGust !== null
      ? `Rajadas até ${todayWindStats.maxWindGust.toFixed(0)} km/h`
      : windRiskDescriptor.detail
  const dominantWindDirectionDisplay = getWindDirectionDisplay(todayWindStats.dominantDirection)

  // Theme helpers
  const primaryGlassSurface = cn(
    'backdrop-blur-3xl border',
    isDark
      ? 'bg-[color:var(--surface-card-primary-dark)] border-white/5'
      : 'bg-[color:var(--surface-card-primary-light)] border-white/30',
  )
  const secondaryGlassSurface = cn(
    'backdrop-blur-[32px] border',
    isDark
      ? 'bg-[color:var(--surface-card-secondary-dark)] border-white/4'
      : 'bg-[color:var(--surface-card-secondary-light)] border-white/25',
  )
  const cardShadowStrong = isDark
    ? 'shadow-[0_25px_55px_rgba(2,6,23,0.45)]'
    : 'shadow-[0_18px_48px_rgba(15,23,42,0.12)]'
  const cardShadowSoft = isDark
    ? 'shadow-[0_18px_38px_rgba(2,6,23,0.36)]'
    : 'shadow-[0_16px_30px_rgba(15,23,42,0.12)]'
  const darkSurfaceClass = 'bg-[#05070D]'
  const lightSurfaceClass = 'bg-[#F6F8FB]'

  const mainClass = 'min-h-screen px-4 py-8 lg:py-10 transition-colors duration-500'

  const condCardBackdrop = cn('rounded-2xl px-6 py-6 lg:px-8 lg:py-7', primaryGlassSurface, cardShadowStrong)

  const primaryTextClass = isDark ? 'text-slate-50' : 'text-[#1F2937]'
  const secondaryTextClass = isDark ? 'text-slate-200' : 'text-[#6B7280]'
  const tertiaryTextClass = cn(isDark ? 'text-slate-300' : 'text-[#6B7280]')
  const iconColorClass = isDark ? 'text-slate-100' : 'text-[#1F2937]'
  const headerGlassClass = cn('rounded-2xl px-6 py-5 lg:px-8 lg:py-6', primaryGlassSurface, cardShadowStrong)
  const windIconClass = cn('h-5 w-5', tertiaryTextClass)

  const sectionCardClass = cn('rounded-2xl p-6', primaryGlassSurface, cardShadowStrong)
  const panelCardClass = cn('rounded-2xl p-4', secondaryGlassSurface, cardShadowSoft)
const historicalCardBaseClass = 'rounded-2xl p-6 space-y-3'
const historicalCardClass = cn(historicalCardBaseClass, secondaryGlassSurface, cardShadowSoft)
const historicalSummaryCardClass = isDark
  ? cn(historicalCardBaseClass, 'backdrop-blur-3xl bg-[color:var(--surface-card-secondary-dark)]', cardShadowSoft)
  : historicalCardClass
const heatmapWrapperClass = cn(panelCardClass, 'space-y-2 p-4')
const indexMiniCardClass = cn(historicalCardClass, 'flex flex-col md:min-h-[174px]')
  const chartContainerClass = cn('mt-6 h-64 w-full rounded-2xl px-5 py-4', secondaryGlassSurface, cardShadowSoft)
  const microLabelClass = 'text-label tracking-tight'
  const microValueBaseClass = 'font-heading tracking-tight leading-[1.15] tabular-nums'
  const mutedForegroundClass = isDark ? 'text-white/70' : 'text-muted-foreground'
  const microCaptionClass = cn('text-body-sm font-body tracking-tight', mutedForegroundClass)
  const bodyTextClass = cn('text-body font-body leading-relaxed', isDark ? 'text-slate-100' : 'text-[#1F2937]')
  const dataSourceBadgeClass = cn(
    'inline-flex items-center rounded-full border px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.32em]',
    isDark ? 'border-white/15 bg-white/5 text-white/70' : 'border-slate-200 bg-white text-slate-500',
  )
  const statusInfoCardClass = cn('rounded-xl p-4 space-y-1.5', secondaryGlassSurface, cardShadowSoft)
  const isEditingUser = Boolean(editingUserId)
  const sparklineGradientId = 'nimbus-temperature-gradient'


  const chartAxisTextColor = isDark ? '#E5E7EB' : 'hsl(var(--muted-foreground))'
  const selectedChartWindowLabel =
    CHART_HISTORY_OPTIONS.find((option) => option.value === chartWindowSelection)?.label ?? ''
  const sunriseIconWrapperClass = cn(
    'flex h-8 w-8 items-center justify-center rounded-full border shadow-sm',
    isDark
      ? 'border-white/10 bg-white/5 text-amber-200'
      : 'border-amber-300 bg-amber-50 text-amber-500',
  )
  const sunsetIconWrapperClass = cn(
    'flex h-8 w-8 items-center justify-center rounded-full border shadow-sm',
    isDark
      ? 'border-white/10 bg-white/5 text-orange-300'
      : 'border-orange-300 bg-orange-50 text-orange-500',
  )
  const chartFilterClass = (active: boolean) =>
    cn(
      'rounded-full px-4 py-1.5 text-label tracking-tight font-heading transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 border shadow-sm',
      active
        ? isDark
          ? 'bg-white text-slate-900 border-transparent shadow-[0_8px_25px_rgba(15,23,42,0.45)]'
          : 'bg-slate-900 text-white border-slate-900 shadow-[0_8px_25px_rgba(15,23,42,0.18)]'
        : isDark
          ? 'border-white/25 text-white/70 hover:border-white/40 hover:text-white'
          : 'border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-800',
    )
  const pressureTrendLabel = (() => {
    if (aggregatedMetrics.pressureTrend === undefined) {
      return 'Sem dados'
    }
    if (Math.abs(aggregatedMetrics.pressureTrend) < 0.15) {
      return 'Estável'
    }
    return aggregatedMetrics.pressureTrend > 0 ? 'Subindo' : 'Caindo'
  })()

  /*
    Performance/fluidez – sugestões aplicadas:
    1) Fundo fixo por tema, sem parallax, para evitar cálculos atrelados ao scroll.
    2) Badge de resfriamento com sombra/ring leves para reduzir overdraw quando exibida.
    3) TODO: Reduzir camadas de glass-surface em blocos largos (ex.: histórico/heatmap) se notar queda de FPS.
  */

  if (!token) {
    const authMainClass = cn(
      'flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10',
      isDark ? darkSurfaceClass : lightSurfaceClass,
    )
    const authSectionClass = cn(
      'w-full max-w-md space-y-4 rounded-xl p-8',
      primaryGlassSurface,
    )
    const authSectionStyle = {
      backgroundImage: 'var(--login-gradient)',
    }
    const authLabelClass = cn('text-body-sm tracking-tight', tertiaryTextClass)
    const loginHelperText = 'Seus dados de acesso são usados apenas para autenticação segura neste painel.'
    return (
      <main className={authMainClass}>
        <section className={authSectionClass} style={authSectionStyle}>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className={cn(microLabelClass, secondaryTextClass)}>Nimbus</p>
              <h1 className={cn('mt-3 text-3xl font-semibold font-heading', primaryTextClass)}>Acesse o Nimbus</h1>
              <p className={cn('mt-1 text-body', tertiaryTextClass)}>Painel de clima em tempo real</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className={cn(
                'rounded-sm border border-transparent p-3 transition duration-200',
                isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100',
              )}
              aria-label="Alternar tema"
            >
              {isDark ? (
                <Sun className={cn('h-4 w-4', iconColorClass)} />
              ) : (
                <Moon className={cn('h-4 w-4', iconColorClass)} />
              )}
            </Button>
          </div>

          <form className="space-y-3" onSubmit={handleLogin}>
            <div className="space-y-1">
              <Label className={authLabelClass}>Email</Label>
              <Input
                type="email"
                value={loginState.email}
                onChange={(event) => setLoginState((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="admin@example.com"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className={authLabelClass}>Senha</Label>
              <Input
                type="password"
                value={loginState.password}
                onChange={(event) => setLoginState((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="••••••"
                minLength={6}
                autoComplete="current-password"
                required
              />
            </div>
            {authError && <p className="text-body text-[#F87171]">{authError}</p>}
            <Button
              type="submit"
              disabled={authLoading}
              size="lg"
              className="w-full uppercase tracking-[0.25em]"
            >
              {authLoading ? 'Autenticando...' : 'Acessar Nimbus'}
            </Button>
        </form>
        <p className={cn('text-body-sm mt-2', tertiaryTextClass)}>{loginHelperText}</p>
      </section>
    </main>
  )
  }
  return (
    <main className={cn(mainClass, 'nimbus-scroll')} style={backgroundStyle}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:gap-7">
        <header className={cn(headerGlassClass, 'relative')}>
          {refreshHint && (
            <div className="hero-badge" role="status">
              <div className="inline-flex items-center gap-2">
                {refreshHint.tone === 'success' ? (
                  <CheckCircle2 aria-hidden className="h-4 w-4" />
                ) : (
                  <RefreshCcw aria-hidden className="h-4 w-4" />
                )}
                <span className="font-medium">{refreshHint.text}</span>
                {refreshHint.timeLabel && (
                  <span className="inline-flex items-center gap-1 text-body-sm">
                    <Clock aria-hidden className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{refreshHint.timeLabel}</span>
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-5">
                <div className="space-y-1">
                  {/* Title now uses tertiaryTextClass for stronger contrast like other section headings */}
                  <p className={cn(microLabelClass, tertiaryTextClass)}>Nimbus Dashboard</p>
                <h1
                  className={cn(
                    'font-heading text-hero tracking-tight leading-tight max-w-xl md:max-w-2xl md:text-[1.95rem] lg:text-[2rem]',
                    primaryTextClass,
                  )}
                >
                  Clima, conforto e risco — em um só lugar
                </h1>
                <p className={cn('text-body leading-[1.6]', mutedForegroundClass)}>
                  Dados atualizados automaticamente ao longo do dia.
                </p>
              </div>
              <div className="hero-actions" aria-label="Controles rápidos do painel">
                <button
                  type="button"
                  onClick={() => loadWeather(true)}
                  className="hero-icon"
                  title="Atualizar dados"
                >
                  <RefreshCcw className={cn('h-5 w-5', iconColorClass)} />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="hero-icon"
                      aria-label="Exportar dados"
                      title="Exportar dados"
                    >
                      <Download className={cn('h-5 w-5', iconColorClass)} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleExport('csv')}
                      disabled={!!exporting}
                    >
                      CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport('xlsx')}
                      disabled={!!exporting}
                    >
                      XLSX
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="hero-icon"
                  aria-label="Alternar tema"
                  title="Alternar tema"
                >
                    {isDark ? (
                      <Sun className={cn('h-5 w-5', iconColorClass)} />
                    ) : (
                      <Moon className={cn('h-5 w-5', iconColorClass)} />
                    )}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="hero-icon"
                  aria-label="Sair"
                  title="Logout"
                >
                  <LogOut className={cn('h-5 w-5', iconColorClass)} />
                </button>
              </div>
            </div>
          </div>
          {exportMessage && (
            <p className={cn('mt-3 text-body', mutedForegroundClass)}>
              {exportMessage}
            </p>
          )}
        </header>

        <section className="grid gap-6 items-start lg:grid-cols-[1.7fr_1fr]">
          <Card className={condCardBackdrop}>
            <div className="flex h-full flex-col gap-5">
              <div className="space-y-1">
                <p className={cn(microLabelClass, tertiaryTextClass)}>Condições atuais</p>
                <h2
                  className={cn('font-heading text-[2.25rem] font-semibold leading-[1.08] tracking-tight md:text-[2.75rem]',
                    primaryTextClass,
                  )}
                >
                  {latestLog?.city ?? 'Local indefinido'}
                </h2>
                <p className={cn('text-body font-medium tracking-tight', tertiaryTextClass)}>
                  {latestLog?.source ?? remoteInsights?.latestSource ?? 'Fonte desconhecida'}
                </p>
              </div>
              <div className="grid flex-1 gap-6 lg:grid-cols-[1.4fr_1fr] items-start">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-3">
                    <div className="h-40 w-40 sm:h-48 sm:w-48 lg:h-52 lg:w-52">
                      {/* perf: animação respeita reduced-motion e reduz tamanho em telas menores para menor overdraw. */}
                      <Lottie
                        className="h-full w-full"
                        animationData={weatherAnimation}
                        loop
                        autoplay
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 lg:gap-2">
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Temperatura</p>
                      <div className="flex items-baseline gap-1">
                        <Thermometer
                          className={cn('h-6 w-6 flex-none', primaryTextClass)}
                        />
                        <p
                          className={cn(
                            'text-[4rem] md:text-[4.5rem] leading-[1.08] tracking-tight font-bold',
                            microValueBaseClass,
                            primaryTextClass,
                          )}
                        >
                          {latestTemp !== null ? `${latestTemp.toFixed(1)}°C` : '—'}
                        </p>
                      </div>
                      <p className={cn('text-body leading-[1.3]', mutedForegroundClass)}>
                        {comfortIndex !== null ? `Sensação ${comfortIndex.toFixed(1)}°C` : 'Sensação indisponível'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start gap-2 py-1">
                    <Droplet className={cn('h-5 w-5 flex-none', tertiaryTextClass)} />
                    <div className="space-y-0.5">
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Umidade</p>
                      <p className={cn('text-[1.9rem] md:text-[2.15rem]', microValueBaseClass, primaryTextClass)}>
                        {latestHumidity !== null ? `${latestHumidity.toFixed(0)}%` : '—'}
                      </p>
                      <p className={cn('text-[0.65rem] leading-[1.4]', mutedForegroundClass)}>
                        {todayRainStats.rainProbability === null
                          ? 'Chance de chuva hoje: —'
                          : `Chance de chuva hoje: ${Math.round(todayRainStats.rainProbability)}%`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 py-1">
                    <Wind className={cn('h-5 w-5 flex-none', tertiaryTextClass)} />
                    <div className="space-y-0.5">
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Vento</p>
                      <p className={cn('text-[1.9rem] md:text-[2.15rem]', microValueBaseClass, primaryTextClass)}>
                        {windSpeed == null ? (
                          '—'
                        ) : windSpeed === 0 ? (
                          <span className={cn('text-body-sm', mutedForegroundClass)}>Calmaria</span>
                        ) : (
                          <>
                            {Math.round(windSpeed)}
                            <span className="ml-1 text-[0.8rem] align-baseline font-body">km/h</span>
                          </>
                        )}
                      </p>
                      <p className={cn('text-[0.65rem] leading-[1.4]', mutedForegroundClass)}>
                        {todayWindStats.maxWindGust !== null
                          ? `Rajada mais forte hoje: ${Math.round(todayWindStats.maxWindGust)} km/h${
                              dominantWindDirectionDisplay.label
                                ? ` — direção ${dominantWindDirectionDisplay.label}`
                                : ''
                            }`
                          : 'Rajadas hoje: nenhuma rajada relevante.'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-full flex flex-col gap-3">
                  {microIndicator && (
                    <div className="mt-6 flex items-center gap-2">
                      {microIndicator.icon && (
                        <microIndicator.icon className="h-4 w-4 text-slate-200" aria-hidden="true" />
                      )}
                      <p className={cn(microLabelClass, tertiaryTextClass)}>
                        Condição dominante:{' '}
                        <span className={cn('font-semibold', primaryTextClass)}>{microIndicator.label}</span>
                      </p>
                    </div>
                  )}
                  <div
                    ref={sparklineContainerRef}
                    className="relative flex h-16 w-full pt-2 items-stretch"
                    role="img"
                    aria-label="Linha suavizada mostrando a tendência térmica recente"
                  >
                    <span className="sr-only">Linha suavizada mostrando a tendência térmica recente</span>
                    <p className={cn('pointer-events-none absolute top-1 left-0 font-body text-[0.62rem] leading-[1.2]', mutedForegroundClass)}>
                      Tendência térmica
                    </p>
                    {sparklineData ? (
                      <svg
                        viewBox={`0 0 ${sparklineRenderWidth} ${SPARKLINE_HEIGHT}`}
                        aria-hidden="true"
                        className="h-full w-full"
                      >
                        <defs>
                          <linearGradient
                            id={sparklineGradientId}
                            gradientUnits="userSpaceOnUse"
                            x1="0"
                            y1="0"
                            x2={sparklineRenderWidth}
                            y2="0"
                          >
                            {sparklineData.stops.map((stop, index) => (
                              <stop
                                key={`${sparklineGradientId}-${index}`}
                                offset={`${stop.offset.toFixed(2)}%`}
                                stopColor={stop.color}
                              />
                            ))}
                          </linearGradient>
                        </defs>
                        <path
                          d={sparklineData.pathD}
                          fill="none"
                          stroke={`url(#${sparklineGradientId})`}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    ) : (
                      <div className="h-full w-full rounded-full bg-white/10" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
          <Card className={cn(panelCardClass, 'flex h-full flex-col justify-between gap-6')}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className={cn(microLabelClass, tertiaryTextClass)}>Resumo do dia</p>
              </div>
              <p className={cn(bodyTextClass, 'text-sm')}>{dayNarrative}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                  <div className="flex items-center gap-3">
                    <ArrowDown className="h-5 w-5 text-cyan-300" />
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Mínima</p>
                  </div>
                  <p
                    className={cn(
                      'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                      microValueBaseClass,
                      primaryTextClass,
                    )}
                  >
                    {dayMinTemperature !== null ? `${dayMinTemperature.toFixed(1)}°` : '—'}
                  </p>
                  <p className={microCaptionClass}>Registro mais baixo do dia</p>
                </div>
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                  <div className="flex items-center gap-3">
                    <ArrowUp className="h-5 w-5 text-amber-300" />
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Máxima</p>
                  </div>
                  <p
                    className={cn(
                      'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                      microValueBaseClass,
                      primaryTextClass,
                    )}
                  >
                    {dayMaxTemperature !== null ? `${dayMaxTemperature.toFixed(1)}°` : '—'}
                  </p>
                  <p className={microCaptionClass}>Maior registro do dia</p>
                </div>
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-5 w-5 text-emerald-300" />
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Amplitude</p>
                  </div>
                  <p
                    className={cn(
                      'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                      microValueBaseClass,
                      primaryTextClass,
                    )}
                  >
                    {dayAmplitude !== null ? `${dayAmplitude.toFixed(1)}°` : '—'}
                  </p>
                  <p className={microCaptionClass}>Diferença Máx − Mín</p>
                </div>
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                    <div className="flex items-center gap-3">
                    <Droplet className="h-5 w-5 text-sky-300" />
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Ponto de orvalho</p>
                  </div>
                  <p
                    className={cn(
                      'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                      microValueBaseClass,
                      primaryTextClass,
                    )}
                  >
                    {dayDewPointValue !== null ? `${dayDewPointValue.toFixed(1)}°` : '—'}
                  </p>
                  <p className={microCaptionClass}>Baseado nas leituras do dia</p>
                </div>
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                  <div className="flex items-center gap-3">
                    <span className={sunriseIconWrapperClass}>
                      <Sunrise className="h-4 w-4 text-inherit" />
                    </span>
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Nascer do sol</p>
                  </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {formatMetaTime(daySunrise)}
                    </p>
                  <p className={microCaptionClass}>Horário estimado</p>
                </div>
                <div className={cn('glass-surface surface-secondary rounded-2xl p-4 space-y-2')}>
                  <div className="flex items-center gap-3">
                    <span className={sunsetIconWrapperClass}>
                      <Sunset className="h-4 w-4 text-inherit" />
                    </span>
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Pôr do sol</p>
                  </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {formatMetaTime(daySunset)}
                    </p>
                  <p className={microCaptionClass}>Horas finais do dia</p>
                </div>
              </div>
            </div>
          </Card>
          <div className="lg:col-span-2">
            <ClimoAssistantCard
              context={climoContext}
              cardClassName={panelCardClass}
              microLabelClass={microLabelClass}
              tertiaryTextClass={tertiaryTextClass}
              bodyTextClass={bodyTextClass}
              mutedTextClass={cn('text-body-sm font-body', mutedForegroundClass)}
            />
          </div>
        </section>

        <section className={cn(sectionCardClass, 'p-6')}>
          <div className="flex items-center justify-between gap-6">
            <div className="space-y-1">
              <p className={cn(microLabelClass, tertiaryTextClass)}>Visualizações temporais</p>
              <h2 className="sr-only">Visualizações temporais</h2>
              <p className={cn('text-body-sm font-body', mutedForegroundClass)}>
                Tendências dinâmicas com tooltip em tempo real.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {CHART_HISTORY_OPTIONS.map((option) => {
                const isActive = option.value === chartWindowSelection
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={chartFilterClass(isActive)}
                    aria-pressed={isActive}
                    onClick={() => setChartWindowSelection(option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className={chartContainerClass}>
            {chartData.length ? (
              <Suspense
                fallback={
                  <div className={cn('flex h-full w-full items-center justify-center text-body-sm', tertiaryTextClass)}>
                    Carregando gráfico…
                  </div>
                }
              >
                <TimeSeriesChart
                  data={chartSeries}
                  tickValues={chartTickValues}
                  chartAxisTextColor={chartAxisTextColor}
                  isDark={isDark}
                  colorAccessor={chartColorAccessor}
                  tooltip={chartTooltipRenderer}
                />
              </Suspense>
            ) : (
              <div className={cn('flex h-full flex-col items-center justify-center text-body', tertiaryTextClass)}>
                <p>Carregando dados do gráfico…</p>
                <p className="text-body-sm">Recarregue ou aguarde novas leituras.</p>
              </div>
            )}
          </div>
          <p className={cn('mt-4 text-[11px] leading-snug', mutedForegroundClass)}>
            A janela escolhida ({selectedChartWindowLabel.toLowerCase()}) define o intervalo; o tooltip detalha cada leitura ao passar o mouse.
          </p>
        </section>

        <div className="space-y-6">
        <section className="grid gap-6 lg:grid-cols-2 items-stretch">
            <Card className={cn(sectionCardClass, 'flex flex-col')}>
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Resumo histórico</p>
                    <h2 className="sr-only">Resumo histórico</h2>
                  </div>
                  <span className={dataSourceBadgeClass}>Open-Meteo</span>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className={historicalSummaryCardClass}>
                    <div className="flex items-center gap-3">
                      <Thermometer className="h-5 w-5 text-amber-300" />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Temperatura</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-lg font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {aggregatedMetrics.averageTemperature?.toFixed(1) ?? '—'}°C
                    </p>
                    <p className={microCaptionClass}>
                      Min {aggregatedMetrics.minTemperature?.toFixed(1) ?? '—'}°C • Max {aggregatedMetrics.maxTemperature?.toFixed(1) ?? '—'}°C
                    </p>
                    <p className={microCaptionClass}>
                      Amplitude: {aggregatedMetrics.maxTemperature !== undefined && aggregatedMetrics.minTemperature !== undefined
                        ? `${(aggregatedMetrics.maxTemperature - aggregatedMetrics.minTemperature).toFixed(1)}°`
                        : '—'}
                    </p>
                  </div>
                  <div className={historicalSummaryCardClass}>
                  <div className="flex items-center gap-3">
                    <Wind className={windIconClass} />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Vento</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-lg font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {aggregatedMetrics.averageWind?.toFixed(1) ?? '—'} km/h
                    </p>
                    <p className={microCaptionClass}>
                      Rajada máxima: {aggregatedMetrics.maxWindSpeed?.toFixed(0) ?? '—'} km/h
                    </p>
                    <p className={microCaptionClass}>
                      Direção dominante:{' '}
                      <WindDirectionIndicator
                        direction={aggregatedMetrics.dominantWindDirection}
                        className={cn('text-body-sm font-body', tertiaryTextClass)}
                      />
                    </p>
                  </div>
                    <div className={historicalSummaryCardClass}>
                      <div className="flex items-center gap-3">
                        <CloudRain className="h-5 w-5 text-emerald-300" />
                        <p className={cn(microLabelClass, tertiaryTextClass)}>Chuva</p>
                      </div>
                      <p
                        className={cn(
                          'text-number-lg font-heading leading-tight tracking-tight tabular-nums',
                          microValueBaseClass,
                          primaryTextClass,
                        )}
                      >
                        {aggregatedMetrics.rainfallSum !== undefined
                          ? `${aggregatedMetrics.rainfallSum.toFixed(1)} mm`
                          : '—'}
                      </p>
                      <p className={microCaptionClass}>
                        {rainyDaysCountSignificant > 0 && calendarDaysCount > 0
                          ? `Choveu de forma relevante em ${rainyDaysCountSignificant} de ${calendarDaysCount} dias nesse período.`
                          : 'Sem registros de chuva nesse período.'}
                      </p>
                    </div>
                  <div className={historicalSummaryCardClass}>
                    <div className="flex items-center gap-3">
                      <Activity className="h-5 w-5 text-sky-400" />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Pressão e risco</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-lg font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {aggregatedMetrics.averagePressure?.toFixed(1) ?? '—'} hPa
                    </p>
                    <p className={microCaptionClass}>
                      {pressureTrendLabel} (
                      {aggregatedMetrics.pressureTrend !== undefined
                        ? `${aggregatedMetrics.pressureTrend > 0 ? '+' : ''}${aggregatedMetrics.pressureTrend.toFixed(1)}`
                        : '—'}
                      )
                    </p>
                    <p className={microCaptionClass}>Pressão média do período.</p>
                  </div>
                </div>
                <p className={cn('text-[11px] leading-snug', mutedForegroundClass)}>
                  Valores agregados com base nas médias dos últimos 31 dias analisados.
                </p>
              </div>
            </Card>
            <Card className={cn(sectionCardClass, 'flex flex-col')}>
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className={cn(microLabelClass, tertiaryTextClass)}>Índices do dia</p>
                    <h2 className="sr-only">Índices do dia</h2>
                  </div>
                  
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <Card className={indexMiniCardClass}>
                    <div className="flex items-center gap-3">
                      <SmilePlus className="h-5 w-5 text-emerald-400" />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Conforto térmico</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {comfortIndex !== null ? `${comfortIndex.toFixed(1)}°C` : '—'}
                    </p>
                    <p className={microCaptionClass}>{comfortDescriptor.label}</p>
                    {comfortDescriptor.detail && (
                      <p className={cn('text-body-sm font-body', tertiaryTextClass)}>{comfortDescriptor.detail}</p>
                    )}
                  </Card>
                  <Card className={indexMiniCardClass}>
                    <div className="flex items-center gap-3">
                      <CloudRain className="h-5 w-5 text-emerald-300" />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Chuva no dia</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {rainProbabilityLabel}
                    </p>
                    <p className={microCaptionClass}>{rainAccumulatedLabel}</p>
                  </Card>
                  <Card className={indexMiniCardClass}>
                    <div className="flex items-center gap-3">
                      <Wind className={windIconClass} />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Vento</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {windValueText}
                    </p>
                    <p className={microCaptionClass}>
                      Direção dominante:{' '}
                      <WindDirectionIndicator
                        direction={todayWindStats.dominantDirection}
                        className={cn('text-body-sm font-body', tertiaryTextClass)}
                      />
                    </p>
                    <p className={microCaptionClass}>{windDetailText}</p>
                  </Card>
                  <Card className={indexMiniCardClass}>
                    <div className="flex items-center gap-3">
                      <Activity className="h-5 w-5 text-sky-400" />
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Pressão e estabilidade</p>
                    </div>
                    <p
                      className={cn(
                        'text-number-md font-heading leading-tight tracking-tight tabular-nums',
                        microValueBaseClass,
                        primaryTextClass,
                      )}
                    >
                      {pressureDescriptor.average !== null ? `${pressureDescriptor.average.toFixed(1)} hPa` : '—'}
                    </p>
                    <p className={microCaptionClass}>{pressureDescriptor.detail}</p>
                  </Card>
                </div>
                <p className={cn('text-[11px] leading-snug', mutedForegroundClass)}>
                  Indicadores derivados diretamente dos registros do dia para apoiar decisões rápidas.
                </p>
              </div>
            </Card>
          </section>
          <section className="grid gap-6 lg:grid-cols-2 items-start">
            <div className={heatmapWrapperClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={cn(microLabelClass, tertiaryTextClass)}>Histórico</p>
                <span className={dataSourceBadgeClass}>Open-Meteo</span>
              </div>
              {calendarBuckets.length ? (
                <>
                  <Suspense
                    fallback={
                      <div className="h-24 rounded-xl border border-border/60 bg-black/5 dark:bg-white/5" />
                    }
                  >
                    <HistoricalMiniHeatmap
                      buckets={calendarBuckets}
                      isDarkMode={isDark}
                      onVisibleColumnsChange={handleVisibleColumnsChange}
                    />
                  </Suspense>
                  <p className={cn('mt-4 text-[11px] leading-snug', mutedForegroundClass)}>
                    Últimos 31 dias analisados. Passe o mouse para ver resumo.
                  </p>
                </>
              ) : (
                <p className={cn('text-body-sm font-body', mutedForegroundClass)}>
                  Sem dados históricos suficientes para gerar o mapa.
                </p>
              )}
            </div>
            <Card className={cn(panelCardClass, 'space-y-2')}>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <p className={cn(microLabelClass, tertiaryTextClass)}>Previsão para amanhã</p>
                <span className={dataSourceBadgeClass}>Open-Meteo</span>
              </header>
              {tomorrowForecast.hasData && (
                <div className="flex flex-wrap items-center gap-3">
                  {temperatureLabel && (
                    <span className={cn('inline-flex items-center gap-1', microCaptionClass)}>
                      <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                      <span>{temperatureLabel}</span>
                    </span>
                  )}
                  {rainLabel && (
                    <span className={cn('inline-flex items-center gap-1', microCaptionClass)}>
                      <CloudRain className="h-4 w-4 text-sky-300" aria-hidden="true" />
                      <span>{rainLabel}</span>
                    </span>
                  )}
                  {windLabel && (
                    <span className={cn('inline-flex items-center gap-1', microCaptionClass)}>
                      <Wind className="h-4 w-4 text-teal-300" aria-hidden="true" />
                      <span>{windLabel}</span>
                    </span>
                  )}
                </div>
              )}
              <p className={microCaptionClass}>{tomorrowSummary}</p>
            </Card>
          </section>
        </div>

        {isAdminUser && (
        <Card className={cn(panelCardClass, 'p-5')}>
          <Accordion type="single" collapsible>
            <AccordionItem value="technical">
              <AccordionTrigger
                className={cn('accordion-trigger', microLabelClass, tertiaryTextClass)}
              >
                <span>Área técnica (admin e pipeline)</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-6">
                {/* CRUD admin demo: GET/POST/PATCH/DELETE em /api/users (apps/api/src/users), voltado ao ambiente interno e não ao fluxo de autenticação de produção. */}
                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className={cn(microLabelClass, tertiaryTextClass)}>CRUD de usuarios</p>
                      <p className={cn('text-body-sm', mutedForegroundClass)}>
                        Cadastre ou limpe administradores desta instância demo diretamente via API.
                      </p>
                      {isEditingUser && (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em]',
                            isDark
                              ? 'border border-amber-300/60 text-amber-100'
                              : 'border border-amber-400/80 text-amber-600',
                          )}
                        >
                          Editando {userForm.name || 'usuario'}
                        </span>
                      )}
                    </div>
                    <form className="space-y-4" onSubmit={handleSubmitUser}>
                      <div className="space-y-1.5">
                        <Label className={tertiaryTextClass}>Nome</Label>
                        <Input
                          placeholder="Nome"
                          value={userForm.name}
                          onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={tertiaryTextClass}>Email</Label>
                        <Input
                          placeholder="Email"
                          type="email"
                          value={userForm.email}
                          onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className={tertiaryTextClass}>
                          Senha (mínimo 6 caracteres)
                        </Label>
                        <p className={cn('text-body-sm', mutedForegroundClass)}>
                          {isEditingUser ? 'Preencha apenas se quiser atualizar a senha.' : 'Obrigatória para novos acessos.'}
                        </p>
                        <Input
                          placeholder="••••••"
                          type="password"
                          minLength={6}
                          value={userForm.password}
                          onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                          required={!isEditingUser}
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={creatingUser}
                        size="lg"
                        className="w-full uppercase tracking-[0.3em]"
                      >
                        {creatingUser
                          ? isEditingUser
                            ? 'Salvando...'
                            : 'Criando usuario...'
                          : isEditingUser
                            ? 'Salvar alterações'
                            : 'Criar usuario'}
                      </Button>
                      {isEditingUser && (
                        <button
                          type="button"
                          onClick={handleCancelUserEdit}
                          className="w-full text-center text-body-sm font-medium text-amber-600 transition hover:text-amber-500 dark:text-amber-200 dark:hover:text-amber-100"
                        >
                          Cancelar edição
                        </button>
                      )}
                      {(userMessage || userError) && (
                        <p
                          role="status"
                          className={cn(
                            'text-body-sm font-medium',
                            userError ? 'text-rose-400' : 'text-emerald-400',
                          )}
                        >
                          {userMessage ?? userError}
                        </p>
                      )}
                    </form>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className={cn(microLabelClass, tertiaryTextClass)}>Lista de usuarios</p>
                        <p className={cn('text-body-sm', mutedForegroundClass)}>Atualiza automaticamente após cada ação.</p>
                      </div>
                      <span className={cn(microLabelClass, tertiaryTextClass)}>{users.length} cadastrados</span>
                    </div>

                    <div className="overflow-x-auto">
                      {loadingUsers ? (
                        <p className={cn('text-body-sm', mutedForegroundClass)}>Carregando usuarios...</p>
                      ) : (
                        <Table className="min-w-full text-left text-body divide-y divide-border">
                          <TableHeader>
                            <TableRow>
                              <TableHead className={cn('pb-2', microLabelClass, tertiaryTextClass)}>Nome</TableHead>
                              <TableHead className={cn('pb-2', microLabelClass, tertiaryTextClass)}>Email</TableHead>
                              <TableHead className={cn('pb-2', microLabelClass, tertiaryTextClass)}>Criado em</TableHead>
                              <TableHead className={cn('pb-2', microLabelClass, tertiaryTextClass)}>Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {users.map((user) => (
                              <TableRow key={user.id}>
                                <TableCell className="py-3 pr-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={primaryTextClass}>{user.name}</span>
                                    {user.isAdmin && (
                                      <span
                                        className={cn(
                                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.32em]',
                                          isDark
                                            ? 'border-emerald-300/50 text-emerald-200'
                                            : 'border-emerald-200 text-emerald-700',
                                        )}
                                      >
                                        Admin
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className={cn('py-3 pr-4', tertiaryTextClass)}>{user.email}</TableCell>
                                <TableCell className={cn('py-3 pr-4', tertiaryTextClass)}>
                                  {user.createdAt ? new Date(user.createdAt).toLocaleString('pt-BR') : '—'}
                                </TableCell>
                                <TableCell className="py-3 text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={`Ações para ${user.name}`}
                                        className="glass-surface surface-secondary rounded-full p-2 text-muted-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 dark:focus-visible:ring-white/30"
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[15rem]">
                                      <DropdownMenuLabel className="text-[0.65rem] font-heading uppercase tracking-[0.35em] text-muted-foreground">
                                        Ações
                                      </DropdownMenuLabel>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setUserForm({
                                            name: user.name,
                                            email: user.email,
                                            password: '',
                                          })
                                          setEditingUserId(user.id)
                                          setUserMessage(null)
                                          setUserError(null)
                                        }}
                                      >
                                        Editar usuario
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => handleDeleteUser(user.id)}
                                        disabled={deletingUser === user.id}
                                        className="text-rose-500 focus:text-rose-500 dark:text-rose-300"
                                      >
                                        {deletingUser === user.id ? 'Removendo...' : 'Excluir usuario'}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuLabel className="text-[0.6rem] font-heading uppercase tracking-[0.35em] text-muted-foreground">
                                        Selecionar permissao
                                      </DropdownMenuLabel>
                                      <DropdownMenuItem
                                        onClick={() => handleToggleUserAdmin(user.id, !user.isAdmin, user.name)}
                                        disabled={currentUser?.id === user.id && user.isAdmin}
                                      >
                                        {user.isAdmin ? 'Remover permissao admin' : 'Conceder permissao admin'}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <div className={statusInfoCardClass}>
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Status do pipeline</p>
                      <p className={cn('text-body font-semibold', primaryTextClass)}>{pipelineStatus.label}</p>
                      <p className={cn('text-body-sm', mutedForegroundClass)}>{pipelineStatus.detail}</p>
                    </div>
                    <div className={statusInfoCardClass}>
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Logs considerados</p>
                      <p className={cn('text-body font-semibold', primaryTextClass)}>{totalLogs}</p>
                      <p className={cn('text-body-sm', mutedForegroundClass)}>Archive + streaming</p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <div className={statusInfoCardClass}>
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Último log</p>
                      <p className={cn('text-body font-semibold', primaryTextClass)}>{latestTimestamp ? formatDateTime(latestTimestamp) : '?'}</p>
                    </div>
                    <div className={statusInfoCardClass}>
                      <p className={cn(microLabelClass, tertiaryTextClass)}>Streaming</p>
                      <p className={cn('text-body font-semibold', primaryTextClass)}>{streamingStatus}</p>
                      <p className={cn('text-body-sm', mutedForegroundClass)}>
                        Collector consulta Open-Meteo a cada {COLLECTOR_INTERVAL_DISPLAY_MINUTES} minutos.
                      </p>
                    </div>
                  </div>
                </div>

              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
        )}

      </div>
    </main>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  )
}
const EMPTY_TODAY_TEMPERATURE_STATS: TodayTemperatureStats = {
  min: null,
  max: null,
  amplitude: null,
  average: null,
  count: 0,
}

const EMPTY_TODAY_DEW_STATS: TodayDewPointStats = {
  average: null,
  min: null,
  count: 0,
}
