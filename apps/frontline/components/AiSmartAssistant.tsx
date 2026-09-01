"use client";

import { useState } from "react";
import { ChatCircleDots, MagicWand, Minus, PaperPlaneTilt, X } from "@phosphor-icons/react";
import styles from "./AiSmartAssistant.module.css";

const quickActions = ["添加今日数据", "新增客户", "更新客户进度", "查询或纠正数据"];

type AiSmartAssistantProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextLabel: string;
};

/** 当前只实现对话壳与快捷入口；业务写入能力按确认后的步骤逐项接入。 */
export function AiSmartAssistant({ open, onOpenChange, contextLabel }: AiSmartAssistantProps) {
  const [input, setInput] = useState("");

  return <section className={styles.assistant} data-open={open}>
    <button type="button" className={styles.trigger} onClick={() => onOpenChange(!open)} aria-label="AI 智能助手" aria-expanded={open} aria-controls="ai-assistant-drawer">
      <MagicWand size={17} weight="fill" />
      <span>AI 智能助手</span>
    </button>
    {open ? <aside className={styles.drawer} id="ai-assistant-drawer" aria-label="AI 智能助手">
      <header className={styles.header}>
        <span className={styles.spark}><ChatCircleDots size={19} weight="fill" /></span>
        <div>
          <strong>AI 智能助手</strong>
          <small>{contextLabel}</small>
        </div>
        <div className={styles.windowActions}>
          <button type="button" aria-label="收起 AI 助手" title="收起" onClick={() => onOpenChange(false)}><Minus size={17} /></button>
          <button type="button" aria-label="关闭 AI 助手" title="关闭" onClick={() => { setInput(""); onOpenChange(false); }}><X size={17} /></button>
        </div>
      </header>
      <div className={styles.conversation} aria-label="AI 对话内容">
        <div className={styles.welcome}>
          <span><MagicWand size={22} weight="fill" /></span>
          <strong>需要处理什么？</strong>
          <p>选择一个入口，或者直接在下方输入。</p>
        </div>
        <div className={styles.quickActions}>
          {quickActions.map((action) => <button key={action} type="button" onClick={() => setInput(action)}>{action}</button>)}
        </div>
      </div>
      <form className={styles.composer} onSubmit={(event) => event.preventDefault()}>
        <input aria-label="AI 对话输入框" placeholder="输入你想处理的内容…" value={input} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" aria-label="发送" disabled><PaperPlaneTilt size={16} weight="fill" /></button>
      </form>
    </aside> : null}
  </section>;
}
