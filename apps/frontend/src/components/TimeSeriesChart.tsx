import { memo, useMemo, type ReactNode } from 'react'
import type { PointTooltipProps, LineSeries } from '@nivo/line'
import { ResponsiveLine } from '@nivo/line'

type TimeSeriesChartProps = {
  data: LineSeries[]
  tickValues?: Array<string | number>
  chartAxisTextColor: string
  isDark: boolean
  colorAccessor: (serie: { id: string | number }) => string
  tooltip: ((props: PointTooltipProps<LineSeries>) => ReactNode) | undefined
}

const TimeSeriesChart = memo(function TimeSeriesChart({
  data,
  tickValues,
  chartAxisTextColor,
  isDark,
  colorAccessor,
  tooltip,
}: TimeSeriesChartProps) {
  const theme = useMemo(
    () => ({
      text: { fill: chartAxisTextColor, fontFamily: 'var(--font-body)' },
      tooltip: {
        container: {
          background: isDark ? '#0F172A' : '#fff',
          color: chartAxisTextColor,
          fontFamily: 'var(--font-body)',
        },
      },
      grid: {
        line: {
          stroke: isDark ? 'rgba(248,249,254,0.12)' : 'rgba(15,23,42,0.08)',
          strokeWidth: 1,
        },
      },
      axis: {
        domain: { line: { stroke: 'transparent' } },
        ticks: {
          line: { stroke: 'transparent' },
          text: {
            fill: chartAxisTextColor,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
          },
        },
        legend: {
          text: {
            fill: chartAxisTextColor,
            fontFamily: 'var(--font-body)',
          },
        },
      },
    }),
    [chartAxisTextColor, isDark],
  )

  return (
    <ResponsiveLine
      data={data}
      theme={theme}
      margin={{ top: 10, right: 20, bottom: 40, left: 40 }}
      xScale={{ type: 'point' }}
      yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false, reverse: false }}
      curve="monotoneX"
      axisBottom={{
        tickRotation: -35,
        tickPadding: 10,
        tickSize: 0,
        tickValues,
      }}
      axisLeft={{
        tickSize: 0,
        tickPadding: 8,
      }}
      enableGridX={false}
      enableGridY
      colors={colorAccessor}
      useMesh
      tooltip={tooltip}
      legends={[]}
      lineWidth={1.5}
      pointSize={4}
      enablePoints
      pointBorderWidth={2}
      pointColor={{ from: 'color' }}
      pointBorderColor={{ from: 'serieColor' }}
    />
  )
})

export default TimeSeriesChart
