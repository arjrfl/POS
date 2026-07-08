import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null, // { id, username, role_name }
      token: null,
      isAuthenticated: false,

      login: (userData, token) => set({ user: userData, token, isAuthenticated: true }),

      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      // Kiosk terminal: session must not survive a browser close.
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)
