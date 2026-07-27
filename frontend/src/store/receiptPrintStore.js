import { create } from 'zustand'

export const useReceiptPrintStore = create((set) => ({
  transaction: null,

  triggerPrint: (transaction) => set({ transaction }),
  clearPrint: () => set({ transaction: null }),
}))
