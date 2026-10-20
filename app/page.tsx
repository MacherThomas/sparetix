import Link from "next/link";
import TicketCard from "@/components/TicketCard";

export default function LandingPage() {
  return (
    <section className="hero">
      <p className="eyebrow">Made for IE University students</p>
      <h1 className="hero-title">Can&apos;t make the party? Sell your ticket to another IE student.</h1>
      <p className="hero-sub">Find and sell spare tickets in one place. No more scrolling group chats.</p>
      <Link href="/signup" className="btn btn-primary btn-lg">
        Sign up
      </Link>

      <figure className="example">
        <figcaption className="visually-hidden">Example listing</figcaption>
        <TicketCard as="div" title="Thursday party at Kapital" priceLabel="from" price="€12" meta="4 tickets, from €12" />
      </figure>

      <ul className="features">
        <li>
          <strong>Post in seconds</strong>
          <span>Add a title, a price if you want, and how to reach you.</span>
        </li>
        <li>
          <strong>Parties, events and transport</strong>
          <span>Club nights, concerts, trips and bus seats from fellow students.</span>
        </li>
        <li>
          <strong>Only for logged-in students</strong>
          <span>Listings are only visible to signed-in users.</span>
        </li>
      </ul>
    </section>
  );
}
