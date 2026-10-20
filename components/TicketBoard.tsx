"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TicketCard from "./TicketCard";

type Category = "Events" | "Transport";

type EventRow = {
  id: string;
  name: string;
  event_date: string | null;
  category: Category;
  created_by: string | null;
  created_at: string;
};

type Ticket = {
  id: string;
  user_id: string;
  event_id: string;
  price: number | null;
  paid_price: number | null;
  contact: string | null;
  sold: boolean;
  created_at: string;
};

type Tab = "All" | Category;

const priceFormat = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const wholePriceFormat = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

// "€15" for whole euros, "€12.50" otherwise, so prices fit the ticket stub.
function formatEuros(amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? wholePriceFormat.format(rounded) : priceFormat.format(rounded);
}

function formatPrice(price: number | null) {
  return price === null ? "Ask seller" : formatEuros(price);
}

function formatDate(date: string | null) {
  if (!date) return "Date not set";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Today as YYYY-MM-DD in Madrid, the same day boundary post_ticket uses.
function todayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Add fetched rows to what is already in state (a ticket may be posted before the first load ends).
function mergeById<T extends { id: string }>(fetched: T[], current: T[]) {
  const ids = new Set(fetched.map((row) => row.id));
  return [...fetched, ...current.filter((row) => !ids.has(row.id))];
}

function toNumber(value: number | string | null) {
  return value === null ? null : Number(value);
}

function parseAmount(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// "3 tickets for sale, from €12, average €14.50", counting unsold priced tickets only.
function summarize(tickets: Ticket[]) {
  const unsold = tickets.filter((t) => !t.sold);
  const count = `${unsold.length} ${unsold.length === 1 ? "ticket" : "tickets"} for sale`;
  const prices = unsold.map((t) => toNumber(t.price)).filter((p): p is number => p !== null);
  if (prices.length === 0) return count;
  const min = Math.min(...prices);
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  return `${count}, from ${formatEuros(min)}, average ${formatEuros(avg)}`;
}

// Unsold first, then cheapest first (no price last), then newest.
function compareTickets(a: Ticket, b: Ticket) {
  if (a.sold !== b.sold) return a.sold ? 1 : -1;
  const pa = toNumber(a.price);
  const pb = toNumber(b.price);
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  return b.created_at.localeCompare(a.created_at);
}

// Soonest date first, undated last, then newest.
function compareEvents(a: EventRow, b: EventRow) {
  if (a.event_date !== b.event_date) {
    if (a.event_date === null) return 1;
    if (b.event_date === null) return -1;
    return a.event_date.localeCompare(b.event_date);
  }
  return b.created_at.localeCompare(a.created_at);
}

export default function TicketBoard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const listboxId = useId();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventName, setEventName] = useState("");
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [price, setPrice] = useState("");
  const [paidPrice, setPaidPrice] = useState("");
  const [contact, setContact] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [category, setCategory] = useState<Category>("Events");
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");

  // Drive the one-off slide-in and stamp animations.
  const [newId, setNewId] = useState<string | null>(null);
  const [justSoldId, setJustSoldId] = useState<string | null>(null);

  // Clear an animation id once it has played, so remounts (tab switches) don't replay it.
  function playOnce(set: (fn: (cur: string | null) => string | null) => void, id: string) {
    set(() => id);
    window.setTimeout(() => set((cur) => (cur === id ? null : cur)), 700);
  }

  // Keyboard focus to restore after a ticket moves or disappears.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const today = todayString();

  useEffect(() => {
    Promise.all([
      supabase
        .from("events")
        .select("*")
        .or(`event_date.is.null,event_date.gte.${todayString()}`)
        .order("created_at", { ascending: false }),
      supabase.from("tickets").select("*").order("created_at", { ascending: false }),
    ]).then(([eventsRes, ticketsRes]) => {
      const failed = eventsRes.error ?? ticketsRes.error;
      if (failed) setError(failed.message);
      else {
        setEvents((prev) => mergeById((eventsRes.data ?? []) as EventRow[], prev));
        setTickets((prev) => mergeById((ticketsRes.data ?? []) as Ticket[], prev));
      }
      setLoading(false);
    });
  }, [supabase]);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "list") listHeadingRef.current?.focus();
    else document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const upcomingEvents = useMemo(
    () => events.filter((e) => e.event_date === null || e.event_date >= today).sort(compareEvents),
    [events, today]
  );

  // The existing event this ticket will be added to, if any.
  const typedName = eventName.trim().toLowerCase();
  const matchedEvent = useMemo(() => {
    const picked = upcomingEvents.find((e) => e.id === pickedEventId);
    if (picked && picked.name.toLowerCase() === typedName) return picked;
    return upcomingEvents.find((e) => e.name.trim().toLowerCase() === typedName) ?? null;
  }, [upcomingEvents, pickedEventId, typedName]);

  const suggestions = useMemo(() => {
    if (!typedName) return [];
    return upcomingEvents.filter((e) => e.name.toLowerCase().includes(typedName)).slice(0, 6);
  }, [upcomingEvents, typedName]);

  const showSuggestions = suggestOpen && suggestions.length > 0;

  function pickSuggestion(event: EventRow) {
    setEventName(event.name);
    setPickedEventId(event.id);
    setSuggestOpen(false);
    setActiveIndex(-1);
  }

  function handleEventKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        setSuggestOpen(true);
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
      pickSuggestion(suggestions[activeIndex]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
      setActiveIndex(-1);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = eventName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    setSuggestOpen(false);

    const isNewEvent = matchedEvent === null;
    const { data, error } = await supabase.rpc("post_ticket", {
      p_event_name: name,
      p_event_id: matchedEvent?.id ?? null,
      p_event_date: isNewEvent && eventDate ? eventDate : null,
      p_category: isNewEvent ? category : "Events",
      p_price: parseAmount(price),
      p_paid_price: parseAmount(paidPrice),
      p_contact: contact.trim() || null,
    });

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    const { event, ticket } = data as { event: EventRow; ticket: Ticket };
    setEvents((prev) => (prev.some((x) => x.id === event.id) ? prev : [...prev, event]));
    setTickets((prev) => [ticket, ...prev]);
    playOnce(setNewId, ticket.id);
    setEventName("");
    setPickedEventId(null);
    setPrice("");
    setPaidPrice("");
    setContact("");
    setEventDate("");
    setCategory("Events");
  }

  async function toggleSold(ticket: Ticket) {
    const { data, error } = await supabase
      .from("tickets")
      .update({ sold: !ticket.sold })
      .eq("id", ticket.id)
      .select()
      .single();
    if (error) return setError(error.message);
    if (!ticket.sold) playOnce(setJustSoldId, ticket.id);
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? (data as Ticket) : t)));
    setFocusTarget(`toggle-${ticket.id}`);
  }

  async function deleteTicket(ticket: Ticket, name: string) {
    if (!window.confirm(`Delete your ticket for "${name}"?`)) return;
    const { error } = await supabase.from("tickets").delete().eq("id", ticket.id);
    if (error) return setError(error.message);
    setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
    setFocusTarget("list");
  }

  // Upcoming events that have tickets, filtered by tab and search, each with its sorted tickets.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return upcomingEvents
      .filter((e) => tab === "All" || e.category === tab)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((event) => ({
        event,
        tickets: tickets.filter((t) => t.event_id === event.id).sort(compareTickets),
      }))
      .filter((g) => g.tickets.length > 0);
  }, [upcomingEvents, tickets, tab, search]);

  const hasAnyListing = useMemo(
    () => upcomingEvents.some((e) => tickets.some((t) => t.event_id === e.id)),
    [upcomingEvents, tickets]
  );

  return (
    <div className="board">
      <form onSubmit={handleSubmit} className="sell-form">
        <h1 className="sell-heading">Sell a ticket</h1>
        <label htmlFor="event-name" className="label">
          Which event?
        </label>
        <div className="sell-row">
          <div className="combo">
            <input
              id="event-name"
              type="text"
              required
              maxLength={140}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={listboxId}
              aria-activedescendant={
                showSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
              }
              value={eventName}
              onChange={(e) => {
                setEventName(e.target.value);
                setPickedEventId(null);
                setSuggestOpen(true);
                setActiveIndex(-1);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => {
                setSuggestOpen(false);
                setActiveIndex(-1);
              }}
              onKeyDown={handleEventKeyDown}
              placeholder="e.g. Thursday party at Kapital"
              data-testid="core-input"
            />
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Upcoming events"
              className="suggestions"
              hidden={!showSuggestions}
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.id}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`suggestion ${i === activeIndex ? "suggestion-active" : ""}`}
                  // Keep focus in the input so the click lands before blur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                >
                  <span className="suggestion-name">{s.name}</span>
                  <span>{formatDate(s.event_date)}</span>
                </li>
              ))}
            </ul>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving} data-testid="core-submit">
            {saving ? "Posting…" : "Post ticket"}
          </button>
        </div>
        <p className="match-note" role="status">
          {matchedEvent ? `Adding to ${matchedEvent.name}, ${formatDate(matchedEvent.event_date)}.` : ""}
        </p>

        <details className="details">
          <summary>Add details</summary>
          <div className="form-grid">
            <label className="field">
              <span className="label">Price (€)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="field">
              <span className="label">What you paid (€)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={paidPrice}
                onChange={(e) => setPaidPrice(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="field field-wide">
              <span className="label">How to reach you</span>
              <input
                type="text"
                maxLength={140}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="e.g. Instagram @yourname"
              />
            </label>
            {!matchedEvent && (
              <>
                <label className="field">
                  <span className="label">Event date</span>
                  <input type="date" min={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">Category</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                    <option value="Events">Events</option>
                    <option value="Transport">Transport</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </details>

        <p className="safety-note" role="note">
          Only sell tickets that can be passed on. Check who you&apos;re buying from, meet in person if
          you can, and check the ticket before paying.
        </p>
      </form>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="listings-heading" className="listings">
        <h2 id="listings-heading" className="visually-hidden" tabIndex={-1} ref={listHeadingRef}>
          Tickets for sale
        </h2>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Filter by category">
            {(["All", "Events", "Transport"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                className={`tab ${tab === t ? "tab-active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <label className="field toolbar-search">
            <span className="label">Search events</span>
            <input
              type="search"
              placeholder="Search by event name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <p className="status-text" role="status">
          {loading
            ? "Loading tickets…"
            : groups.length === 0
              ? hasAnyListing
                ? "No events match your filters."
                : "No tickets yet. Post the first one."
              : ""}
        </p>
        {groups.length > 0 && (
          <div className="event-list">
            {groups.map(({ event, tickets: eventTickets }) => (
              <section key={event.id} className="event" aria-labelledby={`event-${event.id}`}>
                <header className="event-header">
                  <h3 id={`event-${event.id}`} className="event-name">
                    {event.name}
                  </h3>
                  <div className="event-meta">
                    <span className="tag">{event.category}</span>
                    <span>{formatDate(event.event_date)}</span>
                  </div>
                  <p className="event-summary">{summarize(eventTickets)}</p>
                </header>
                <ul className="ticket-list">
                  {eventTickets.map((t) => {
                    const mine = t.user_id === userId;
                    const paid = toNumber(t.paid_price);
                    return (
                      <TicketCard
                        key={t.id}
                        testId="core-item"
                        headingLevel={null}
                        title={event.name}
                        price={formatPrice(toNumber(t.price))}
                        sold={t.sold}
                        isNew={t.id === newId}
                        justSold={t.id === justSoldId}
                        meta={
                          <>
                            {mine && <span className="tag">Your ticket</span>}
                            {paid !== null && <span>Seller paid {formatEuros(paid)}</span>}
                          </>
                        }
                      >
                        {t.contact && <p className="ticket-contact">Contact: {t.contact}</p>}
                        {mine && (
                          <div className="ticket-actions">
                            <button
                              type="button"
                              id={`toggle-${t.id}`}
                              className="btn btn-secondary"
                              onClick={() => toggleSold(t)}
                            >
                              {t.sold ? "Mark as available" : "Mark as sold"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => deleteTicket(t, event.name)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </TicketCard>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
