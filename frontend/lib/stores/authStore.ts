import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, AuthResponse, LoginCredentials, SignupData } from '@/types'
import { toast } from 'sonner'

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  isHydrated: boolean

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>
  signup: (data: SignupData) => Promise<void>
  logout: () => void
  setUser: (user: User) => void
  setToken: (token: string) => void
  refreshProfile: () => Promise<void>
  setHydrated: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      isHydrated: false,

      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true })
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Login failed')
          }

          const data: AuthResponse = await response.json()
          set({ user: data.user, token: data.token, isLoading: false })
          toast.success('Logged in successfully!')
        } catch (error) {
          set({ isLoading: false })
          toast.error(error instanceof Error ? error.message : 'Login failed')
          throw error
        }
      },

      signup: async (signupData: SignupData) => {
        set({ isLoading: true })
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signupData),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Signup failed')
          }

          const data: AuthResponse = await response.json()
          set({ user: data.user, token: data.token, isLoading: false })
          toast.success('Account created successfully!')
        } catch (error) {
          set({ isLoading: false })
          toast.error(error instanceof Error ? error.message : 'Signup failed')
          throw error
        }
      },

      logout: () => {
        set({ user: null, token: null })
        toast.success('Logged out successfully')
      },

      setUser: (user: User) => set({ user }),

      setToken: (token: string) => set({ token }),

      refreshProfile: async () => {
        const token = get().token
        if (!token) return

        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/profile`, {
            headers: { 'Authorization': `Bearer ${token}` },
          })

          if (!response.ok) {
            throw new Error('Failed to fetch profile')
          }

          const user: User = await response.json()
          set({ user })
        } catch (error) {
          console.error('Failed to refresh profile:', error)
          set({ user: null, token: null })
        }
      },

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    }
  )
)
