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
    useRef: <T,>(initial: T) => hooks.refs.shift() as { current: T } ?? { current: initial },
  };
});

import { Drawer } from "../../src/components/ui/Drawer";

(globalThis as { React?: typeof React }).React = React;

describe("analysis drawer keyboard behavior", () => {
  beforeEach(() => {
    hooks.refs = [];
    hooks.cleanups = [];
  });

  it("moves focus into the dialog, traps Tab, closes on Escape, and restores the trigger", () => {
    class ElementStub {}
    vi.stubGlobal("HTMLElement", ElementStub);
    const trigger = Object.assign(new ElementStub(), { focus: vi.fn() });
    const closeButton = { focus: vi.fn(), tabIndex: 0, getClientRects: () => [1] };
    const lastLink = { focus: vi.fn(), tabIndex: 0, getClientRects: () => [1] };
    const dialog = {
      focus: vi.fn(),
      contains: (value: unknown) => value === closeButton || value === lastLink,
      querySelectorAll: () => [closeButton, lastLink],
    };
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const documentStub = {
      activeElement: trigger as unknown,
      addEventListener: vi.fn((name: string, listener: (event: Record<string, unknown>) => void) => listeners.set(name, listener)),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", documentStub);
    hooks.refs = [{ current: dialog }, { current: closeButton }, { current: null }];
    const onClose = vi.fn();

    const html = renderToStaticMarkup(createElement(Drawer, { title: "渠道详情", open: true, onClose, children: "详情" }));

    expect(html).toContain('role="dialog"');
    expect(closeButton.focus).toHaveBeenCalledOnce();
    const keydown = listeners.get("keydown");
    expect(keydown).toBeTypeOf("function");

    documentStub.activeElement = lastLink;
    const tabEvent = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    keydown?.(tabEvent);
    expect(tabEvent.preventDefault).toHaveBeenCalledOnce();
    expect(closeButton.focus).toHaveBeenCalledTimes(2);

    const escapeEvent = { key: "Escape", preventDefault: vi.fn() };
    keydown?.(escapeEvent);
    expect(escapeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    hooks.cleanups.forEach((cleanup) => cleanup());
    expect(trigger.focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
