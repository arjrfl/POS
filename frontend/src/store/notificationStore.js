import { create } from 'zustand'

export const useNotificationStore = create((set) => ({
  lastEvent: null,

  setLastEvent: (event) => set({ lastEvent: event }),
}))
