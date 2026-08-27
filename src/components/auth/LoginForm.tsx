"use client";

import { ChartLineUp, LockKey, User } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { getSafeNextPath } from "../../lib/navigation";

export function LoginForm({ appName }: { appName: string }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "登录失败，请稍后再试");
        return;
      }

      const payload = await response.json().catch(() => ({}));
      if (payload.mustChangePassword === true) {
        window.location.replace("/change-password");
        return;
      }

      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(getSafeNextPath(next, window.location.origin));
    } catch {
      setError("网络连接失败，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white text-slate-900 lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-[#0b111b] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#0b66ff]"><ChartLineUp size={22} weight="bold" /></div><div><p className="text-lg font-bold">{appName}</p><p className="text-[10px] uppercase tracking-[.16em] text-slate-500">Data Console</p></div></div></div>
        <div className="max-w-lg"><p className="mb-5 text-xs font-semibold uppercase tracking-[.18em] text-blue-400">Make every number count</p><h2 className="text-4xl font-semibold leading-tight tracking-tight">让团队的每一次转化，<br />都有数据可循。</h2><p className="mt-5 max-w-md text-sm leading-7 text-slate-400">集中录入、追踪和分析提交号码到成交的完整链路，让每天的运营动作更清晰。</p></div>
        <p className="text-xs text-slate-600">© 2026 {appName}</p>
      </section>
      <section className="flex items-center justify-center bg-[#f7f9fc] px-5 py-12">
      <div data-testid="login-card" className="w-full max-w-[420px] rounded-xl border border-slate-200 bg-white p-8 shadow-[0_18px_60px_rgba(16,24,40,.08)] sm:p-10">
        <div className="mb-7 lg:hidden"><div className="grid size-11 place-items-center rounded-xl bg-[#0b66ff] text-white"><ChartLineUp size={23} weight="bold" /></div></div>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-600">Welcome back</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{appName}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">登录团队后台，开始今天的数据工作。</p>
        {searchParams.get("passwordChanged") === "1" ? <p role="status" className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">密码已修改，请使用新密码重新登录。</p> : null}

        <form className="mt-7 space-y-5" onSubmit={login}>
          <div className="relative">
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="username">账号</label>
            <User className="absolute bottom-3 left-3 text-slate-400" size={17} /><input className="control control-with-icon block w-full" id="username" name="username" autoComplete="username" placeholder="请输入账号" required />
          </div>
          <div className="relative">
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="password">密码</label>
            <LockKey className="absolute bottom-3 left-3 text-slate-400" size={17} /><input className="control control-with-icon block w-full" id="password" name="password" type="password" autoComplete="current-password" placeholder="请输入密码" required />
          </div>
          {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <button className="w-full rounded-lg bg-[#0b66ff] px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-[#0757dc] focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-blue-300" type="submit" disabled={submitting}>{submitting ? "正在登录…" : "登录工作台"}</button>
        </form>

        <p className="mt-6 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm leading-6 text-slate-500">请使用管理员分配的账号登录。首次登录后，请妥善保管账号与密码。</p>
      </div></section>
    </main>
  );
}
