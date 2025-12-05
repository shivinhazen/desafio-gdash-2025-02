import * as React from 'react'

export type ToastVariant = 'success' | 'error'

export type ToastItem = {
  id: number
  title?: string
  description: string
  variant: ToastVariant
}

export type ToastContextValue = {
  toast: (description: string, variant?: ToastVariant, title?: string) => void
}

export const ToastContext = React.createContext<ToastContextValue | undefined>(undefined)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
