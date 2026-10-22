import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activationMessage,
  canShare,
  copyText,
  inviteMessage,
  shareText,
  whatsAppLink,
} from './share'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mensagens', () => {
  it('a de ativação chama o fornecedor pelo nome e leva o link', () => {
    const text = activationMessage('Sabor da Serra', 'https://a.exemplo/definir-senha?token=x')
    expect(text).toContain('Sabor da Serra')
    expect(text).toContain('https://a.exemplo/definir-senha?token=x')
  })

  it('a de convite leva o link e o código em dois blocos', () => {
    const text = inviteMessage('https://a.exemplo/cadastro?codigo=K7QD-4MXA', 'K7QD4MXA')
    expect(text).toContain('https://a.exemplo/cadastro?codigo=K7QD-4MXA')
    expect(text).toContain('Código de convite: K7QD-4MXA')
  })

  it('o link do WhatsApp codifica a mensagem', () => {
    expect(whatsAppLink('Olá & tudo bem?\nLink: https://x.y/?a=1')).toBe(
      `https://wa.me/?text=${encodeURIComponent('Olá & tudo bem?\nLink: https://x.y/?a=1')}`,
    )
  })
})

describe('copyText', () => {
  it('true quando o navegador copia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')
  })

  it('false quando recusa ou não existe (sem HTTPS, sem permissão)', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) },
    })
    expect(await copyText('abc')).toBe(false)
    vi.stubGlobal('navigator', {})
    expect(await copyText('abc')).toBe(false)
  })
})

describe('compartilhar', () => {
  it('só oferece quando o navegador tem a folha de compartilhar', () => {
    vi.stubGlobal('navigator', {})
    expect(canShare()).toBe(false)
    vi.stubGlobal('navigator', { share: vi.fn() })
    expect(canShare()).toBe(true)
  })

  it('manda título e texto', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    await shareText('Título', 'Texto')
    expect(share).toHaveBeenCalledWith({ title: 'Título', text: 'Texto' })
  })

  it('fechar a folha sem escolher nada não é erro', async () => {
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('', 'AbortError')),
    })
    await expect(shareText('T', 'x')).resolves.toBeUndefined()
  })
})
