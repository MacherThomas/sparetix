"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EventNameField from "./EventNameField";
import RequestForm from "./RequestForm";
import TicketCard from "./TicketCard";
import {
  TIME_SECTIONS,
  compareEvents,
  compareTickets,
  displayName,
  endOfWeek,
  formatDate,
  formatDay,
  formatEuros,
  formatPrice,
  matchEvent,
  mergeById,
  parseAmount,
  peopleLooking,
  priceHint,
  summarizeTickets,
  timeSection,
  toNumber,
  todayString,
  type Category,
  type EventRow,
  type Profile,
  type RequestRow,
  type Ticket,
} from "@/lib/listings";

type Tab = "All" | Category;

export default function TicketBoard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  // First names of the sellers and people looking that are on screen.
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventName, setEventName] = useState("");
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [paidPrice, setPaidPrice] = useState("");
  const [contact, setContact] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [category, setCategory] = useState<Category>("Events");
  const [saving, setSaving] = useState(false);

  const [requestFormOpen, setRequestFormOpen] = useState(false);
  // Per-event "I'm looking for one": optional contact typed before clicking, and pending clicks.
  const [lookingContact, setLookingContact] = useState<Record<string, string>>({});
  const [contactOpenFor, setContactOpenFor] = useState<string | null>(null);
  const [pendingLooking, setPendingLooking] = useState<Set<string>>(new Set());

  // The ticket or request a conversation is being opened for, and any error, shown next to its button.
  const [startingChat, setStartingChat] = useState<string | null>(null);
  const [chatError, setChatError] = useState<{ key: string; message: string } | null>(null);

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
  const weekEnd = endOfWeek(today);

  useEffect(() => {
    Promise.all([
      supabase
        .from("events")
        .select("*")
        .or(`event_date.is.null,event_date.gte.${todayString()}`)
        .order("created_at", { ascending: false }),
      supabase.from("tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("requests").select("*").order("created_at", { ascending: false }),
    ]).then(([eventsRes, ticketsRes, requestsRes]) => {
      const failed = eventsRes.error ?? ticketsRes.error;
      if (failed) setError(failed.message);
      else {
        setEvents((prev) => mergeById((eventsRes.data ?? []) as EventRow[], prev));
        setTickets((prev) => mergeById((ticketsRes.data ?? []) as Ticket[], prev));
        // Requests are extra: if they fail to load, tickets still work.
        if (requestsRes.error) setError(`Couldn't load "looking for" requests: ${requestsRes.error.message}`);
        else setRequests((prev) => mergeById((requestsRes.data ?? []) as RequestRow[], prev));
      }
      setLoading(false);
    });
  }, [supabase]);

  // Load first names for anyone new in the list (one request for all missing ids).
  useEffect(() => {
    const ids = new Set([...tickets.map((t) => t.user_id), ...requests.map((r) => r.user_id)]);
    const missing = [...ids].filter((id) => id !== userId && !profiles.has(id));
    if (missing.length === 0) return;
    supabase
      .from("profiles")
      .select("id, first_name")
      .in("id", missing)
      .then(({ data, error }) => {
        if (error) return; // Names are a nice-to-have; the list works without them.
        setProfiles((prev) => {
          const next = new Map(prev);
          for (const id of missing) next.set(id, { id, first_name: null });
          for (const p of (data ?? []) as Profile[]) next.set(p.id, p);
          return next;
        });
      });
  }, [tickets, requests, profiles, supabase, userId]);

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
  const matchedEvent = matchEvent(upcomingEvents, eventName, pickedEventId);
  const matchedTickets = useMemo(
    () => (matchedEvent ? tickets.filter((t) => t.event_id === matchedEvent.id) : []),
    [matchedEvent, tickets]
  );

  function addEvent(event: EventRow) {
    setEvents((prev) => (prev.some((x) => x.id === event.id) ? prev : [...prev, event]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = eventName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);

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
    addEvent(event);
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
    if (!window.confirm(`Delete your ticket for "${name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("tickets").delete().eq("id", ticket.id);
    if (error) return setError(error.message);
    setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
    setFocusTarget("list");
  }

  // "I'm looking for one": add my request, or remove it if I already have one.
  async function toggleLooking(event: EventRow, mine: RequestRow | undefined) {
    const setPending = (on: boolean) =>
      setPendingLooking((prev) => {
        const next = new Set(prev);
        if (on) next.add(event.id);
        else next.delete(event.id);
        return next;
      });
    setPending(true);
    setError(null);
    const buttonId = `looking-${event.id}`;

    if (mine) {
      const { error } = await supabase.from("requests").delete().eq("id", mine.id);
      setPending(false);
      if (error) {
        setError(error.message);
        setFocusTarget(buttonId);
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== mine.id));
    } else {
      const { data, error } = await supabase
        .from("requests")
        .insert({ event_id: event.id, user_id: userId, contact: lookingContact[event.id]?.trim() || null })
        .select()
        .single();
      setPending(false);
      if (error) {
        setError(error.code === "23505" ? "You're already looking for a ticket for this event." : error.message);
        setFocusTarget(buttonId);
        return;
      }
      setRequests((prev) => [data as RequestRow, ...prev]);
      setContactOpenFor(null);
      setLookingContact((prev) => ({ ...prev, [event.id]: "" }));
    }
    // Removing the last request of an event without tickets removes the event from the list.
    const eventStaysListed =
      !mine ||
      tickets.some((t) => t.event_id === event.id) ||
      requests.some((r) => r.event_id === event.id && r.id !== mine.id);
    setFocusTarget(eventStaysListed ? buttonId : "list");
  }

  // Open (or reuse) a private conversation about a ticket or a request, then go to it.
  async function startConversation(target: { ticketId?: string; requestId?: string }) {
    const key = target.ticketId ?? target.requestId ?? "";
    setStartingChat(key);
    setChatError(null);
    const { data, error } = await supabase.rpc("start_conversation", {
      p_ticket_id: target.ticketId ?? null,
      p_request_id: target.requestId ?? null,
    });
    if (error) {
      setStartingChat(null);
      setChatError({ key, message: error.message });
      return;
    }
    // Keep "Opening…" until the Messages page takes over.
    router.push(`/app/messages?c=${data as string}`);
  }

  function chatErrorFor(key: string) {
    return chatError?.key === key ? (
      <p className="alert alert-error chat-error" role="alert">
        {chatError.message}
      </p>
    ) : null;
  }

  function handleRequestAdded(event: EventRow, request: RequestRow) {
    addEvent(event);
    setRequests((prev) => (prev.some((r) => r.id === request.id) ? prev : [request, ...prev]));
  }

  // Upcoming events with tickets or requests, filtered by tab and search, grouped by time.
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = upcomingEvents
      .filter((e) => tab === "All" || e.category === tab)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((event) => ({
        event,
        tickets: tickets.filter((t) => t.event_id === event.id).sort(compareTickets),
        requests: requests.filter((r) => r.event_id === event.id),
      }))
      .filter((g) => g.tickets.length > 0 || g.requests.length > 0);
    return TIME_SECTIONS.map((name) => ({
      name,
      groups: groups.filter((g) => timeSection(g.event.event_date, today, weekEnd) === name),
    })).filter((s) => s.groups.length > 0);
  }, [upcomingEvents, tickets, requests, tab, search, today, weekEnd]);

  const hasAnyListing = useMemo(
    () =>
      upcomingEvents.some(
        (e) => tickets.some((t) => t.event_id === e.id) || requests.some((r) => r.event_id === e.id)
      ),
    [upcomingEvents, tickets, requests]
  );

  return (
    <div className="board">
      <div className="sell-area">
        <form onSubmit={handleSubmit} className="sell-form">
          <h1 className="sell-heading">Sell a ticket</h1>
          <label htmlFor="event-name" className="label">
            Which event?
          </label>
          <div className="sell-row">
            <EventNameField
              id="event-name"
              value={eventName}
              onChange={(v) => {
                setEventName(v);
                setPickedEventId(null);
              }}
              onPick={(event) => {
                setEventName(event.name);
                setPickedEventId(event.id);
              }}
              upcomingEvents={upcomingEvents}
              placeholder="e.g. Thursday party at Kapital"
              testId="core-input"
            />
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="core-submit">
              {saving ? "Posting…" : "Post ticket"}
            </button>
          </div>
          <div className="match-note" role="status">
            {matchedEvent && (
              <>
                <p>
                  Adding to {matchedEvent.name}, {formatDate(matchedEvent.event_date)}.
                </p>
                <p className="price-hint">{priceHint(matchedTickets)}</p>
              </>
            )}
          </div>

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

        <div className="request-toggle">
          <button
            type="button"
            className="btn btn-text"
            aria-expanded={requestFormOpen}
            aria-controls="request-panel"
            onClick={() => setRequestFormOpen((open) => !open)}
          >
            Looking for a ticket instead?
          </button>
        </div>
        <div id="request-panel" hidden={!requestFormOpen}>
          {requestFormOpen && (
            <RequestForm upcomingEvents={upcomingEvents} today={today} onAdded={handleRequestAdded} />
          )}
        </div>
      </div>

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
            : sections.length === 0
              ? hasAnyListing
                ? "No events match your filters."
                : "No tickets yet. Post the first one."
              : ""}
        </p>

        {sections.map((section) => {
          const sectionId = `section-${section.name.toLowerCase().replace(/\s+/g, "-")}`;
          return (
            <section
              key={section.name}
              className={`time-section ${section.name === "Today" ? "time-section-today" : ""}`}
              aria-labelledby={sectionId}
            >
              <h3 id={sectionId} className="time-heading">
                {section.name}
              </h3>
              <div className="event-list">
                {section.groups.map(({ event, tickets: eventTickets, requests: eventRequests }) => {
                  const myRequest = eventRequests.find((r) => r.user_id === userId);
                  // Everyone sees who is looking; sellers (anyone with a ticket for this event) can message them.
                  const iSell = eventTickets.some((t) => t.user_id === userId);
                  return (
                    <section key={event.id} className="event" aria-labelledby={`event-${event.id}`}>
                      <header className="event-header">
                        <h4 id={`event-${event.id}`} className="event-name">
                          {event.name}
                        </h4>
                        <div className="event-meta">
                          <span className="tag">{event.category}</span>
                          <span>{formatDate(event.event_date)}</span>
                        </div>
                        {eventTickets.length > 0 ? (
                          <>
                            <p className="event-summary">{summarizeTickets(eventTickets)}</p>
                            {eventRequests.length > 0 && <p>{peopleLooking(eventRequests.length)}</p>}
                          </>
                        ) : (
                          <p className="event-summary">No tickets yet, {peopleLooking(eventRequests.length)}</p>
                        )}

                        {!myRequest && contactOpenFor === event.id && (
                          <label className="field looking-contact" htmlFor={`looking-contact-${event.id}`}>
                            <span className="label">How to reach you (optional)</span>
                            <input
                              id={`looking-contact-${event.id}`}
                              type="text"
                              maxLength={140}
                              value={lookingContact[event.id] ?? ""}
                              onChange={(e) =>
                                setLookingContact((prev) => ({ ...prev, [event.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  toggleLooking(event, undefined);
                                }
                              }}
                              placeholder="e.g. Instagram @yourname"
                              aria-describedby={`looking-contact-hint-${event.id}`}
                            />
                            <span className="hint" id={`looking-contact-hint-${event.id}`}>
                              Sent when you press &ldquo;I&apos;m looking for one&rdquo;.
                            </span>
                          </label>
                        )}
                        <div className="looking">
                          <button
                            type="button"
                            id={`looking-${event.id}`}
                            className={`btn btn-secondary looking-button ${myRequest ? "looking-on" : ""}`}
                            aria-pressed={Boolean(myRequest)}
                            disabled={pendingLooking.has(event.id)}
                            onClick={() => toggleLooking(event, myRequest)}
                          >
                            I&apos;m looking for one
                          </button>
                          {myRequest ? (
                            <span className="looking-status">
                              You&apos;re on the list{myRequest.contact ? ` (${myRequest.contact})` : ""}. Click again to
                              stop.
                            </span>
                          ) : (
                            contactOpenFor !== event.id && (
                              <button
                                type="button"
                                className="btn btn-text"
                                onClick={() => {
                                  setContactOpenFor(event.id);
                                  setFocusTarget(`looking-contact-${event.id}`);
                                }}
                              >
                                Add how to reach you
                              </button>
                            )
                          )}
                        </div>
                        {eventRequests.length > 0 && (
                          <div className="people-looking">
                            <h5 className="people-looking-heading">People looking for this event</h5>
                            <ul className="people-looking-list">
                              {eventRequests.map((r) => (
                                <li key={r.id} className="person">
                                  <span className="person-text">
                                    {r.user_id === userId
                                      ? "You, looking"
                                      : displayName(profiles, r.user_id)
                                        ? `${displayName(profiles, r.user_id)}, looking`
                                        : "Looking"}{" "}
                                    since {formatDay(r.created_at)}
                                    {r.contact ? (
                                      <>
                                        {" "}
                                        · <span className="person-contact">{r.contact}</span>
                                      </>
                                    ) : (
                                      " · no contact given"
                                    )}
                                  </span>
                                  {iSell && r.user_id !== userId && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-small"
                                      disabled={startingChat === r.id}
                                      onClick={() => startConversation({ requestId: r.id })}
                                    >
                                      {startingChat === r.id ? "Opening…" : "Message"}
                                      <span className="visually-hidden">
                                        {" "}
                                        {displayName(profiles, r.user_id) ?? "the person"} looking since{" "}
                                        {formatDay(r.created_at)}
                                      </span>
                                    </button>
                                  )}
                                  {chatErrorFor(r.id)}
                                </li>
                              ))}
                            </ul>
                            {!iSell && eventRequests.some((r) => r.user_id !== userId) && (
                              <p className="hint seller-hint">
                                Have a ticket for this event? Post it above to message them here.
                              </p>
                            )}
                          </div>
                        )}
                      </header>

                      {eventTickets.length > 0 && (
                        <ul className="ticket-list">
                          {eventTickets.map((t) => {
                            const mine = t.user_id === userId;
                            const paid = toNumber(t.paid_price);
                            return (
                              <TicketCard
                                key={t.id}
                                testId="core-item"
                                headingLevel={null}
                                titleSize="small"
                                title={
                                  <>
                                    Ticket for <span className="ticket-event-name">{event.name}</span>
                                  </>
                                }
                                price={formatPrice(toNumber(t.price))}
                                sold={t.sold}
                                isNew={t.id === newId}
                                justSold={t.id === justSoldId}
                                meta={
                                  <>
                                    {mine ? (
                                      <span className="tag">Your ticket</span>
                                    ) : (
                                      displayName(profiles, t.user_id) && (
                                        <span>Sold by {displayName(profiles, t.user_id)}</span>
                                      )
                                    )}
                                    {paid !== null && <span>Seller paid {formatEuros(paid)}</span>}
                                  </>
                                }
                              >
                                {t.contact && <p className="ticket-contact">Contact: {t.contact}</p>}
                                {!mine && !t.sold && (
                                  <div className="ticket-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={startingChat === t.id}
                                      onClick={() => startConversation({ ticketId: t.id })}
                                    >
                                      {startingChat === t.id ? "Opening…" : "Message seller"}
                                      <span className="visually-hidden">
                                        {" "}
                                        of the {formatPrice(toNumber(t.price))} ticket
                                      </span>
                                    </button>
                                    {chatErrorFor(t.id)}
                                  </div>
                                )}
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
                                      className="btn btn-text"
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
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
}
