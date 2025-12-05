import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { cn } from '@/components/lib/utils'

type PeriodId = 0 | 1 | 2 | 3
type PeriodLabel = 'Madrugada' | 'Manhã' | 'Tarde' | 'Noite'
type DominantLabel = 'chuva' | 'vento' | 'temperatura' | 'estavel'

export type CalendarBucket = {
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

type HistoricalMiniHeatmapProps = {
  buckets: CalendarBucket[]
  isDarkMode: boolean
  onVisibleColumnsChange?: (cols: number) => void
}

const PERIOD_LABELS: Record<PeriodId, PeriodLabel> = {
  0: 'Madrugada',
  1: 'Manhã',
  2: 'Tarde',
  3: 'Noite',
}
const PERIOD_IDS: PeriodId[] = [0, 1, 2, 3] as const

const DOMINANT_FACTOR_LABELS: Record<DominantLabel, string> = {
  chuva: 'Chuva',
  vento: 'Vento',
  temperatura: 'Amplitude térmica',
  estavel: 'Sem variação dominante',
}

const ROWS = 4
const MAX_CELL_SIZE = 12
const MIN_CELL_SIZE = 7
const CELL_GAP = 2

const rainScaleLight: [string, string, string] = ['#BFDBFE', '#60A5FA', '#1D4ED8']
const windScaleLight: [string, string, string] = ['#99F6E4', '#34D399', '#0F766E']
const tempScaleLight: [string, string, string] = ['#FED7AA', '#FB923C', '#C2410C']
const stableColorLight = '#D1D5DB'

const rainScaleDark: [string, string, string] = ['#1D4ED8', '#60A5FA', '#93C5FD']
const windScaleDark: [string, string, string] = ['#14B8A6', '#22C55E', '#6EE7B7']
const tempScaleDark: [string, string, string] = ['#F97316', '#FDBA74', '#FED7AA']
const stableColorDark = '#4B5563'

const heatmapDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
})

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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

function getHeatmapQualitativeLabel(
  metric: 'temp' | 'wind' | 'rain',
  score: number | null | undefined,
): string {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0
  let band: 0 | 1 | 2 | 3
  if (value < 0.15) {
    band = 0
  } else if (value < 0.45) {
    band = 1
  } else if (value < 0.75) {
    band = 2
  } else {
    band = 3
  }
  const labels: Record<typeof metric, [string, string, string, string]> = {
    temp: ['Estável', 'Amplitude leve', 'Amplitude moderada', 'Amplitude forte'],
    wind: ['Calmo', 'Vento leve', 'Vento moderado', 'Rajadas fortes'],
    rain: ['Sem chuva', 'Chuva fraca', 'Chuva moderada', 'Chuva intensa'],
  }
  return labels[metric][band]
}

function getBucketColor(bucket: CalendarBucket, isDarkMode: boolean): string {
  if (bucket.dominantLabel === 'estavel' || bucket.intensity < 0.2) {
    return isDarkMode ? stableColorDark : stableColorLight
  }
  const t = bucket.intensity
  let level: 0 | 1 | 2
  if (t < 0.45) {
    level = 0
  } else if (t < 0.75) {
    level = 1
  } else {
    level = 2
  }
  if (bucket.dominantLabel === 'chuva') {
    return (isDarkMode ? rainScaleDark : rainScaleLight)[level]
  }
  if (bucket.dominantLabel === 'vento') {
    return (isDarkMode ? windScaleDark : windScaleLight)[level]
  }
  return (isDarkMode ? tempScaleDark : tempScaleLight)[level]
}

const HistoricalMiniHeatmap = memo(function HistoricalMiniHeatmap({
  buckets,
  isDarkMode,
  onVisibleColumnsChange,
}: HistoricalMiniHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [tooltip, setTooltip] = useState<{ bucket: CalendarBucket; x: number; y: number } | null>(null)
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) {
      return undefined
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const bucketLookup = useMemo(() => {
    const map = new Map<string, CalendarBucket>()
    buckets.forEach((bucket) => {
      map.set(`${bucket.date}-${bucket.periodId}`, bucket)
    })
    return map
  }, [buckets])

  const allDates = useMemo(() => {
    const dates = Array.from(new Set(buckets.map((bucket) => bucket.date)))
    dates.sort()
    return dates
  }, [buckets])

  const maxColsByWidth = Math.max(7, Math.floor(width / (MAX_CELL_SIZE + CELL_GAP)))
  const cols = Math.min(maxColsByWidth, allDates.length)

  const selectedDates = useMemo(() => allDates.slice(-cols), [allDates, cols])

  useEffect(() => {
    onVisibleColumnsChange?.(cols)
  }, [cols, onVisibleColumnsChange])

  const visibleBuckets = useMemo(
    () =>
      selectedDates.flatMap((date, colIndex) =>
        PERIOD_IDS.map((periodId) => {
          const key = `${date}-${periodId}`
          const bucket =
            bucketLookup.get(key) ?? {
              date,
              periodId,
              periodLabel: PERIOD_LABELS[periodId],
              dominantLabel: 'estavel' as DominantLabel,
              intensity: 0,
              minTemp: null,
              maxTemp: null,
              tempAmp: null,
              rainSum: null,
              maxWind: null,
              maxGust: null,
              tempScore: 0,
              windScore: 0,
              rainScore: 0,
            }
          return {
            bucket,
            rowIndex: periodId,
            colIndex,
          }
        }),
      ),
    [bucketLookup, selectedDates],
  )

  const hideTooltip = useCallback(() => {
    setTooltip(null)
    setHoveredColumn(null)
  }, [])

  const handlePointerMove = useCallback(
    (event: ReactMouseEvent<SVGRectElement>, bucket: CalendarBucket, colIndex: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const x = rect ? event.clientX - rect.left : 0
      const y = rect ? event.clientY - rect.top : 0
      setHoveredColumn(colIndex)
      setTooltip({ bucket, x, y })
    },
    [],
  )

  if (!allDates.length || cols === 0) {
    return null
  }

  const measuredWidth = width > 0 ? width : cols * (MAX_CELL_SIZE + CELL_GAP)
  const cellSize = clamp(
    (measuredWidth - (cols - 1) * CELL_GAP) / cols,
    MIN_CELL_SIZE,
    MAX_CELL_SIZE,
  )
  const svgWidth = cols * cellSize + (cols - 1) * CELL_GAP
  const svgHeight = ROWS * cellSize + (ROWS - 1) * CELL_GAP

  const tooltipTextClass = isDarkMode ? 'text-white' : 'text-[#0F172A]'
  const tooltipMutedClass = isDarkMode ? 'text-[#E5E7EB]' : 'text-muted-foreground'

  return (
    <div className="relative w-full" ref={containerRef}>
      <svg
        width="100%"
        className="block h-full w-full"
        height={svgHeight}
        preserveAspectRatio="none"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label="Histórico climático simplificado"
      >
        {visibleBuckets.map(({ bucket, rowIndex, colIndex }) => {
          const focused = hoveredColumn === null || hoveredColumn === colIndex
          const isStable = bucket.dominantLabel === 'estavel'
          const strokeProps =
            isStable && isDarkMode
              ? { stroke: 'rgba(148,163,184,0.6)', strokeWidth: 0.5 }
              : {}
          return (
            <rect
              key={`${bucket.date}-${bucket.periodId}`}
              x={colIndex * (cellSize + CELL_GAP)}
              y={rowIndex * (cellSize + CELL_GAP)}
              width={cellSize}
              height={cellSize}
              rx={2}
              ry={2}
              fill={getBucketColor(bucket, isDarkMode)}
              opacity={focused ? 1 : 0.68}
              {...strokeProps}
              className="transition-[fill,opacity] duration-150"
              onMouseEnter={(event) => handlePointerMove(event, bucket, colIndex)}
              onMouseMove={(event) => handlePointerMove(event, bucket, colIndex)}
              onMouseLeave={hideTooltip}
            />
          )
        })}
      </svg>
      {tooltip &&
        (() => {
          const qualitativeEntries = [
            { key: 'temp', label: 'Temperatura', score: tooltip.bucket.tempScore },
            { key: 'wind', label: 'Vento', score: tooltip.bucket.windScore },
            { key: 'rain', label: 'Chuva', score: tooltip.bucket.rainScore },
          ] as const
          const rawBaseWind = tooltip.bucket.maxWind
          const rawGustWind = tooltip.bucket.maxGust
          const hasBaseWind = typeof rawBaseWind === 'number' && Number.isFinite(rawBaseWind)
          const hasGustWind = typeof rawGustWind === 'number' && Number.isFinite(rawGustWind)
          let displayWindKmh: number | null = null
          if (hasBaseWind && hasGustWind) {
            displayWindKmh = (rawBaseWind + rawGustWind) / 2
          } else if (hasBaseWind) {
            displayWindKmh = rawBaseWind
          } else if (hasGustWind) {
            displayWindKmh = rawGustWind
          }
          const detailSegments: Array<{ key: string; content: React.ReactNode }> = []
          if (tooltip.bucket.minTemp !== null && tooltip.bucket.maxTemp !== null) {
            detailSegments.push({
              key: 'temp',
              content: (
                <span className="inline-flex whitespace-nowrap">
                  <span style={{ color: getTemperatureColor(isDarkMode) }}>
                    {tooltip.bucket.minTemp.toFixed(1)}–{tooltip.bucket.maxTemp.toFixed(1)} °C
                  </span>
                </span>
              ),
            })
          }
          if (displayWindKmh !== null) {
            detailSegments.push({
              key: 'wind',
              content: (
                <span className="inline-flex whitespace-nowrap">
                  <span style={{ color: getWindColor(isDarkMode) }}>{displayWindKmh.toFixed(1)} km/h</span>
                </span>
              ),
            })
          }
          if (tooltip.bucket.rainSum !== null && tooltip.bucket.rainSum > 0) {
            detailSegments.push({
              key: 'rain',
              content: (
                <span className="inline-flex whitespace-nowrap">
                  <span style={{ color: getHumidityColor(isDarkMode) }}>{tooltip.bucket.rainSum.toFixed(1)} mm</span>
                </span>
              ),
            })
          }
          return (
            <div
              className={cn(
                'pointer-events-none absolute z-20 w-auto min-w-[240px] max-w-[90vw] sm:max-w-[360px]',
                'rounded-xl px-3 py-2 text-xs leading-snug',
                isDarkMode
                  ? 'bg-zinc-900/85 border border-zinc-700 text-slate-50 shadow-lg shadow-black/40'
                  : 'bg-white/85 border border-slate-200 text-slate-900 shadow-lg shadow-slate-300/60',
              )}
              style={{
                left: clamp(tooltip.x, 0, svgWidth),
                top: clamp(tooltip.y - 6, 0, svgHeight),
                transform: 'translate(-50%, -110%)',
              }}
            >
              <p
                className={cn(
                  'text-[11px] font-medium tabular-nums opacity-80',
                  tooltipTextClass,
                )}
              >
                {heatmapDateFormatter.format(new Date(tooltip.bucket.date))} — {tooltip.bucket.periodLabel}
              </p>
              <p className={cn('mt-1 text-[11px]', tooltipMutedClass)}>
                Fator dominante:{' '}
                <span className="font-semibold">{DOMINANT_FACTOR_LABELS[tooltip.bucket.dominantLabel]}</span>
              </p>
              <div className="mt-2 space-y-1">
                {qualitativeEntries.map((entry) => (
                  <p key={entry.key} className={cn('text-[12px] leading-snug', tooltipTextClass)}>
                    <span className="font-semibold">{entry.label}:</span>{' '}
                    <span>{getHeatmapQualitativeLabel(entry.key, entry.score)}</span>
                  </p>
                ))}
              </div>
              {detailSegments.length > 0 && (
                <div className="mt-2 border-t border-border/40 pt-1">
                  <p className="whitespace-nowrap text-[11px] text-muted-foreground overflow-hidden text-ellipsis">
                    <span className="font-semibold">Detalhes:</span>{' '}
                    {detailSegments.map((segment, index) => (
                      <Fragment key={segment.key}>
                        {index > 0 && <span> · </span>}
                        {segment.content}
                      </Fragment>
                    ))}
                  </p>
                </div>
              )}
            </div>
          )
        })()}
    </div>
  )
})

export default HistoricalMiniHeatmap
