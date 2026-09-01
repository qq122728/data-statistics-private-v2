"use client";

import { useState } from "react";
import { MagicWand, PaperPlaneTilt, X } from "@phosphor-icons/react";
import styles from "./AiSmartAssistant.module.css";

/** 当前只保留空白对话框；后续业务能力按确认后的步骤逐项接入。 */
export function AiSmartAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  return <section className={styles.assistant} data-open={open}>
    <button type="button" className={styles.bar} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className={styles.spark}><MagicWand size={18} weight="fill" /></span>
      <span><strong>AI 智能对话</strong></span>
      <i>{open ? "收起" : "打开"}</i>
    </button>
    {open ? <div className={styles.panel}>
      <header>
        <strong>AI 对话</strong>
        <button type="button" aria-label="关闭 AI 对话" onClick={() => setOpen(false)}><X size={16} /></button>
      </header>
      <div className={styles.blank} aria-label="AI 对话内容" />
      <form className={styles.composer} onSubmit={(event) => event.preventDefault()}>
        <input aria-label="AI 对话输入框" value={input} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" aria-label="发送" disabled><PaperPlaneTilt size={16} weight="fill" /></button>
      </form>
    </div> : null}
  </section>;
}
