"use client";

import { useId, useMemo, useState } from "react";
import { formatDate, type EventRow } from "@/lib/listings";

type EventNameFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (event: EventRow) => void;
  upcomingEvents: EventRow[];
  placeholder?: string;
  testId?: string;
};

// Text input that suggests upcoming events while typing (ARIA combobox with a listbox).
export default function EventNameField({
  id,
  value,
  onChange,
  onPick,
  upcomingEvents,
  placeholder,
  testId,
}: EventNameFieldProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const typed = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!typed) return [];
    return upcomingEvents.filter((e) => e.name.toLowerCase().includes(typed)).slice(0, 6);
  }, [upcomingEvents, typed]);

  const showSuggestions = open && suggestions.length > 0;

  function pick(event: EventRow) {
    onPick(event);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActiveIndex((i) => (i + 1) % suggestions.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      e.preventDefault();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      pick(suggestions[activeIndex]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="combo">
      <input
        id={id}
        type="text"
        required
        maxLength={140}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        aria-controls={listboxId}
        aria-activedescendant={showSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid={testId}
      />
      <ul id={listboxId} role="listbox" aria-label="Upcoming events" className="suggestions" hidden={!showSuggestions}>
        {suggestions.map((s, i) => (
          <li
            key={s.id}
            id={`${listboxId}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            className={`suggestion ${i === activeIndex ? "suggestion-active" : ""}`}
            // Keep focus in the input so the click lands before blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(s)}
          >
            <span className="suggestion-name">{s.name}</span>
            <span>{formatDate(s.event_date)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
