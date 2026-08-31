"use client";

import { useEffect, useRef, useState } from "react";
import { IconEdit } from "./Icons";

export function InlineProgressEditor({
  label,
  value,
  meta,
  placeholder,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  meta?: string | null;
  placeholder: string;
  disabled?: boolean;
  onSave: (note: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setText(value ?? "");
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;

    // Wait until the pencil button's click has fully finished before moving
    // focus. Otherwise the textarea can receive focus and immediately blur,
    // which closes the editor before the user can type.
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  async function finishEditing() {
    const next = text.trim();
    const previous = (value ?? "").trim();
    if (!next) {
      setText(previous);
      setState("error");
      setEditing(false);
      return;
    }
    if (next === previous) {
      setEditing(false);
      setState("idle");
      return;
    }
    setState("saving");
    try {
      await onSave(next);
      setState("saved");
      setEditing(false);
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px dashed var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 12.5 }}>{label}</strong>
        {!editing ? (
          <button
            type="button"
            className="btn"
            data-size="sm"
            title={`编辑${label}`}
            aria-label={`编辑${label}`}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setState("idle"); setEditing(true); }}
            style={{ minWidth: 30, padding: "4px 7px" }}
          >
            <IconEdit size={13} />
          </button>
        ) : null}
      </div>
      {editing ? (
        <textarea
          ref={inputRef}
          className="field"
          value={text}
          maxLength={300}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void finishEditing()}
          style={{ width: "100%", marginTop: 6, resize: "vertical", lineHeight: 1.5 }}
        />
      ) : (
        <>
          <div style={{ marginTop: 5, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
            {value?.trim() || <span className="muted">点击铅笔填写</span>}
          </div>
          {meta ? <div className="muted" style={{ marginTop: 3, fontSize: 11.5 }}>{meta}</div> : null}
        </>
      )}
      <div className="muted" style={{ marginTop: 4, minHeight: 16, fontSize: 11.5 }}>
        {editing ? "填写后点到别处自动保存" : state === "saving" ? "正在自动保存…" : state === "saved" ? "已自动保存" : state === "error" ? "内容不能为空，或保存失败，请重试" : ""}
      </div>
    </div>
  );
}
