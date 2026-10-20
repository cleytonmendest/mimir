import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('abre e mostra o título', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Rota do repositor' })).toBeInTheDocument()
  })
})
