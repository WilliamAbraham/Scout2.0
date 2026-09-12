"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Heart,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Search,
  Sparkles,
} from "lucide-react";
import styles from "./scout-dashboard.module.css";

const listings = [
  {
    id: 1,
    address: "234 Wythe Avenue",
    unit: "Apartment 4B",
    neighborhood: "Williamsburg",
    price: 3450,
    beds: 1,
    match: 98,
    stage: "Tour scheduled",
    detail:
      "Sample tour: Monday, September 14 at 11:00 AM. Meet the broker at the building entrance.",
    features: "In-unit laundry · Dishwasher · Pet friendly",
  },
  {
    id: 2,
    address: "87 Clinton Street",
    unit: "Apartment 3A",
    neighborhood: "Lower East Side",
    price: 3200,
    beds: 1,
    match: 95,
    stage: "Needs you",
    detail:
      "The broker asked whether you can move in on October 1. Review the request in the Needs you queue.",
    features: "Dishwasher · Pet friendly · Natural light",
  },
  {
    id: 3,
    address: "156 Franklin Street",
    unit: "Apartment 2R",
    neighborhood: "Greenpoint",
    price: 3350,
    beds: 1,
    match: 93,
    stage: "Awaiting reply",
    detail:
      "Sample outreach was sent to the listing broker. Scout is waiting for available tour times.",
    features: "In-unit laundry · Pet friendly · Home office nook",
  },
  {
    id: 4,
    address: "42 Bergen Street",
    unit: "Apartment 5",
    neighborhood: "Boerum Hill",
    price: 3100,
    beds: 1,
    match: 91,
    stage: "New match",
    detail:
      "This sample listing fits the budget and bedroom preference. Contact verification is the next pipeline step.",
    features: "Dishwasher · Near transit · Hardwood floors",
  },
];
const filters = ["All listings", "Needs you", "Tour scheduled", "Saved"];

export function ScoutDashboard() {
  const [filter, setFilter] = useState("All listings");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<number | null>(1);
  const [resolved, setResolved] = useState(false);
  const [sortPrice, setSortPrice] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = listings.find((listing) => listing.id === expanded);
  const visible = listings
    .filter((listing) => {
      const stage =
        listing.id === 2 && resolved ? "Awaiting reply" : listing.stage;
      return (
        (filter === "All listings" ||
          (filter === "Saved"
            ? saved.includes(listing.id)
            : stage === filter)) &&
        `${listing.address} ${listing.neighborhood}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    })
    .sort((a, b) => (sortPrice ? a.price - b.price : b.match - a.match));

  return (
    <div className={styles.dashboard}>
      <a href="#main" className={styles.skip}>
        Skip to dashboard
      </a>
      <aside className={styles.sidebar}>
        <Link className={styles.logo} href="/" aria-label="Scout home">
          <Compass aria-hidden="true" />
          scout
        </Link>
        <div className={styles.workspace}>
          <span className={styles.avatar}>S</span>
          <div>
            My apartment search<small>New York City</small>
          </div>
        </div>
        <p className={styles.eyebrow}>WORKSPACE</p>
        <nav aria-label="Dashboard navigation">
          <a className={styles.activeNav} href="#main">
            <LayoutDashboard />
            Overview
          </a>
          <a href="#listings" onClick={() => setFilter("All listings")}>
            <Building2 />
            Listings<span>4</span>
          </a>
          <a href="#needs-you">
            <MessageSquare />
            Needs you<span>{resolved ? 0 : 1}</span>
          </a>
          <a href="#tours">
            <CalendarDays />
            Tours<span>1</span>
          </a>
          <a href="#listings" onClick={() => setFilter("Saved")}>
            <Heart />
            Saved<span>{saved.length}</span>
          </a>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.helper}>
            <Sparkles aria-hidden="true" />
            <strong>
              A little less searching.
              <br />A lot more living.
            </strong>
            <p>Your next chapter starts here.</p>
          </div>
          <a href="#demo-note">
            <CircleHelp />
            About this demo
          </a>
          <div className={styles.profile}>
            <span className={styles.avatar}>D</span>
            <div>
              Demo workspace<small>Personal search</small>
            </div>
          </div>
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.topbar}>
          <span>
            Workspace <span className={styles.slash}>/</span>{" "}
            <strong>Overview</strong>
          </span>
          <span className={styles.demoBadge}>Demo mode</span>
        </header>
        <main id="main" className={styles.main}>
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>YOUR SEARCH, IN MOTION</p>
              <h1>Your apartment search</h1>
              <p>
                Review matches, keep conversations moving, and plan your next
                tour.
              </p>
            </div>
            <a className={styles.secondaryButton} href="#listings">
              Explore listings <ArrowRight />
            </a>
          </div>
          <div id="demo-note" className={styles.demoNote}>
            <Sparkles aria-hidden="true" />
            <span>
              Interactive preview · All listings and activity are sample data.
              Changes reset on refresh; no messages are sent.
            </span>
          </div>
          <section className={styles.stats} aria-label="Search summary">
            {[
              {
                label: "Matched apartments",
                value: "4",
                note: "Within your search preferences",
                icon: Building2,
              },
              {
                label: "Conversations",
                value: resolved ? "2" : "1",
                note: "Awaiting a broker reply",
                icon: MessageSquare,
              },
              {
                label: "Upcoming tours",
                value: "1",
                note: "Your next step toward home",
                icon: CalendarDays,
              },
              {
                label: "Needs your input",
                value: resolved ? "0" : "1",
                note: resolved
                  ? "You’re all caught up"
                  : "A quick answer keeps things moving",
                icon: Sparkles,
              },
            ].map(({ label, value, note, icon: Icon }) => (
              <article className={styles.stat} key={label}>
                <div>
                  {label}
                  <Icon aria-hidden="true" />
                </div>
                <strong>{value}</strong>
                <small>{note}</small>
              </article>
            ))}
          </section>
          <div className={styles.columns}>
            <div className={styles.primary}>
              <section id="needs-you" className={styles.actionCard}>
                <div className={styles.sectionTitle}>
                  <h2>
                    <span className={styles.dot} />
                    Needs you{" "}
                    <span className={styles.count}>{resolved ? 0 : 1}</span>
                  </h2>
                  <span>Keep your search moving</span>
                </div>
                {resolved ? (
                  <div className={styles.resolved}>
                    <Check aria-hidden="true" />
                    <div>
                      <strong>You’re all caught up.</strong>
                      <p>Your sample response is recorded for this session.</p>
                    </div>
                    <button
                      className={styles.textButton}
                      onClick={() => {
                        setResolved(false);
                        setNotice("Sample request restored.");
                      }}
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <div className={styles.request}>
                    <span className={styles.requestIcon}>
                      <MessageSquare aria-hidden="true" />
                    </span>
                    <div>
                      <strong>Does an October 1 move-in work for you?</strong>
                      <p>
                        87 Clinton Street · The broker needs to confirm your
                        move-in date.
                      </p>
                      <small>Sample broker request · 20 min ago</small>
                    </div>
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        setResolved(true);
                        setNotice(
                          "Demo response recorded: October 1 works. No message was sent.",
                        );
                      }}
                    >
                      Confirm date <ArrowRight />
                    </button>
                  </div>
                )}
              </section>
              <section id="listings" className={styles.listingSection}>
                <div className={styles.sectionTitle}>
                  <div>
                    <h2>Your shortlist</h2>
                    <p>Good places. Better possibilities.</p>
                  </div>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setSortPrice(!sortPrice)}
                  >
                    <ArrowDownUp />
                    {sortPrice ? "Lowest price" : "Best match"}
                  </button>
                </div>
                <div className={styles.listingControls}>
                  <div className={styles.filters} aria-label="Filter listings">
                    {filters.map((item) => (
                      <button
                        key={item}
                        aria-pressed={filter === item}
                        onClick={() => setFilter(item)}
                        className={filter === item ? styles.selectedFilter : ""}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <label className={styles.search}>
                    <Search aria-hidden="true" />
                    <input
                      aria-label="Search by address or neighborhood"
                      placeholder="Search listings…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                </div>
                <div className={styles.results} aria-live="polite">
                  {visible.length}{" "}
                  {visible.length === 1 ? "apartment" : "apartments"} · Sample
                  search: 1 bed, up to $3,500 / mo
                </div>
                <div className={styles.listings}>
                  {visible.map((listing) => (
                    <article
                      key={listing.id}
                      className={`${styles.listing} ${expanded === listing.id ? styles.selectedListing : ""}`}
                    >
                      <div className={styles.listingRow}>
                        <div className={styles.buildingArt} aria-hidden="true">
                          <Building2 />
                          <span>{listing.neighborhood}</span>
                        </div>
                        <div className={styles.listingInfo}>
                          <div className={styles.match}>
                            <Sparkles aria-hidden="true" />
                            {listing.match}% match
                          </div>
                          <h3>{listing.address}</h3>
                          <p>
                            <MapPin aria-hidden="true" />
                            {listing.neighborhood} · {listing.unit}
                          </p>
                          <small>{listing.beds} bed · 1 bath</small>
                        </div>
                        <div className={styles.listingPrice}>
                          <button
                            className={styles.save}
                            aria-label={`${saved.includes(listing.id) ? "Unsave" : "Save"} ${listing.address}`}
                            aria-pressed={saved.includes(listing.id)}
                            onClick={() =>
                              setSaved(
                                saved.includes(listing.id)
                                  ? saved.filter((id) => id !== listing.id)
                                  : [...saved, listing.id],
                              )
                            }
                          >
                            <Heart
                              fill={
                                saved.includes(listing.id)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                          </button>
                          <strong>
                            ${listing.price.toLocaleString("en-US")}
                            <small> / mo</small>
                          </strong>
                          <span
                            className={`${styles.stage} ${listing.id === 2 && !resolved ? styles.waitStage : listing.stage === "Tour scheduled" ? styles.goStage : ""}`}
                          >
                            {listing.id === 2 && resolved
                              ? "Awaiting reply"
                              : listing.stage}
                          </span>
                        </div>
                      </div>
                      <div className={styles.listingFooter}>
                        <span>{listing.features}</span>
                        <button
                          aria-expanded={expanded === listing.id}
                          aria-controls={`detail-${listing.id}`}
                          onClick={() =>
                            setExpanded(
                              expanded === listing.id ? null : listing.id,
                            )
                          }
                        >
                          View details <ChevronDown />
                        </button>
                      </div>
                      {expanded === listing.id && (
                        <p
                          id={`detail-${listing.id}`}
                          className={styles.detail}
                        >
                          {listing.id === 2 && resolved
                            ? "Your sample move-in confirmation is recorded. The next step would be a broker reply; no message was sent."
                            : listing.detail}
                        </p>
                      )}
                    </article>
                  ))}
                  {visible.length === 0 && (
                    <div className={styles.empty}>
                      <Search aria-hidden="true" />
                      <h3>No apartments here yet</h3>
                      <p>
                        Try another search or save a listing to see it here.
                      </p>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setQuery("");
                          setFilter("All listings");
                        }}
                      >
                        Show all listings
                      </button>
                    </div>
                  )}
                </div>
              </section>
            </div>
            <aside className={styles.rightRail} aria-label="Search activity">
              {selected && (
                <section
                  className={styles.inspector}
                  aria-label="Selected apartment"
                >
                  <p className={styles.eyebrow}>LISTING BRIEF</p>
                  <h2>{selected.address}</h2>
                  <p>
                    {selected.neighborhood} · {selected.unit}
                  </p>
                  <span className={styles.match}>
                    <Sparkles aria-hidden="true" />
                    {selected.match}% sample match
                  </span>
                  <dl>
                    <div>
                      <dt>Monthly rent</dt>
                      <dd>${selected.price.toLocaleString("en-US")}</dd>
                    </div>
                    <div>
                      <dt>Layout</dt>
                      <dd>{selected.beds} bed · 1 bath</dd>
                    </div>
                    <div>
                      <dt>Stage</dt>
                      <dd>
                        {selected.id === 2 && resolved
                          ? "Awaiting reply"
                          : selected.stage}
                      </dd>
                    </div>
                  </dl>
                  <h3>Next step</h3>
                  <p>
                    {selected.id === 2 && resolved
                      ? "Sample confirmation recorded. Waiting for a broker reply; no message was sent."
                      : selected.detail}
                  </p>
                </section>
              )}
              <section className={styles.searchCard}>
                <span className={styles.sparkleBox}>
                  <Compass aria-hidden="true" />
                </span>
                <h2>A search that feels like you.</h2>
                <p>Your sample preferences guide every match.</p>
                <dl>
                  <div>
                    <dt>Location</dt>
                    <dd>Brooklyn & Manhattan</dd>
                  </div>
                  <div>
                    <dt>Monthly budget</dt>
                    <dd>Up to $3,500</dd>
                  </div>
                  <div>
                    <dt>Bedrooms</dt>
                    <dd>1 bedroom</dd>
                  </div>
                  <div>
                    <dt>Move-in</dt>
                    <dd>October 2026</dd>
                  </div>
                </dl>
                <span className={styles.preferenceNote}>
                  Sample preferences · Read only
                </span>
              </section>
              <section id="tours" className={styles.railCard}>
                <div className={styles.sectionTitle}>
                  <h2>Next on your calendar</h2>
                  <CalendarDays aria-hidden="true" />
                </div>
                <div className={styles.tour}>
                  <div className={styles.date}>
                    <small>SEP</small>
                    <strong>14</strong>
                  </div>
                  <div>
                    <strong>234 Wythe Avenue</strong>
                    <p>Monday · 11:00–11:30 AM</p>
                    <span className={styles.match}>Sample confirmed tour</span>
                  </div>
                </div>
                <p className={styles.railNote}>
                  In person · Williamsburg, Brooklyn
                </p>
              </section>
              <section className={styles.railCard}>
                <div className={styles.sectionTitle}>
                  <h2>Behind the scenes</h2>
                  <span className={styles.sampleLabel}>Sample</span>
                </div>
                <ol className={styles.timeline}>
                  <li>
                    <strong>A tour is on the calendar</strong>
                    <p>234 Wythe Avenue</p>
                    <small>12 min ago</small>
                  </li>
                  <li>
                    <strong>A broker needs your input</strong>
                    <p>87 Clinton Street</p>
                    <small>20 min ago</small>
                  </li>
                  <li>
                    <strong>Outreach started</strong>
                    <p>156 Franklin Street</p>
                    <small>45 min ago</small>
                  </li>
                  <li>
                    <strong>A new place made the shortlist</strong>
                    <p>42 Bergen Street</p>
                    <small>1 hour ago</small>
                  </li>
                </ol>
              </section>
            </aside>
          </div>
          <p role="status" className={styles.notice}>
            {notice}
          </p>
          <footer className={styles.footer}>
            <Compass aria-hidden="true" /> Made for your next chapter.
            <span>Scout · Dashboard preview</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
