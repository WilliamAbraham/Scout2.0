import type { InboxListing } from "./inbox-model";
import type { SearchProfile } from "@/lib/search-profile";
import { formatRent, rentComparison, tourQuestions } from "./listing-insights";
import styles from "./listing-snapshot.module.css";

export function ListingSnapshot({ item, profile, demo }: {
  item: InboxListing;
  profile: SearchProfile | null;
  demo: boolean;
}) {
  const comparison = rentComparison(item.rent, profile);
  const validRent = Number.isFinite(item.rent) && item.rent > 0;
  return (
    <>
      <section className={styles.snapshot} aria-label="Apartment snapshot">
        <h3>Apartment snapshot</h3>
        <dl className={styles.facts}>
          <div><dt>Bedrooms</dt><dd>{item.beds === null ? "Not provided" : item.beds === 0 ? "Studio" : item.beds}</dd></div>
          <div><dt>Bathrooms</dt><dd>{item.baths ?? "Not provided"}</dd></div>
          <div><dt>Neighborhood</dt><dd>{item.area ?? "Not provided"}</dd></div>
          <div><dt>Listed by</dt><dd>{item.brokerage ?? "Not provided"}</dd></div>
        </dl>
      </section>
      <section className={styles.snapshot} aria-label="Rent breakdown">
        <h3>Rent breakdown</h3>
        {comparison && <div className={`${styles.comparison} ${comparison.outside ? styles.outside : ""}`}>
          <strong>{comparison.label}</strong>
          <p>{comparison.detail}{demo ? " Sample budget." : ""}</p>
        </div>}
        <dl className={styles.costs}>
          <div><dt>Listed monthly rent</dt><dd>{validRent ? formatRent(item.rent) : "Not provided"}</dd></div>
          <div><dt>12 months of listed rent</dt><dd>{validRent ? formatRent(Math.round(item.rent * 1200) / 100) : "Not provided"}</dd></div>
          <div><dt>Fees & utilities</dt><dd>Not confirmed</dd></div>
        </dl>
        <p className={styles.note}>Rent-only calculation. Lease length, concessions, deposits, and additional costs still need confirmation.</p>
      </section>
    </>
  );
}

export function ListingQuestions({ item, profile }: {
  item: InboxListing;
  profile: SearchProfile | null;
}) {
  return <section className={styles.snapshot}>
    <details className={styles.questions}>
      <summary>Before you tour</summary>
      <p>Questions to confirm with the listing agent.</p>
      <ul>{tourQuestions(item, profile).map((question) => <li key={question}>{question}</li>)}</ul>
    </details>
  </section>;
}
