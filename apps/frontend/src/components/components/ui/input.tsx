import * as React from "react"

import { cn } from "@/components/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full rounded-xl text-base text-slate-900 placeholder:text-slate-500 caret-slate-900 transition-[box-shadow,filter] focus-visible:outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 md:text-sm glass-input font-body dark:text-slate-50 dark:placeholder:text-slate-400 dark:caret-slate-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
