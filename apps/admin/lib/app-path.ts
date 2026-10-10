/** Uses the same build-time prefix as next.config; standalone development may use no prefix. */
export function adminPath(path: `/${string}`) {
  return `${process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? ""}${path}`;
}
