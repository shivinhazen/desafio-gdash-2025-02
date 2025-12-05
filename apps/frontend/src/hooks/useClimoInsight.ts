import { useEffect, useMemo, useState } from 'react'

import { API_BASE } from '@/lib/api'

export type RiskLevel = 'none' | 'low' | 'moderate' | 'high'

export type HeatComfortSummary = {
  label: string
  detail: string | null
  level: 'ok' | 'attention' | 'risk'
}

export type ClimoDailyAlertSummary = {
  level: RiskLevel
  hasRain: boolean
  hasWind: boolean
  badgeText: string | null
  shortSummary: string | null
  shortAction: string | null
}

export type ClimoInsightContext = {
  dayNarrative: string | null
  dailyAlertSummary: ClimoDailyAlertSummary | null
  heatComfort: HeatComfortSummary | null
  tomorrowSummary: string | null
  hasSufficientTodayData: boolean
}

export type ClimoInsight = {
  headline: string
  riskHighlight?: string
  recommendation?: string
  climoMessage?: string
  source: 'frontend' | 'frontend+climo-api' | 'no-data'
  fromForecastOnly?: boolean
}

export type UseClimoInsightResult = {
  insight: ClimoInsight
  isLoading: boolean
}

const CLIMO_CACHE_TTL = 1000 * 60 * 30

const TOMORROW_BAD_KEYWORDS = ['chuva forte', 'instável', 'instabilidade', 'rajadas', 'alerta', 'atenção', 'tempestade']
const TOMORROW_GOOD_KEYWORDS = ['estável', 'tranquilo', 'sem extremos', 'calmo']
const TOMORROW_STABLE_KEYWORDS = [
  'tende a ser estável',
  'sem extremos relevantes',
  'relativamente estável',
  'mantém estabilidade',
  'dia estável',
  'padrão estável',
]
const TOMORROW_RAIN_KEYWORDS = ['chuva', 'precipitação', 'temporais']
const TOMORROW_WIND_KEYWORDS = ['vento', 'ventos', 'rajada', 'rajadas', 'brisa forte']
const TOMORROW_INTENSE_KEYWORDS = ['forte', 'intenso', 'intensa', 'severo', 'severa', 'crítico', 'crítica']

type TomorrowTone = 'good' | 'bad' | 'unknown' | 'nodata'
export function useClimoInsight(context: ClimoInsightContext): UseClimoInsightResult {
  const { dayNarrative, dailyAlertSummary, heatComfort, tomorrowSummary, hasSufficientTodayData } = context
  const [climoMessage, setClimoMessage] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<number>(0)
  const [apiLoading, setApiLoading] = useState(false)

  const tomorrowTone = useMemo(() => classifyTomorrowSummary(tomorrowSummary), [tomorrowSummary])
  const fromForecastOnly = !hasSufficientTodayData && Boolean(tomorrowSummary) && tomorrowTone !== 'nodata'

  const shouldUseApi = hasSufficientTodayData || fromForecastOnly
  const hasValidCache = Boolean(climoMessage) && Date.now() - lastFetch < CLIMO_CACHE_TTL

  useEffect(() => {
    if (!shouldUseApi || hasValidCache) {
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setApiLoading(true)

    ;(async () => {
      try {
        const response = await fetch(`${API_BASE}/climo/insight`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Climo insight failed')
        }
        const payload = (await response.json()) as { message?: string }
        const shortMessage = extractPrimarySentence(payload.message)
        if (!cancelled) {
          setClimoMessage(shortMessage)
          setLastFetch(Date.now())
        }
      } catch {
        if (!cancelled) {
          setClimoMessage(null)
        }
      } finally {
        if (!cancelled) {
          setApiLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [hasValidCache, shouldUseApi])

  const headline = useMemo(
    () =>
      buildHeadlineText({
        hasSufficientTodayData,
        fromForecastOnly,
        dayNarrative,
        dailyAlertSummary,
        tomorrowSummary,
        tomorrowTone,
      }),
    [dailyAlertSummary, dayNarrative, fromForecastOnly, hasSufficientTodayData, tomorrowSummary, tomorrowTone],
  )

  const riskHighlight = useMemo(
    () =>
      buildRiskHighlightText({
        hasSufficientTodayData,
        fromForecastOnly,
        dailyAlertSummary,
        tomorrowSummary,
        tomorrowTone,
      }),
    [dailyAlertSummary, fromForecastOnly, hasSufficientTodayData, tomorrowSummary, tomorrowTone],
  )

  const recommendation = useMemo(
    () =>
      buildRecommendationText({
        hasSufficientTodayData,
        fromForecastOnly,
        dailyAlertSummary,
        heatComfort,
        tomorrowSummary,
        tomorrowTone,
      }),
    [dailyAlertSummary, fromForecastOnly, hasSufficientTodayData, heatComfort, tomorrowSummary, tomorrowTone],
  )

  let source: ClimoInsight['source'] = 'frontend'
  if (!hasSufficientTodayData && !fromForecastOnly) {
    source = 'no-data'
  }
  if (climoMessage) {
    source = 'frontend+climo-api'
  }

  const insight: ClimoInsight = {
    headline,
    riskHighlight: riskHighlight ?? undefined,
    recommendation,
    climoMessage: climoMessage ?? undefined,
    source,
    fromForecastOnly,
  }

  const isLoading = hasSufficientTodayData && !dayNarrative && !dailyAlertSummary

  return {
    insight,
    isLoading: isLoading || (apiLoading && !climoMessage),
  }
}

function extractPrimarySentence(message?: string): string | null {
  if (!message) {
    return null
  }
  const firstLine = message
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) {
    return null
  }
  const firstSentenceMatch = firstLine.match(/.*?[.!?](\s|$)/)
  const firstSentence = (firstSentenceMatch ? firstSentenceMatch[0] : firstLine).trim()
  if (firstSentence.length <= 140) {
    return firstSentence
  }
  const slice = firstSentence.slice(0, 140)
  const trimmed = slice.replace(/\s+\S*$/, '')
  return `${trimmed}…`
}

function classifyTomorrowSummary(summary: string | null): TomorrowTone {
  if (!summary) {
    return 'unknown'
  }
  const normalized = summary.toLowerCase()
  if (normalized.includes('sem dados')) {
    return 'nodata'
  }
  if (TOMORROW_BAD_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 'bad'
  }
  if (TOMORROW_GOOD_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 'good'
  }
  return 'unknown'
}

type HeadlineParams = {
  hasSufficientTodayData: boolean
  fromForecastOnly: boolean
  dayNarrative: string | null
  dailyAlertSummary: ClimoDailyAlertSummary | null
  tomorrowSummary: string | null
  tomorrowTone: TomorrowTone
}

function buildHeadlineText({
  hasSufficientTodayData,
  fromForecastOnly,
  dayNarrative,
  dailyAlertSummary,
  tomorrowSummary,
  tomorrowTone,
}: HeadlineParams): string {
  if (!hasSufficientTodayData && !fromForecastOnly) {
    return 'sem dados suficientes para analisar hoje; este resumo será atualizado assim que novas leituras chegarem.'
  }
  if (!hasSufficientTodayData && fromForecastOnly) {
    if (isTomorrowClearlyStable(tomorrowSummary, tomorrowTone)) {
      return 'leituras limitadas; seguindo a previsão, o cenário tende a ser estável.'
    }
    if (tomorrowTone === 'bad') {
      return 'leituras limitadas; a previsão indica cenário mais instável.'
    }
    if (tomorrowTone === 'nodata') {
      return 'leituras limitadas e previsão ainda indisponível.'
    }
    return 'leituras limitadas; seguimos usando a previsão como referência.'
  }

  if (dailyAlertSummary) {
    const hazard = describeHazardLabel(dailyAlertSummary)
    if (dailyAlertSummary.level === 'high' && hazard === 'chuva e vento') {
      return 'cenário chuvoso e com rajadas fortes ao longo do dia.'
    }
    if (dailyAlertSummary.level === 'high' && hazard === 'chuva') {
      return 'chuva intensa domina os períodos mais críticos.'
    }
    if (dailyAlertSummary.level === 'high' && hazard === 'vento') {
      return 'rajadas fortes lideram o período.'
    }
    if (dailyAlertSummary.level === 'moderate' && hazard === 'chuva e vento') {
      return 'instabilidade moderada com chuva e vento presentes.'
    }
    if (dailyAlertSummary.level === 'moderate' && hazard === 'chuva') {
      return 'chuva recorrente aparece em diferentes janelas.'
    }
    if (dailyAlertSummary.level === 'moderate' && hazard === 'vento') {
      return 'ventos moderados predominam em áreas mais expostas.'
    }
    if (dailyAlertSummary.level === 'low' && hazard) {
      return `ambiente estável, com sinais leves de ${hazard}.`
    }
    if (dailyAlertSummary.level === 'none' || dailyAlertSummary.level === 'low') {
      return 'tempo estável, sem extremos de chuva ou vento.'
    }
  }

  if (dayNarrative) {
    return normalizeDayNarrative(dayNarrative)
  }

  return 'mantém monitoramento contínuo enquanto novas leituras chegam.'
}

type RiskHighlightParams = {
  hasSufficientTodayData: boolean
  fromForecastOnly: boolean
  dailyAlertSummary: ClimoDailyAlertSummary | null
  tomorrowSummary: string | null
  tomorrowTone: TomorrowTone
}

function buildRiskHighlightText({
  hasSufficientTodayData,
  fromForecastOnly,
  dailyAlertSummary,
  tomorrowSummary,
  tomorrowTone,
}: RiskHighlightParams): string {
  if (!hasSufficientTodayData && !fromForecastOnly) {
    return 'risco principal não calculado por falta de leituras.'
  }
  if (fromForecastOnly) {
    if (tomorrowTone === 'nodata') {
      return 'a previsão ainda é insuficiente para estimar riscos.'
    }
    if (isTomorrowClearlyStable(tomorrowSummary, tomorrowTone)) {
      return 'a previsão sinaliza estabilidade sem riscos relevantes.'
    }
    const forecastHazard = describeForecastHazard(tomorrowSummary)
    if (forecastHazard === 'chuva e vento') {
      return 'a previsão indica instabilidade com chuva e vento combinados.'
    }
    if (forecastHazard === 'chuva') {
      return 'a previsão destaca risco de chuva ao longo do período.'
    }
    if (forecastHazard === 'vento') {
      return 'a previsão destaca risco de vento mais forte.'
    }
    return 'a previsão sugere instabilidade moderada; acompanhe novas leituras.'
  }

  if (!dailyAlertSummary) {
    return 'aguardando consolidação das leituras de risco.'
  }

  const hazard = describeHazardLabel(dailyAlertSummary)
  if (dailyAlertSummary.level === 'high') {
    return hazard ? `risco alto de ${hazard}.` : 'risco alto em andamento.'
  }
  if (dailyAlertSummary.level === 'moderate') {
    return hazard ? `risco moderado de ${hazard}.` : 'risco moderado em consolidação.'
  }
  if (dailyAlertSummary.level === 'low' && hazard) {
    return `não há riscos significativos, apenas risco leve de ${hazard}.`
  }
  return 'não há riscos significativos no cenário atual.'
}

type RecommendationParams = {
  hasSufficientTodayData: boolean
  fromForecastOnly: boolean
  dailyAlertSummary: ClimoDailyAlertSummary | null
  heatComfort: HeatComfortSummary | null
  tomorrowSummary: string | null
  tomorrowTone: TomorrowTone
}

function buildRecommendationText({
  hasSufficientTodayData,
  fromForecastOnly,
  dailyAlertSummary,
  heatComfort,
  tomorrowSummary,
  tomorrowTone,
}: RecommendationParams): string {
  if (!hasSufficientTodayData && !fromForecastOnly) {
    return 'aguarde novas leituras ao longo do dia.'
  }
  if (fromForecastOnly) {
    const forecastOnlyClause = buildForecastOnlyClause(tomorrowSummary, tomorrowTone)
    return ensureSentence(forecastOnlyClause ?? 'acompanhe a previsão antes de decisões mais críticas')
  }

  const todaySeverity = computeTodaySeverity(dailyAlertSummary)
  const actionClause = buildActionClause(dailyAlertSummary, heatComfort)
  const forecastClause = buildForecastClause({
    tomorrowSummary,
    tone: tomorrowTone,
    todaySeverity,
  })

  if (actionClause && forecastClause) {
    return ensureSentence(`${actionClause} e ${forecastClause}`)
  }
  if (actionClause) {
    return ensureSentence(actionClause)
  }
  if (forecastClause) {
    return ensureSentence(forecastClause)
  }

  return 'mantenha os planos atuais e revise o painel em caso de mudança.'
}

function ensureSentence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

function normalizeDayNarrative(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) {
    return 'segue em monitoramento contínuo enquanto chegam novas leituras.'
  }
  const withoutPrefix = trimmed.replace(/^(hoje|dia)\s+/i, '').trim()
  return withoutPrefix || 'segue em monitoramento contínuo enquanto chegam novas leituras.'
}

function buildComfortSnippet(heatComfort: HeatComfortSummary | null): string | null {
  if (!heatComfort) {
    return null
  }
  if (heatComfort.level === 'risk') {
    return 'evite sol forte e priorize ambientes frescos'
  }
  if (heatComfort.level === 'attention') {
    return 'hidrate-se e reduza esforços prolongados'
  }
  if (heatComfort.level === 'ok') {
    return 'aproveite as condições confortáveis para atividades externas'
  }
  return null
}

function buildRiskActionSnippet(summary: ClimoDailyAlertSummary | null): string | null {
  if (!summary) {
    return null
  }
  const hazard = describeHazardLabel(summary)
  if (summary.level === 'high') {
    if (hazard === 'chuva e vento') {
      return 'ative planos de contingência para chuva e vento'
    }
    if (hazard === 'chuva') {
      return 'ajuste rotas expostas à chuva forte'
    }
    if (hazard === 'vento') {
      return 'proteja estruturas expostas e monitore rajadas fortes'
    }
  }
  if (summary.level === 'moderate') {
    if (hazard === 'chuva e vento') {
      return 'monitore operações, pois chuva e vento variam ao longo do dia'
    }
    if (hazard === 'chuva') {
      return 'reduza deslocamentos longos durante as passagens de chuva'
    }
    if (hazard === 'vento') {
      return 'revise atividades em altura ou áreas abertas'
    }
  }
  return null
}

type ForecastClauseParams = {
  tomorrowSummary: string | null
  tone: TomorrowTone
  todaySeverity: number
}

function buildActionClause(
  summary: ClimoDailyAlertSummary | null,
  heatComfort: HeatComfortSummary | null,
): string | null {
  return buildRiskActionSnippet(summary) ?? buildComfortSnippet(heatComfort)
}

function buildForecastClause({ tomorrowSummary, tone, todaySeverity }: ForecastClauseParams): string | null {
  if (!tomorrowSummary && tone === 'nodata') {
    return null
  }

  const tomorrowSeverity = computeTomorrowSeverity(tomorrowSummary, tone)
  const isTodayStable = todaySeverity <= 1
  const isTomorrowStable = tomorrowSeverity <= 1 && (tomorrowSummary !== null || tone !== 'unknown')

  if (tomorrowSummary && isTodayStable && isTomorrowStable) {
    return 'amanhã deve seguir estável, sem grandes mudanças'
  }

  if (todaySeverity >= 2 && tomorrowSeverity < todaySeverity) {
    return 'amanhã tende a ser mais estável'
  }

  if (tomorrowSeverity > todaySeverity && tomorrowSeverity >= 1) {
    return 'amanhã tende a ficar mais instável'
  }

  if (tomorrowSummary && tomorrowSeverity === todaySeverity) {
    if (tomorrowSeverity <= 1) {
      return 'amanhã deve seguir estável, sem grandes mudanças'
    }
    return 'amanhã deve manter o mesmo padrão de risco'
  }

  if (!tomorrowSummary && tomorrowSeverity > todaySeverity) {
    return 'amanhã tende a ficar mais instável'
  }

  if (isTodayStable && isTomorrowStable && tomorrowSummary === null && tone === 'good') {
    return 'amanhã deve seguir estável, sem grandes mudanças'
  }

  return null
}

function buildForecastOnlyClause(summary: string | null, tone: TomorrowTone): string | null {
  if (tone === 'nodata') {
    return 'aguarde novas previsões antes de decisões sensíveis'
  }
  if (isTomorrowClearlyStable(summary, tone)) {
    return 'considere manter a rotina, pois a previsão indica estabilidade'
  }
  if (tone === 'bad') {
    return 'planeje o dia com margem, pois a previsão indica instabilidade'
  }

  const forecastHazard = describeForecastHazard(summary)
  if (forecastHazard === 'chuva e vento') {
    return 'planeje o dia com margem, pois a previsão indica chuva e vento combinados'
  }
  if (forecastHazard === 'chuva') {
    return 'ajuste a rotina, pois a previsão destaca chuva'
  }
  if (forecastHazard === 'vento') {
    return 'considere estruturas expostas, pois a previsão destaca vento'
  }

  return null
}

function computeTodaySeverity(summary: ClimoDailyAlertSummary | null): number {
  if (!summary) {
    return 0
  }
  if (summary.level === 'high' && summary.hasRain && summary.hasWind) {
    return 3
  }
  if (summary.level === 'high') {
    return 2
  }
  if (summary.level === 'moderate') {
    return 1
  }
  if (summary.hasRain || summary.hasWind) {
    return 1
  }
  return 0
}

function computeTomorrowSeverity(summary: string | null, tone: TomorrowTone): number {
  if (!summary) {
    return tone === 'bad' ? 1 : 0
  }
  if (isTomorrowClearlyStable(summary, tone)) {
    return 0
  }
  const normalized = summary.toLowerCase()
  const mentionsRain = TOMORROW_RAIN_KEYWORDS.some((keyword) => normalized.includes(keyword))
  const mentionsWind = TOMORROW_WIND_KEYWORDS.some((keyword) => normalized.includes(keyword))
  const mentionsIntense = TOMORROW_INTENSE_KEYWORDS.some((keyword) => normalized.includes(keyword))

  if (tone === 'nodata' || tone === 'good') {
    return 0
  }

  if (mentionsRain && mentionsWind && mentionsIntense) {
    return 3
  }
  if (mentionsRain && mentionsWind) {
    return mentionsIntense ? 3 : 2
  }
  if ((mentionsRain || mentionsWind) && mentionsIntense) {
    return 2
  }
  if (mentionsRain || mentionsWind) {
    return 1
  }
  return tone === 'bad' ? 1 : 0
}

function describeHazardLabel(summary: ClimoDailyAlertSummary | null): 'chuva e vento' | 'chuva' | 'vento' | null {
  if (!summary) {
    return null
  }
  if (summary.hasRain && summary.hasWind) {
    return 'chuva e vento'
  }
  if (summary.hasRain) {
    return 'chuva'
  }
  if (summary.hasWind) {
    return 'vento'
  }
  return null
}

function describeForecastHazard(summary: string | null): 'chuva e vento' | 'chuva' | 'vento' | null {
  if (!summary) {
    return null
  }
  const normalized = summary.toLowerCase()
  const mentionsRain = TOMORROW_RAIN_KEYWORDS.some((keyword) => normalized.includes(keyword))
  const mentionsWind = TOMORROW_WIND_KEYWORDS.some((keyword) => normalized.includes(keyword))
  if (mentionsRain && mentionsWind) {
    return 'chuva e vento'
  }
  if (mentionsRain) {
    return 'chuva'
  }
  if (mentionsWind) {
    return 'vento'
  }
  return null
}

function isTomorrowClearlyStable(summary: string | null, tone: TomorrowTone): boolean {
  if (tone === 'good') {
    return true
  }
  if (!summary) {
    return false
  }
  const normalized = summary.toLowerCase()
  return TOMORROW_STABLE_KEYWORDS.some((keyword) => normalized.includes(keyword))
}
