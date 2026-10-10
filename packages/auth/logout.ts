/** Do not navigate away until the server has actually revoked this login. */
export async function logoutSession() {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error("退出请求未成功");
}
