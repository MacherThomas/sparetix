// Shared types, formatting and grouping rules for events, tickets and requests.

export type Category = "Events" | "Transport";

export type EventRow = {
  id: string;
  name: string;
  event_date: string | null;
  category: Category;
  created_by: string | null;
  created_at: string;
};

export type Ticket = {
  id: string;
  user_id: string;
  event_id: string;
  price: number | null;
  paid_price: number | null;
  contact: string | null;
  sold: boolean;
  created_at: string;
};

export type RequestRow = {
  id: string;
  user_id: string;
  event_id: string;
  contact: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  event_id: string;
  ticket_id: string | null;
  request_id: string | null;
  seller_id: string;
  buyer_id: string;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

const priceFormat = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const wholePriceFormat = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

// "€15" for whole euros, "€12.50" otherwise, so prices fit the ticket stub.
export function formatEuros(amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? wholePriceFormat.format(rounded) : priceFormat.format(rounded);
}

export function formatPrice(price: number | null) {
  return price === null ? "Ask seller" : formatEuros(price);
}

export function formatDate(date: string | null) {
  if (!date) return "Date not set";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "Tue 20 Oct, 18:05" for message times and "looking since" dates, in Madrid time.
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Today as YYYY-MM-DD in Madrid, the same day boundary the database functions use.
export function todayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// The Sunday that ends the (Monday to Sunday) week containing `today`, as YYYY-MM-DD.
export function endOfWeek(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const daysToSunday = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysToSunday);
  return date.toISOString().slice(0, 10);
}

export type TimeSection = "Today" | "This week" | "Later" | "Date not set";
export const TIME_SECTIONS: TimeSection[] = ["Today", "This week", "Later", "Date not set"];

export function timeSection(eventDate: string | null, today: string, weekEnd: string): TimeSection {
  if (eventDate === null) return "Date not set";
  if (eventDate === today) return "Today";
  if (eventDate <= weekEnd) return "This week";
  return "Later";
}

export function toNumber(value: number | string | null) {
  return value === null ? null : Number(value);
}

export function parseAmount(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Add fetched rows to what is already in state (something may be posted before the first load ends).
export function mergeById<T extends { id: string }>(fetched: T[], current: T[]) {
  const ids = new Set(fetched.map((row) => row.id));
  return [...fetched, ...current.filter((row) => !ids.has(row.id))];
}

// Unsold tickets and their prices. "From" needs one priced ticket, "average" needs two.
function priceStats(tickets: Ticket[]) {
  const unsold = tickets.filter((t) => !t.sold);
  const prices = unsold.map((t) => toNumber(t.price)).filter((p): p is number => p !== null);
  const from = prices.length >= 1 ? `, from ${formatEuros(Math.min(...prices))}` : "";
  const average =
    prices.length >= 2 ? `, average ${formatEuros(prices.reduce((sum, p) => sum + p, 0) / prices.length)}` : "";
  return { count: unsold.length, priceText: from + average };
}

// Event summary: "3 tickets for sale, from €12, average €14.50".
export function summarizeTickets(tickets: Ticket[]) {
  const { count, priceText } = priceStats(tickets);
  return `${count} ${count === 1 ? "ticket" : "tickets"} for sale${priceText}`;
}

// Hint under the sell form: "Other tickets for this event: 3 for sale, from €12, average €14.50".
export function priceHint(tickets: Ticket[]) {
  const { count, priceText } = priceStats(tickets);
  return `Other tickets for this event: ${count} for sale${priceText}`;
}

export function peopleLooking(count: number) {
  return `${count} ${count === 1 ? "person" : "people"} looking`;
}

// Unsold first, then cheapest first (no price last), then newest.
export function compareTickets(a: Ticket, b: Ticket) {
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
export function compareEvents(a: EventRow, b: EventRow) {
  if (a.event_date !== b.event_date) {
    if (a.event_date === null) return 1;
    if (b.event_date === null) return -1;
    return a.event_date.localeCompare(b.event_date);
  }
  return b.created_at.localeCompare(a.created_at);
}

// The upcoming event a typed name refers to: the picked suggestion if the text still
// matches it, otherwise the first upcoming event with that name (case-insensitive).
export function matchEvent(upcoming: EventRow[], typed: string, pickedId: string | null) {
  const name = typed.trim().toLowerCase();
  if (!name) return null;
  const picked = upcoming.find((e) => e.id === pickedId);
  if (picked && picked.name.toLowerCase() === name) return picked;
  return upcoming.find((e) => e.name.trim().toLowerCase() === name) ?? null;
}
