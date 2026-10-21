import type { SyncEngine } from './sync-engine'

/** O que os gatilhos precisam do navegador; separado para o teste não depender de janela de verdade. */
export interface TriggerEnvironment {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}

/**
 * Quando o app deve tentar enviar sem ninguém pedir: o sinal voltou, ou a pessoa voltou para o app
 * (sair de outro app, destravar o celular). Não há Background Sync (não existe no iOS), então estes
 * dois eventos, mais abrir o app e cada ação registrada, são todo o "tempo real" que existe; a
 * repetição depois de uma falha é do próprio motor (espera crescente).
 * Devolve a função que desliga os gatilhos.
 */
export function attachSyncTriggers(
  engine: Pick<SyncEngine, 'sync'>,
  env: TriggerEnvironment = { window, document },
): () => void {
  const onOnline = () => {
    void engine.sync()
  }
  const onVisibility = () => {
    if (env.document.visibilityState === 'visible') void engine.sync()
  }

  env.window.addEventListener('online', onOnline)
  env.document.addEventListener('visibilitychange', onVisibility)
  return () => {
    env.window.removeEventListener('online', onOnline)
    env.document.removeEventListener('visibilitychange', onVisibility)
  }
}
