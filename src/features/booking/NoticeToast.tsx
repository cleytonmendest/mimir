import { useEffect } from 'react'
import { Toast } from '@/design-system/components/Toast/Toast'
import type { Notice } from './booking-controller'

const AUTO_DISMISS_MS = 7_000

/** Mostra o aviso e o tira sozinho depois de uns segundos, menos o erro: esse a pessoa fecha. */
export function NoticeToast({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const id = notice?.id
  const kind = notice?.kind
  useEffect(() => {
    if (id === undefined || kind === 'error') return
    const timer = setTimeout(onClose, AUTO_DISMISS_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [id, kind, onClose])

  if (notice === null) return null
  return (
    <Toast key={notice.id} kind={notice.kind} onClose={onClose}>
      {notice.text}
    </Toast>
  )
}
