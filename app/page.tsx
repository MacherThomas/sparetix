import Link from "next/link";

export default function LandingPage() {
  return (
    <section className="hero">
      <p className="eyebrow">Made for IE University students</p>
      <h1>Can&apos;t make the party? Sell your ticket to another IE student.</h1>
      <p className="hero-sub">
        Find and sell spare tickets in one place. No more scrolling group chats.
      </p>
      <Link href="/signup" className="btn btn-primary btn-lg">
        Sign up
      </Link>

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
          <span>Listings are visible only to people who have signed in.</span>
        </li>
      </ul>
    </section>
  );
}
