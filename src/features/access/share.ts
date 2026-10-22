import { formatInviteCode } from '@/domain/access'

/** Copiar e compartilhar o que o administrador manda para os fornecedores. */

export function activationMessage(supplierName: string, url: string): string {
  return `Olá, ${supplierName}! Este é o seu acesso à Agenda de Degustações. Abra o link e escolha a sua senha: ${url}`
}

export function inviteMessage(url: string, code: string): string {
  return `Você foi convidado para a Agenda de Degustações. Crie a sua conta por este link: ${url}\nCódigo de convite: ${formatInviteCode(code)}`
}

/** Abre o WhatsApp (app ou web) com a mensagem pronta, sem escolher o contato. */
export function whatsAppLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

/** true quando a cópia funcionou. Sem permissão ou sem HTTPS o navegador recusa: quem chama avisa. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** A folha de compartilhar do celular (o navegador de computador costuma não ter). */
export function canShare(): boolean {
  return typeof navigator.share === 'function'
}

/** Quem fecha a folha de compartilhar sem escolher nada não é erro. */
export async function shareText(title: string, text: string): Promise<void> {
  try {
    await navigator.share({ title, text })
  } catch {
    // cancelado ou sem suporte
  }
}
