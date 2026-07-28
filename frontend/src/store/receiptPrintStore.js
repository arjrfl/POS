import { create } from 'zustand'

export const useReceiptPrintStore = create((set) => ({
  transactions: [],
  tin: '',
  busStyle: '',

  // transactions is always an array — 1 entry prints exactly as a single
  // page always has, 2 entries (original + its linked adjustment/refund
  // child) print as a 2-page job, see ReceiptPrintLayer. tin/busStyle are
  // per-print-job values collected by PrintDetailsModal, applied identically
  // to every page — never persisted, cleared together with transactions.
  triggerPrint: (transactions, tin = '', busStyle = '') => set({ transactions, tin, busStyle }),
  clearPrint: () => set({ transactions: [], tin: '', busStyle: '' }),
}))
