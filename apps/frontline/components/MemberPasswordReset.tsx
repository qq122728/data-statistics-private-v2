"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./MemberPasswordReset.module.css";

type Props = {
  member: { id: string; name: string; username: string; active: boolean };
  onClose: () => void;
  onSuccess: () => void;
};

export default function MemberPasswordReset({ member, onClose, onSuccess }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    passwordRef.current?.focus();
    return () => dialog?.close();
  }, []);

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (password.length < 6 || password.length > 256) {
      setError("临时密码长度必须在 6 到 256 位之间");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的临时密码不一致，请重新核对");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/lead/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: member.id, password }),
      });
      setPassword("");
      setConfirmation("");
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码重置失败，请重试");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="member-password-title" aria-describedby="member-password-note" onCancel={(event) => { event.preventDefault(); if (!submittingRef.current) onClose(); }}>
    <form className="team-dialog" onSubmit={resetPassword} aria-busy={saving}>
      <header><div><h2 id="member-password-title">重置密码 · {member.name}</h2><p>登录账号：{member.username}</p></div><button type="button" disabled={saving} aria-label="关闭重置密码" onClick={onClose}>×</button></header>
      <div id="member-password-note" className="team-dialog__note">确认后，旧密码立即失效，该组员已登录的设备会退出。请把临时密码交给本人，下次登录须先修改密码。{member.active ? "" : "该账号当前已停用，重置密码不会启用账号。"}</div>
      <label><span>临时密码</span><input ref={passwordRef} type="password" autoComplete="new-password" value={password} disabled={saving} onChange={(event) => { setPassword(event.target.value); setError(""); }} required minLength={6} maxLength={256} placeholder="至少 6 位" aria-describedby={error ? "member-password-error" : undefined} /></label>
      <label><span>再次输入临时密码</span><input type="password" autoComplete="new-password" value={confirmation} disabled={saving} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} required minLength={6} maxLength={256} placeholder="再输入一次，防止输错" aria-describedby={error ? "member-password-error" : undefined} /></label>
      {error ? <div id="member-password-error" className={styles.error} role="alert">{error}</div> : null}
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="fresh-primary" disabled={saving}>{saving ? "正在重置…" : "确认重置密码"}</button></footer>
    </form>
  </dialog>;
}
