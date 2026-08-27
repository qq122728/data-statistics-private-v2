export function FieldError({ id, label, message }: { id: string; label: string; message?: string }) {
  if (!message) return null;
  return <span id={id} role="alert" className="mt-1 block text-sm text-red-700">{label}：{message}</span>;
}
