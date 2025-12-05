import { Brain } from 'lucide-react'

import { Card } from '@/components/components/ui/card'
import { cn } from '@/components/lib/utils'
import { type ClimoInsight, type ClimoInsightContext, useClimoInsight } from '@/hooks/useClimoInsight'
import type { RiskLevel } from '@/hooks/useClimoInsight'

const cleanWhitespace = (value?: string | null): string => value?.replace(/\s+/g, ' ').trim() ?? ''

const stripEndingPunctuation = (value: string): string => value.replace(/[.!?]+$/g, '').trim()

const lowerFirst = (value: string): string => (value ? value.charAt(0).toLowerCase() + value.slice(1) : value)

const ensureSentence = (value?: string | null): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

function buildTodaySentence(insight: ClimoInsight): string | null {
  const rawHeadline = cleanWhitespace(insight.headline).replace(/^hoje\s+/i, '').trim()
  const rawRisk = cleanWhitespace(insight.riskHighlight)
  if (!rawHeadline && !rawRisk) {
    return null
  }

  const clauses: string[] = []
  if (rawHeadline) {
    clauses.push(stripEndingPunctuation(rawHeadline))
  }
  if (rawRisk) {
    clauses.push(lowerFirst(stripEndingPunctuation(rawRisk)))
  }

  const combined = clauses.join(' ').trim()
  if (!combined) {
    return null
  }
  return ensureSentence(`Hoje ${lowerFirst(combined)}`)
}

function buildRecommendationSentence(insight: ClimoInsight): string | null {
  const recommendation = stripEndingPunctuation(cleanWhitespace(insight.recommendation))
  if (!recommendation) {
    return null
  }
  return ensureSentence(recommendation)
}

const riskToneClasses: Record<
  RiskLevel | 'default',
  { wrapper: string; icon: string }
> = {
  high: {
    wrapper: 'bg-rose-500/15 text-rose-500 dark:bg-rose-400/15 dark:text-rose-200',
    icon: 'text-rose-500 dark:text-rose-200',
  },
  moderate: {
    wrapper: 'bg-amber-500/15 text-amber-500 dark:bg-amber-400/15 dark:text-amber-200',
    icon: 'text-amber-500 dark:text-amber-200',
  },
  low: {
    wrapper: 'bg-sky-500/15 text-sky-500 dark:bg-sky-400/15 dark:text-sky-200',
    icon: 'text-sky-500 dark:text-sky-200',
  },
  none: {
    wrapper: 'bg-sky-500/15 text-sky-500 dark:bg-sky-400/15 dark:text-sky-200',
    icon: 'text-sky-500 dark:text-sky-200',
  },
  default: {
    wrapper: 'bg-slate-500/15 text-slate-500 dark:bg-slate-400/15 dark:text-slate-200',
    icon: 'text-slate-500 dark:text-slate-200',
  },
}

type ClimoAssistantCardProps = {
  context: ClimoInsightContext
  cardClassName: string
  microLabelClass: string
  tertiaryTextClass: string
  bodyTextClass: string
  mutedTextClass: string
}

export function ClimoAssistantCard({
  context,
  cardClassName,
  microLabelClass,
  tertiaryTextClass,
  bodyTextClass,
  mutedTextClass,
}: ClimoAssistantCardProps) {
  const { insight, isLoading } = useClimoInsight(context)

  const hasBaseData = Boolean(insight.headline || insight.riskHighlight || insight.recommendation)

  let paragraph: string
  if (isLoading && !hasBaseData) {
    paragraph = 'Analisando as leituras mais recentes para montar um resumo inteligente.'
  } else if (insight.source === 'no-data' && !insight.fromForecastOnly) {
    paragraph = 'Sem dados suficientes para analisar hoje; este resumo será atualizado assim que novas leituras chegarem.'
  } else {
    const sentences: string[] = []
    const todaySentence = buildTodaySentence(insight)
    if (todaySentence) {
      sentences.push(todaySentence)
    }
    const recommendationSentence = buildRecommendationSentence(insight)
    if (recommendationSentence) {
      sentences.push(recommendationSentence)
    }
    paragraph = sentences.join(' ')
    if (!paragraph) {
      paragraph = 'Monitorando as leituras atuais e preparando um resumo atualizado.'
    }
  }

  const [firstSentence, ...restSentences] = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean)
  const remainingText = restSentences.join(' ')

  const sourceLabel =
    insight.source === 'frontend+climo-api'
      ? 'Fonte: leituras + previsão + Climo'
      : insight.fromForecastOnly
        ? 'Fonte: previsão de amanhã'
        : context.hasSufficientTodayData
          ? 'Fonte: leituras de hoje'
          : 'Fonte: aguardando dados'

  const riskLevel = context.dailyAlertSummary?.level ?? 'default'
  const toneClasses = riskToneClasses[riskLevel] ?? riskToneClasses.default

  return (
    <Card className={cn(cardClassName, 'flex flex-col gap-4')}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', toneClasses.wrapper)}>
              <Brain className={cn('h-3.5 w-3.5', toneClasses.icon)} />
            </span>
            <h3 className={cn(bodyTextClass, 'font-semibold leading-tight')}>Climo</h3>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
              'border-white/40 text-[color:inherit] dark:border-white/10',
              tertiaryTextClass,
            )}
          >
            {sourceLabel}
          </span>
        </div>
        <p className={cn(microLabelClass, mutedTextClass)}>Resumo inteligente do clima e do risco.</p>
      </div>

      <p className={cn(bodyTextClass, 'leading-relaxed')}>
        {firstSentence && <span className="font-semibold">{firstSentence.trim()} </span>}
        {remainingText}
      </p>
    </Card>
  )
}
