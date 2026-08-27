import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    },
    useRef: <T,>(initial: T) =>
      (hooks.refs.shift() as { current: T } | undefined) ?? {
        current: initial,
      },
    useState: <T,>(initial: T) => [initial, vi.fn()],
  };
});

vi.mock("react-dom", () => ({ createPortal: (node: React.ReactNode) => node }));

import { HighRiskConfirmationDialog } from "../../src/components/admin/HighRiskConfirmationDialog";

(globalThis as { React?: typeof React }).React = React;

describe("admin high-risk dialog keyboard behavior", () => {
  beforeEach(() => {
    hooks.refs = [];
    hooks.cleanups = [];
  });

  it("focuses the reason, traps Tab, closes on Escape, and restores focus", () => {
    class ElementStub {}
    vi.stubGlobal("HTMLElement", ElementStub);
    const trigger = Object.assign(new ElementStub(), { focus: vi.fn() });
    const reason = {
      focus: vi.fn(),
      tabIndex: 0,
      getClientRects: () => [1],
    };
    const password = { focus: vi.fn(), tabIndex: 0, getClientRects: () => [1] };
    const cancel = { focus: vi.fn(), tabIndex: 0, getClientRects: () => [1] };
    const submit = { focus: vi.fn(), tabIndex: 0, getClientRects: () => [1] };
    const dialog = {
      focus: vi.fn(),
      contains: (value: unknown) => [reason, password, cancel, submit].includes(value as never),
      querySelectorAll: () => [reason, password, cancel, submit],
    };
    const background = {
      hasAttribute: vi.fn(() => false),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const documentStub = {
      activeElement: trigger as unknown,
      body: {},
      querySelector: vi.fn(() => background),
      addEventListener: vi.fn((name: string, listener: (event: Record<string, unknown>) => void) => listeners.set(name, listener)),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 1;
    });
    hooks.refs = [
      { current: dialog },
      { current: reason },
      { current: null },
      { current: false },
      { current: null },
    ];
    const onClose = vi.fn();

    const html = renderToStaticMarkup(createElement(HighRiskConfirmationDialog, {
      open: true,
      title: "确认停用小组",
      description: "停用会影响后续管理。",
      confirmLabel: "确认停用小组",
      onClose,
      onConfirm: vi.fn(async () => undefined),
    }));

    expect(html).toContain('aria-modal="true"');
    expect(background.setAttribute).toHaveBeenCalledWith("inert", "");
    expect(reason.focus).toHaveBeenCalledOnce();
    const keydown = listeners.get("keydown");
    expect(keydown).toBeTypeOf("function");

    documentStub.activeElement = submit;
    const tabEvent = { key: "Tab", shiftKey: false, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    keydown?.(tabEvent);
    expect(tabEvent.preventDefault).toHaveBeenCalledOnce();
    expect(reason.focus).toHaveBeenCalledTimes(2);

    const escapeEvent = { key: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() };
    keydown?.(escapeEvent);
    expect(escapeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    hooks.cleanups.forEach((cleanup) => cleanup());
    expect(background.removeAttribute).toHaveBeenCalledWith("inert");
    expect(trigger.focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
