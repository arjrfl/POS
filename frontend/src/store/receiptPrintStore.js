import { create } from 'zustand'

export const useReceiptPrintStore = create((set) => ({
  transaction: null,
  tin: '',
  busStyle: '',

  // tin/busStyle are per-print-job values collected by PrintDetailsModal —
  // never persisted beyond this single print, cleared with the transaction.
  triggerPrint: (transaction, tin = '', busStyle = '') => set({ transaction, tin, busStyle }),
  clearPrint: () => set({ transaction: null, tin: '', busStyle: '' }),
}))
