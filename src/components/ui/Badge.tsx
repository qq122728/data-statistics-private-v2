import type { HTMLAttributes } from "react";

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-600 ${className}`} {...props} />;
}
