import type { useSubAccountActions } from '@/hooks/useSubAccount'

export type ToastApi = ReturnType<typeof import('@/hooks/useToast').useToast>['toast']
export type Actions = ReturnType<typeof useSubAccountActions>
