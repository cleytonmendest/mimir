import type { SyncGateway } from '@/lib/supabase/sync-gateway'
import {
  openDeviceStore,
  openUserStore,
  type DeviceStore,
  type StoreDeps,
  type UserStore,
} from './store'
import { createSyncEngine, type SyncEngine } from './sync-engine'
import { attachSyncTriggers } from './sync-triggers'

/** Tudo o que o aparelho tem para quem está usando o app agora: a fila, o motor que a envia e os gatilhos. */
export interface UserSession {
  userId: string
  deviceId: string
  store: UserStore
  engine: SyncEngine
  /** Desliga os gatilhos, para o motor e fecha o banco (ao sair da tela ou trocar de usuário). */
  close: () => void
}

export interface OfflineRuntime {
  device: DeviceStore
  openUser: (userId: string) => Promise<UserSession>
}

/**
 * Monta o que é do aparelho (identidade, `deviceId`) e ensina a abrir a sessão de cada usuário. Falha
 * com OfflineStoreError se o navegador não deixa guardar dados (modo privado, bloqueio): o app não
 * funciona sem isso, então quem chama mostra uma mensagem em vez de seguir sem fila.
 */
export async function createOfflineRuntime(
  gateway: SyncGateway,
  deps: StoreDeps = {},
): Promise<OfflineRuntime> {
  const device = await openDeviceStore(deps)

  return {
    device,
    openUser: async (userId) => {
      const store = await openUserStore(userId, deps)
      try {
        const deviceId = await device.deviceId()
        const engine = createSyncEngine({ store, gateway, deviceId })
        const detach = attachSyncTriggers(engine)
        return {
          userId,
          deviceId,
          store,
          engine,
          close: () => {
            detach()
            engine.stop()
            store.close()
          },
        }
      } catch (error) {
        store.close()
        throw error
      }
    },
  }
}
