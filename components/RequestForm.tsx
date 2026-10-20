"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import EventNameField from "./EventNameField";
import { formatDate, matchEvent, type Category, type EventRow, type RequestRow } from "@/lib/listings";

type RequestFormProps = {
  upcomingEvents: EventRow[];
  today: string;
  onAdded: (event: EventRow, request: RequestRow) => void;
};

// "Looking for a ticket instead?" form. Deliberately has no core-* test ids.
export default function RequestForm({ upcomingEvents, today, onAdded }: RequestFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [contact, setContact] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [category, setCategory] = useState<Category>("Events");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // The submit button is disabled while saving, which drops focus; put it back afterwards.
  const submitRef = useRef<HTMLButtonElement>(null);

  const matched = matchEvent(upcomingEvents, name, pickedId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    setStatus("");

    const isNewEvent = matched === null;
    const { data, error } = await supabase.rpc("post_request", {
      p_event_name: trimmed,
      p_event_id: matched?.id ?? null,
      p_event_date: isNewEvent && eventDate ? eventDate : null,
      p_category: isNewEvent ? category : "Events",
      p_contact: contact.trim() || null,
    });

    setSaving(false);
    if (error) {
      setError(error.message);
      requestAnimationFrame(() => submitRef.current?.focus());
      return;
    }
    const { event, request, created } = data as { event: EventRow; request: RequestRow; created: boolean };
    onAdded(event, request);
    setStatus(
      created
        ? `Added: you're looking for a ticket for ${event.name}.`
        : `You're already looking for a ticket for ${event.name}.`
    );
    setName("");
    setPickedId(null);
    setContact("");
    setEventDate("");
    setCategory("Events");
    requestAnimationFrame(() => document.getElementById("request-event-name")?.focus());
  }

  return (
    <form onSubmit={handleSubmit} className="request-form" aria-labelledby="request-heading">
      <h2 id="request-heading" className="request-heading">
        Looking for a ticket
      </h2>
      <label htmlFor="request-event-name" className="label">
        Which event?
      </label>
      <EventNameField
        id="request-event-name"
        value={name}
        onChange={(v) => {
          setName(v);
          setPickedId(null);
        }}
        onPick={(event) => {
          setName(event.name);
          setPickedId(event.id);
        }}
        upcomingEvents={upcomingEvents}
        placeholder="e.g. Thursday party at Kapital"
      />
      <p className="match-note" role="status">
        {matched ? `Adding to ${matched.name}, ${formatDate(matched.event_date)}.` : ""}
      </p>
      <div className="form-grid">
        <label className="field field-wide">
          <span className="label">How to reach you (optional)</span>
          <input
            type="text"
            maxLength={140}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="e.g. Instagram @yourname"
          />
        </label>
        {!matched && (
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
      <div>
        <button type="submit" className="btn btn-secondary" disabled={saving} ref={submitRef}>
          {saving ? "Adding…" : "Add request"}
        </button>
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <p className="match-note" role="status">
        {status}
      </p>
    </form>
  );
}
