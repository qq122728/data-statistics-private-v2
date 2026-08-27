import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-[#0b66ff] text-white hover:bg-[#0757dc] border-transparent",
    secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    danger: "bg-white text-red-600 hover:bg-red-50 border-red-300",
  };
  return <button className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} {...props} />;
}
