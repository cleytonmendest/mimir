import { cn } from '../../utils'

type Tone = 'free' | 'partial' | 'full'

const TONE: Record<Tone, string> = {
  free: 'text-slot-free',
  partial: 'text-slot-partial',
  full: 'text-slot-full',
}

/**
 * Os estandes de um dia, um traço por estande: cheio é reservado, vazio é livre. A cor acompanha o
 * estado (livre, em parte ocupado, lotado), mas o estado também sai em texto onde isto é usado:
 * cor sozinha não basta. `decorative` esconde o traço dos leitores de tela quando o texto vizinho
 * já diz tudo (o dia do calendário).
 */
export function SlotMeter({
  booked,
  capacity,
  size = 'sm',
  decorative = false,
  className,
}: {
  booked: number
  capacity: number
  size?: 'sm' | 'lg'
  decorative?: boolean
  className?: string
}) {
  const tone: Tone = booked >= capacity ? 'full' : booked > 0 ? 'partial' : 'free'
  const total = Math.max(capacity, booked)
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': `${booked} de ${capacity} estandes reservados` } as const)

  return (
    <span
      {...a11y}
      data-tone={tone}
      className={cn(
        'inline-flex flex-wrap',
        size === 'lg' ? 'gap-1.5' : 'gap-[3px] max-sm:gap-0.5',
        TONE[tone],
        className,
      )}
    >
      {Array.from({ length: total }, (_, index) => (
        <i
          key={index}
          data-filled={index < booked}
          className={cn(
            'block border-current',
            size === 'lg'
              ? 'h-[18px] w-11 rounded-[4px] border-2'
              : 'h-[7px] w-3.5 rounded-[2px] border-[1.5px] max-sm:w-1.5',
            index < booked && 'bg-current',
          )}
        />
      ))}
    </span>
  )
}
