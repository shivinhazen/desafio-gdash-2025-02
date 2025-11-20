import { cn } from '@/components/lib/utils'

const metricCards = [
  { label: 'Temperatura', value: '27°C', detail: 'Feeling 29°C' },
  { label: 'Umidade relativa', value: '72%', detail: 'Conforto Médio' },
  { label: 'Velocidade do vento', value: '13 km/h', detail: 'Brisa moderada' },
  { label: 'Chuva prevista', value: '42%', detail: 'Moderada nas próximas 3h' },
]

const insights = [
  {
    title: 'Tendência',
    description: 'A temperatura tende a subir 2°C nas próximas 6 horas.',
    status: 'Alta',
  },
  {
    title: 'Alerta de chuva',
    description: 'Probabilidade de pancadas isoladas ao entardecer.',
    status: 'Moderada',
  },
  {
    title: 'Conforto climático',
    description: 'Índice de 63/100 — clima agradável para atividades externas.',
    status: 'Bom',
  },
]

const timeline = [
  { time: '08:00', metric: '22°C • Céu limpo' },
  { time: '11:00', metric: '25°C • Parcialmente nublado' },
  { time: '14:00', metric: '27°C • Sol forte' },
  { time: '17:00', metric: '26°C • Possível chuva' },
]

function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900 to-slate-900/40 p-8 shadow-2xl shadow-slate-950/80">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">GDASH Weather Insights</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Dashboard de Clima Inteligente</h1>
          <p className="mt-2 max-w-3xl text-lg leading-relaxed text-slate-300">
            Pipeline completa: coleta Python → fila RabbitMQ → worker Go → API NestJS → MongoDB.
            Use estes dados para criar insights baseados em IA, alertas em tempo real e exportações CSV/XLSX.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metricCards.map((metric) => (
            <article
              key={metric.label}
              className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-sm shadow-black/40 transition hover:border-gdash-500 hover:bg-slate-900/70"
            >
              <p className="text-sm uppercase tracking-wide text-slate-400">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold text-white">{metric.value}</p>
              <p className="mt-2 text-sm text-slate-400">{metric.detail}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 shadow-sm shadow-black/40">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Linha do tempo</h2>
              <span className="text-sm text-slate-400">Atualizado há 5 min</span>
            </div>
            <ul className="mt-4 space-y-4">
              {timeline.map((item) => (
                <li
                  key={item.time}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3"
                >
                  <span className="text-sm uppercase tracking-wide text-slate-400">{item.time}</span>
                  <span className="text-sm font-medium text-white">{item.metric}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gdash-500/20 to-transparent p-6 shadow-sm shadow-black/40">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Insights de IA</h2>
              <span className="text-sm text-slate-400">Modelo local</span>
            </div>
            <div className="mt-6 space-y-4">
              {insights.map((insight) => (
                <article
                  key={insight.title}
                  className={cn(
                    'rounded-2xl border px-4 py-3 transition',
                    'border-white/10 bg-slate-950/60 text-slate-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{insight.title}</h3>
                    <span className="text-xs uppercase tracking-wide text-slate-400">{insight.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{insight.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
