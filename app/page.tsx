import Link from "next/link";
import TicketCard from "@/components/TicketCard";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">Made for IE University students</p>
          <h1 className="hero-title">Can&apos;t make the party? Sell your ticket to another IE student.</h1>
          <p className="hero-sub">
            Find and sell spare tickets in one place. Looking for one tonight? It&apos;s all here, no more
            scrolling group chats.
          </p>
          {user ? (
            <Link href="/app" className="btn btn-primary btn-lg">
              Go to tickets
            </Link>
          ) : (
            <Link href="/signup" className="btn btn-primary btn-lg">
              Sign up
            </Link>
          )}
        </div>

        <figure className="example">
          <figcaption className="visually-hidden">Example listing</figcaption>
          <TicketCard
            as="div"
            title="Thursday party at Kapital"
            priceLabel="from"
            price="€12"
            meta={
              <>
                <span>Thu 23 Oct</span>
                <span>4 tickets</span>
              </>
            }
          />
        </figure>
      </section>

      <ul className="features">
        <li>
          <strong>Post in seconds</strong>
          <span>Pick the event, add a price if you want, and how to reach you.</span>
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
    </div>
  );
}
