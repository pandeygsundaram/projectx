import axios from 'axios'
import { toast } from 'sonner'

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: Add auth token to all requests
apiClient.interceptors.request.use(
  (config) => {
    // Get token from localStorage
    if (typeof window !== 'undefined') {
      const authStorage = localStorage.getItem('auth-storage')
      if (authStorage) {
        try {
          const { state } = JSON.parse(authStorage)
          const token = state?.token
          if (token) {
            config.headers.Authorization = `Bearer ${token}`
          }
        } catch (error) {
          console.error('Failed to parse auth storage:', error)
        }
      }
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor: Handle errors globally
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const status = error.response.status
      const message = error.response.data?.error || error.message

      // Handle 401 Unauthorized
      if (status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth-storage')
          toast.error('Session expired. Please login again.')
          window.location.href = '/login'
        }
      }
      // Handle 403 Forbidden
      else if (status === 403) {
        toast.error('Access denied')
      }
      // Handle 404 Not Found
      else if (status === 404) {
        toast.error('Resource not found')
      }
      // Handle 409 Conflict
      else if (status === 409) {
        toast.error(message)
      }
      // Handle 500+ Server Errors
      else if (status >= 500) {
        toast.error('Server error. Please try again later.')
      }
      // Default error handling
      else {
        toast.error(message || 'An error occurred')
      }
    } else if (error.request) {
      toast.error('Network error. Please check your connection.')
    } else {
      toast.error('An unexpected error occurred')
    }

    return Promise.reject(error)
  }
)

export default apiClient
