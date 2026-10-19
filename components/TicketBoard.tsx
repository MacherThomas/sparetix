"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = "Events" | "Transport";

type Ticket = {
  id: string;
  user_id: string;
  title: string;
  category: Category;
  price: number | null;
  event_date: string | null;
  contact: string | null;
  sold: boolean;
  created_at: string;
};

type Tab = "All" | Category;
type Sort = "soonest" | "cheapest";

const priceFormat = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

function formatPrice(price: number | null) {
  return price === null ? "Ask seller" : priceFormat.format(price);
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

// Nulls always go last; ties fall back to newest first.
function compareNullable<T extends number | string>(a: T | null, b: T | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export default function TicketBoard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Events");
  const [price, setPrice] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("soonest");

  useEffect(() => {
    supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setTickets((data ?? []) as Ticket[]);
        setLoading(false);
      });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setSaving(true);
    setError(null);

    const parsedPrice = price.trim() === "" ? null : Number(price);
    const { data, error } = await supabase
      .from("tickets")
      .insert({
        user_id: userId,
        title: cleanTitle,
        category,
        price: parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null,
        event_date: eventDate || null,
        contact: contact.trim() || null,
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setTickets((prev) => [data as Ticket, ...prev]);
    setTitle("");
    setCategory("Events");
    setPrice("");
    setEventDate("");
    setContact("");
  }

  async function toggleSold(ticket: Ticket) {
    const { data, error } = await supabase
      .from("tickets")
      .update({ sold: !ticket.sold })
      .eq("id", ticket.id)
      .select()
      .single();
    if (error) return setError(error.message);
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? (data as Ticket) : t)));
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`Delete "${ticket.title}"?`)) return;
    const { error } = await supabase.from("tickets").delete().eq("id", ticket.id);
    if (error) return setError(error.message);
    setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets
      .filter((t) => tab === "All" || t.category === tab)
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.sold !== b.sold) return a.sold ? 1 : -1;
        const primary =
          sort === "cheapest"
            ? compareNullable(a.price === null ? null : Number(a.price), b.price === null ? null : Number(b.price))
            : compareNullable(a.event_date, b.event_date);
        return primary || b.created_at.localeCompare(a.created_at);
      });
  }, [tickets, tab, search, sort]);

  return (
    <div className="board">
      <p className="safety-note" role="note">
        Only sell tickets that can be passed on. Check who you&apos;re buying from, meet in person if
        you can, and check the ticket before paying.
      </p>

      <form onSubmit={handleSubmit} className="card ticket-form">
        <h2>Sell a ticket</h2>
        <label className="field">
          <span>Title *</span>
          <input
            type="text"
            required
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Thursday party at Kapital, 1 ticket"
            data-testid="core-input"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              <option value="Events">Events</option>
              <option value="Transport">Transport</option>
            </select>
          </label>
          <label className="field">
            <span>Price (€)</span>
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
            <span>Date</span>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </label>
          <label className="field">
            <span>How to reach you</span>
            <input
              type="text"
              maxLength={140}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="e.g. Instagram @yourname"
            />
          </label>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving} data-testid="core-submit">
          {saving ? "Posting…" : "Post ticket"}
        </button>
      </form>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <section aria-label="Tickets for sale">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter by category">
            {(["All", "Events", "Transport"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? "tab-active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="toolbar-row">
            <input
              type="search"
              className="search"
              placeholder="Search by title"
              aria-label="Search tickets by title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select aria-label="Sort tickets" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="soonest">Soonest first</option>
              <option value="cheapest">Cheapest first</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="muted center">Loading tickets…</p>
        ) : visible.length === 0 ? (
          <p className="muted center empty">
            {tickets.length === 0 ? "No tickets yet. Be the first to post one!" : "No tickets match your filters."}
          </p>
        ) : (
          <ul className="ticket-list">
            {visible.map((t) => {
              const mine = t.user_id === userId;
              return (
                <li key={t.id} className={`card ticket ${t.sold ? "ticket-sold" : ""}`} data-testid="core-item">
                  <div className="ticket-main">
                    <div className="ticket-head">
                      <h3 className="ticket-title">{t.title}</h3>
                      <span className="ticket-price">{formatPrice(t.price === null ? null : Number(t.price))}</span>
                    </div>
                    <div className="ticket-meta">
                      <span className="badge">{t.category}</span>
                      {t.sold && <span className="badge badge-sold">Sold</span>}
                      {mine && <span className="badge badge-mine">Your ticket</span>}
                      <span>{formatDate(t.event_date)}</span>
                    </div>
                    {t.contact && (
                      <p className="ticket-contact">
                        <span className="muted">Contact:</span> {t.contact}
                      </p>
                    )}
                  </div>
                  {mine && (
                    <div className="ticket-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleSold(t)}>
                        {t.sold ? "Mark as available" : "Mark as sold"}
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteTicket(t)}>
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
