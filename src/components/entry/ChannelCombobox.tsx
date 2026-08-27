"use client";

import { KeyboardEvent, MouseEvent, useEffect, useId, useMemo, useRef, useState } from "react";

export type EntryChannel = {
  id: string;
  name: string;
  groupId: string;
  channelType?: "SMS" | "ADS" | "REBATE";
};
export type ChannelChoice = { channelId?: string; channelName?: string };

const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");

export function chooseExistingChannel(_current: ChannelChoice, channelId: string): ChannelChoice {
  return { channelId };
}

export function typeNewChannel(_current: ChannelChoice, channelName: string): ChannelChoice {
  const name = channelName.trim();
  return name ? { channelName: name } : {};
}

export function canOfferChannelCreation(query: string, channels: EntryChannel[], allowCreate: boolean): boolean {
  return allowCreate && Boolean(query.trim()) && !channels.some((channel) => normalize(channel.name) === normalize(query));
}

export function channelQueryForChoice(choice: ChannelChoice, channels: EntryChannel[]): string {
  return channels.find((channel) => channel.id === choice.channelId)?.name ?? choice.channelName ?? "";
}

export function requiresChannelGroup(isAdmin: boolean, groupId: string): boolean {
  return isAdmin && !groupId;
}

export function channelQueryAfterSearchBlur(query: string, choice: ChannelChoice, channels: EntryChannel[], allowCreate: boolean): string {
  return allowCreate ? query : channelQueryForChoice(choice, channels);
}

export function ChannelCombobox({ channels, value, onChange, error, allowCreate, disabled, disabledMessage }: {
  channels: EntryChannel[];
  value: ChannelChoice;
  onChange: (choice: ChannelChoice) => void;
  error?: string;
  allowCreate: boolean;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const [query, setQuery] = useState(channelQueryForChoice(value, channels));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const choosingOption = useRef(false);
  const trimmed = query.trim();
  const normalizedQuery = normalize(query);
  const visible = useMemo(() => channels.filter((channel) => !normalizedQuery || normalize(channel.name).includes(normalizedQuery)), [channels, normalizedQuery]);
  const canCreate = canOfferChannelCreation(query, channels, allowCreate);
  const options = canCreate ? [...visible, null] : visible;

  useEffect(() => {
    setQuery(channelQueryForChoice(value, channels));
  }, [channels, value.channelId, value.channelName]);

  function choose(channel: EntryChannel) {
    setQuery(channel.name); setOpen(false); onChange(chooseExistingChannel(value, channel.id));
    setTimeout(() => { choosingOption.current = false; }, 150);
  }
  function create() {
    if (!trimmed) return;
    setQuery(trimmed); setOpen(false); onChange(typeNewChannel(value, trimmed));
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && open && options.length) { event.preventDefault(); const choice = options[activeIndex]; if (choice) choose(choice); else create(); }
    else if (event.key === "Escape") setOpen(false);
  }
  function onBlur() {
    blurTimer.current = setTimeout(() => {
      setOpen(false);
      if (!choosingOption.current) setQuery(channelQueryAfterSearchBlur(query, value, channels, allowCreate));
      choosingOption.current = false;
    }, 120);
  }
  function onOptionMouseDown(event: MouseEvent<HTMLButtonElement>) {
    choosingOption.current = true;
    event.preventDefault();
  }

  return <div className="relative grid gap-1.5">
    <label htmlFor={inputId} className="field-label">渠道</label>
    <input id={inputId} aria-label="渠道" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-invalid={error ? true : undefined} value={query} disabled={disabled} onFocus={() => setOpen(true)} onBlur={onBlur} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); onChange(allowCreate ? typeNewChannel(value, event.target.value) : {}); }} onKeyDown={onKeyDown} placeholder={disabled ? "请先选择所属小组" : allowCreate ? "搜索或输入新渠道" : "搜索并选择已有渠道"} className="control w-full disabled:cursor-not-allowed disabled:bg-slate-100" />
    {open && <div id={listId} role="listbox" className="absolute top-full z-20 mt-1 max-h-52 w-full overflow-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
      {visible.map((channel, index) => <button key={channel.id} type="button" role="option" aria-selected={value.channelId === channel.id} onMouseDown={onOptionMouseDown} onClick={() => choose(channel)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 ${activeIndex === index ? "bg-slate-100" : ""}`}>{channel.name}</button>)}
      {canCreate && <button type="button" role="option" onMouseDown={onOptionMouseDown} onClick={create} className={`block w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 ${activeIndex === visible.length ? "bg-blue-50" : ""}`}>创建渠道：{trimmed}</button>}
      {!visible.length && !canCreate && <p className="px-3 py-2 text-sm text-slate-500">没有可选渠道</p>}
    </div>}
    {disabledMessage && <p className="text-sm text-slate-500">{disabledMessage}</p>}
  </div>;
}
