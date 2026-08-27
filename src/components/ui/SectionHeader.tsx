import type { ReactNode } from "react";

export function SectionHeader({ title, description, action, className = "" }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <header className={`panel-header ${className}`}><div><h2 className="panel-title">{title}</h2>{description ? <p className="panel-subtitle">{description}</p> : null}</div>{action}</header>;
}
