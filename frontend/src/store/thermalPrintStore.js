import { create } from 'zustand'

export const useThermalPrintStore = create((set) => ({
  transaction: null,

  // Fully independent of receiptPrintStore — a separate print job (80mm
  // thermal roll, ThermalPrintLayer) that never interacts with the existing
  // A5 Order Slip flow's store/layer/CSS.
  triggerThermalPrint: (transaction) => set({ transaction }),
  clearThermalPrint: () => set({ transaction: null }),
}))
