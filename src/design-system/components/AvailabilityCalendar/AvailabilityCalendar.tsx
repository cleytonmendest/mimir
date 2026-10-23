import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import {
  BOOKING_WINDOW_DAYS,
  dayStatus,
  freeSlots,
  type DayAvailability,
  type DayStatus,
} from '@/domain/booking'
import {
  addMonths,
  bookableMonths,
  compareMonths,
  monthGrid,
  monthOf,
  type YearMonth,
} from '@/domain/calendar'
import { addDays } from '@/domain/dates'
import { longDate, monthTitle, plural, weekdayLabels } from '@/domain/format'
import type { IsoDate } from '@/domain/types'
import { cn } from '../../utils'
import { SlotMeter } from '../SlotMeter/SlotMeter'
import { Button } from '../ui/button'

/** Setas: ←→ um dia, ↑↓ uma semana. */
const ARROW_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
}

const CELL: Record<DayStatus, string> = {
  free: 'border-slot-free/35 bg-slot-free-bg text-slot-free',
  partial: 'border-slot-partial/40 bg-slot-partial-bg text-slot-partial',
  full: 'border-slot-full/40 bg-slot-full-bg text-slot-full',
  closed:
    'border-border bg-[repeating-linear-gradient(135deg,var(--slot-closed-bg)_0_6px,var(--slot-closed-stripe)_6px_7px)] text-muted-foreground',
  past: 'border-dashed border-border bg-transparent text-muted-foreground opacity-55',
  far: 'border-dashed border-border bg-transparent text-muted-foreground opacity-55',
}

const NO_BOOKINGS: Pick<DayAvailability, 'booked' | 'closed' | 'mine'> = {
  booked: 0,
  closed: false,
  mine: false,
}

/** O que o dia diz em texto (a cor sozinha não basta). */
function statusText(status: DayStatus, free: number, capacity: number): string {
  switch (status) {
    case 'closed':
      return 'fechado para reservas'
    case 'full':
      return `lotado, ${capacity} de ${capacity} estandes reservados`
    case 'past':
      return 'indisponível, já passou'
    case 'far':
      return 'ainda não abre para reservas'
    case 'free':
    case 'partial':
      return `${plural(free, 'vaga livre', 'vagas livres')} de ${capacity}`
  }
}

/** O rótulo curto dentro da célula (some em tela estreita; o aria-label continua). */
function shortLabel(status: DayStatus, free: number): string {
  switch (status) {
    case 'closed':
      return 'Fechado'
    case 'full':
      return 'Lotado'
    case 'free':
    case 'partial':
      return plural(free, 'livre', 'livres')
    case 'past':
    case 'far':
      return ''
  }
}

/**
 * O calendário de um mercado: cada dia mostra quantos estandes estão reservados (SlotMeter), em
 * cor e em texto. Só se navega entre os meses que têm algum dia reservável. Não busca nada: quem usa
 * entrega as contagens do servidor e escuta `onSelect` e `onMonthChange`.
 */
export function AvailabilityCalendar({
  month,
  today,
  capacity,
  days,
  selected,
  showMine = false,
  windowDays = BOOKING_WINDOW_DAYS,
  subtitle,
  onSelect,
  onMonthChange,
}: {
  month: YearMonth
  today: IsoDate
  capacity: number
  days: readonly DayAvailability[]
  selected: IsoDate | null
  /** Marca os dias em que quem olha já reservou (visão do fornecedor). */
  showMine?: boolean
  windowDays?: number
  /** Em geral o nome do mercado. */
  subtitle?: string
  onSelect: (day: IsoDate) => void
  onMonthChange: (month: YearMonth) => void
}) {
  const byDay = new Map(days.map((entry) => [entry.day, entry]))
  const { first, last } = bookableMonths(today, windowDays)
  const labels = weekdayLabels()

  /**
   * Teclado: as setas levam o foco ao dia vizinho que se pode escolher, pulando os que não estão
   * disponíveis. Ficam no mês mostrado; para outro mês, os botões de mês.
   */
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, from: IsoDate) {
    const step = ARROW_STEPS[event.key]
    if (step === undefined) return
    event.preventDefault()
    const grid = event.currentTarget.parentElement
    if (grid === null) return
    for (
      let target = addDays(from, step);
      compareMonths(monthOf(target), month) === 0;
      target = addDays(target, step)
    ) {
      const next = grid.querySelector<HTMLButtonElement>(
        `button[data-date="${target}"]:not(:disabled)`,
      )
      if (next !== null) {
        next.focus()
        return
      }
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl leading-tight font-semibold">{monthTitle(month)}</h2>
          {subtitle !== undefined && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Mês anterior"
            disabled={compareMonths(month, first) <= 0}
            onClick={() => {
              onMonthChange(addMonths(month, -1))
            }}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Próximo mês"
            disabled={compareMonths(month, last) >= 0}
            onClick={() => {
              onMonthChange(addMonths(month, 1))
            }}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5 max-sm:gap-1">
        {labels.map((label) => (
          <div
            key={label.full}
            aria-hidden
            className="pb-0.5 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {label.short}
          </div>
        ))}
        {monthGrid(month).map((date, index) => {
          if (date === null) return <div key={`blank-${index}`} />
          const entry = byDay.get(date) ?? { day: date, ...NO_BOOKINGS }
          const status = dayStatus({
            today,
            day: date,
            closed: entry.closed,
            booked: entry.booked,
            capacity,
            windowDays,
          })
          const free = freeSlots(capacity, entry.booked)
          const mine = showMine && entry.mine
          const disabled = status === 'past' || status === 'far'
          const description = [
            `${longDate(date)}: ${statusText(status, free, capacity)}`,
            mine ? 'Sua reserva' : null,
            date === today ? 'Hoje' : null,
          ]
            .filter((part) => part !== null)
            .join('. ')

          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={description}
              aria-pressed={selected === date}
              data-status={status}
              data-date={date}
              onKeyDown={(event) => {
                moveFocus(event, date)
              }}
              onClick={() => {
                onSelect(date)
              }}
              className={cn(
                'relative flex min-h-[74px] min-w-0 flex-col items-start justify-between gap-1 rounded-md border p-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring max-sm:min-h-[62px]',
                CELL[status],
                !disabled && 'cursor-pointer',
                mine && 'border-2 border-slot-mine p-[5px]',
                selected === date && 'outline-3 outline-offset-1 outline-foreground',
              )}
            >
              <span
                className={cn(
                  'font-display text-[22px] leading-none font-semibold text-foreground tabular-nums max-sm:text-[19px]',
                  date === today && 'underline decoration-2 underline-offset-[3px]',
                )}
              >
                {Number(date.slice(8))}
              </span>
              {mine && (
                <Check aria-hidden className="absolute top-1 right-1 size-4 text-slot-mine" />
              )}
              {(status === 'free' || status === 'partial' || status === 'full') && (
                <SlotMeter decorative booked={entry.booked} capacity={capacity} />
              )}
              <span className="text-[11px] leading-tight font-semibold text-current max-sm:hidden">
                {shortLabel(status, free)}
              </span>
            </button>
          )
        })}
      </div>

      <ul className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <Legend swatch="border-slot-free/35 bg-slot-free-bg">Livre</Legend>
        <Legend swatch="border-slot-partial/40 bg-slot-partial-bg">Algumas vagas</Legend>
        <Legend swatch="border-slot-full/40 bg-slot-full-bg">Lotado</Legend>
        <Legend swatch="border-border bg-slot-closed-bg">Fechado</Legend>
        {showMine && <Legend swatch="border-2 border-slot-mine bg-card">Sua reserva</Legend>}
      </ul>
      <p className="mt-2.5 text-sm text-muted-foreground">
        Cada traço é um estande: cheio = reservado, vazio = livre. Dá para reservar de amanhã até{' '}
        {windowDays} dias à frente.
      </p>
    </div>
  )
}

function Legend({ swatch, children }: { swatch: string; children: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <i aria-hidden className={cn('inline-block size-4 rounded-sm border', swatch)} />
      {children}
    </li>
  )
}
