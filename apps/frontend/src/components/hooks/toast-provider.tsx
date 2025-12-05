"use client";

import * as React from 'react';
import {
  Toast as PrimitiveToast,
  ToastDescription,
  ToastTitle,
  ToastProvider as PrimitiveToastProvider,
  ToastViewport,
} from '@/components/components/ui/toast';
import { ToastContext, type ToastItem, type ToastVariant } from './use-toast';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback(
    (description: string, variant: ToastVariant = 'success', title?: string) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, description, variant, title }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      <PrimitiveToastProvider swipeDirection="right">
        {children}
        <ToastViewport>
          {toasts.map((toastItem) => (
            <PrimitiveToast
              key={toastItem.id}
              variant={toastItem.variant === 'error' ? 'destructive' : 'default'}
              className={toastItem.variant === 'error' ? 'border-destructive bg-destructive/90' : 'border border-border'}
            >
              {toastItem.title && <ToastTitle>{toastItem.title}</ToastTitle>}
              <ToastDescription>{toastItem.description}</ToastDescription>
            </PrimitiveToast>
          ))}
        </ToastViewport>
      </PrimitiveToastProvider>
    </ToastContext.Provider>
  );
}
