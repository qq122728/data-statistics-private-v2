"use client";

import { Key, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function ChangePasswordForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 12) {
      setError("新密码至少需要 12 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "修改失败，请稍后再试");
        return;
      }
      router.replace("/login?passwordChanged=1");
      router.refresh();
    } catch {
      setError("网络连接失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.replace("/login");
    } catch {
      setError("退出失败，请稍后再试");
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-white px-6 py-6">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-blue-600 p-2.5 text-white"><Key size={23} weight="bold" /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-950">修改登录密码</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{userName}，请使用只有你自己知道的新密码。</p>
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-5 px-6 py-6">
        <label className="block text-sm font-semibold text-slate-800">
          当前密码
          <span className="relative mt-2 block"><LockKey className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" required className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="请输入当前登录密码" /></span>
        </label>
        <label className="block text-sm font-semibold text-slate-800">
          新密码
          <span className="relative mt-2 block"><LockKey className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} required className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="至少 12 位" /></span>
        </label>
        <label className="block text-sm font-semibold text-slate-800">
          确认新密码
          <span className="relative mt-2 block"><LockKey className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} required className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="请再次输入新密码" /></span>
        </label>
        {error ? <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-3 rounded-lg bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-600"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={19} weight="fill" /><p>保存后，所有已登录设备都会退出。请使用新密码重新登录。</p></div>
        <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "正在处理…" : "确认修改密码"}</button>
        <button type="button" disabled={busy} onClick={signOut} className="w-full rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">退出登录</button>
      </form>
    </section>
  );
}
