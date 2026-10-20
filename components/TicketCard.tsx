import type { ReactNode } from "react";

type TicketCardProps = {
  title: string;
  price: string;
  priceLabel?: string;
  meta?: ReactNode;
  sold?: boolean;
  isNew?: boolean;
  justSold?: boolean;
  children?: ReactNode;
  as?: "li" | "div";
  // null renders the title as plain text (the event heading already names it).
  headingLevel?: 2 | 3 | null;
  testId?: string;
};

// Presentational raffle-ticket card, shared by the landing example and the /app list.
export default function TicketCard({
  title,
  price,
  priceLabel,
  meta,
  sold = false,
  isNew = false,
  justSold = false,
  children,
  as: Tag = "li",
  headingLevel = 2,
  testId,
}: TicketCardProps) {
  const classes = ["ticket", sold && "ticket-sold", isNew && "ticket-new"].filter(Boolean).join(" ");
  const Heading = headingLevel === null ? "p" : headingLevel === 3 ? "h3" : "h2";

  return (
    <Tag className={classes} data-testid={testId}>
      <div className="ticket-main">
        <Heading className="ticket-title">{title}</Heading>
        {meta && <div className="ticket-meta">{meta}</div>}
        {children}
      </div>
      <div className="ticket-stub">
        <span className={priceLabel ? "stub-label" : "visually-hidden"}>{priceLabel ?? "Price: "}</span>
        <span className="ticket-price">{price}</span>
      </div>
      {sold && <span className={`sold-stamp ${justSold ? "sold-stamp-animate" : ""}`}>SOLD</span>}
    </Tag>
  );
}
