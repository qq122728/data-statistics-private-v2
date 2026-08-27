import type { TableHTMLAttributes } from "react";

export function DataTable({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="data-table-wrap"><table className={`data-table ${className}`} {...props} /></div>;
}
