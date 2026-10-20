import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VISIT_STATUSES } from '@/domain/types'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it.each(VISIT_STATUSES)(
    'mostra um rótulo legível para "%s" (nunca o valor cru do banco)',
    (status) => {
      render(<StatusBadge status={status} />)
      const badge = screen.getByText(/\S/)
      expect(badge.textContent).not.toContain('_')
      expect(badge.textContent).not.toBe(status)
    },
  )

  it('cada status tem uma cor própria', () => {
    const classes = VISIT_STATUSES.map((status) => {
      const { container, unmount } = render(<StatusBadge status={status} />)
      const value = container.firstElementChild?.className ?? ''
      unmount()
      return value
    })
    expect(new Set(classes).size).toBe(VISIT_STATUSES.length)
  })
})
