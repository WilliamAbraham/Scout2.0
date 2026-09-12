"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Home,
  ImageIcon,
  Inbox,
  MapPin,
  Pause,
  Play,
  Search,
  Settings2,
  X,
} from "lucide-react";
import styles from "./scout-dashboard.module.css";
const apartments = [
  {
    id: 1,
    address: "234 Wythe Avenue",
    unit: "4B",
    area: "Williamsburg",
    rent: 3450,
    stage: "Tour booked",
    next: "Mon, Sep 14 · 11:00 AM",
    fit: "Within budget · In-unit laundry · Pet friendly",
    caveat: "Move-in date has not been confirmed.",
    activity:
      "The broker confirmed a tour for September 14, 11:00–11:30 AM. Meet at the building entrance.",
  },
  {
    id: 2,
    address: "87 Clinton Street",
    unit: "3A",
    area: "Lower East Side",
    rent: 3200,
    stage: "In conversation",
    next: "Broker needs your move-in date",
    fit: "Within budget · Dishwasher · Pet friendly",
    caveat: "In-unit laundry is not listed.",
    activity: "The broker asked: Does an October 1 move-in work for you?",
  },
  {
    id: 3,
    address: "156 Franklin Street",
    unit: "2R",
    area: "Greenpoint",
    rent: 3350,
    stage: "Awaiting reply",
    next: "Waiting for available tour times",
    fit: "Within budget · In-unit laundry · Pet friendly",
    caveat: "Tour availability has not been confirmed.",
    activity: "A sample tour request was sent. The broker has not replied yet.",
  },
  {
    id: 4,
    address: "42 Bergen Street",
    unit: "5",
    area: "Boerum Hill",
    rent: 3100,
    stage: "Finding contact",
    next: "No broker contact found",
    fit: "Within budget · Dishwasher · Near transit",
    caveat: "Pet policy and move-in date are unknown.",
    activity:
      "Scout could not verify a broker contact. Add an email address or stop pursuing this apartment.",
  },
  {
    id: 5,
    address: "118 Court Street",
    unit: "3",
    area: "Cobble Hill",
    rent: 3400,
    stage: "New match",
    next: "Checking listing details",
    fit: "Within budget · Dishwasher · Near transit",
    caveat: "Pet policy has not been confirmed.",
    activity:
      "Found in a sample listing alert. Scout is checking the listing before contacting a broker.",
  },
];

const groups = [
  "Needs you",
  "Tours scheduled",
  "Waiting for broker",
  "Found",
  "Closed",
];
const filters = ["All", "Needs you", "Found", "Contacted"];
const mapUrl =
  "https://www.openstreetmap.org/export/embed.html?bbox=-74.025%2C40.673%2C-73.935%2C40.741&layer=mapnik";

export function ScoutDashboard() {
  const [selectedId, setSelectedId] = useState<number | null>(2);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(["Closed"]);
  const [centerView, setCenterView] = useState("Map");
  const [briefView, setBriefView] = useState("Overview");
  const [mobileView, setMobileView] = useState("Inbox");
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState<number[]>([]);
  const [response, setResponse] = useState("");
  const [date, setDate] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [contact, setContact] = useState("");
  const [savedContact, setSavedContact] = useState("");
  const [mapVersion, setMapVersion] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const preferences = useRef<HTMLDialogElement>(null);
  const selected = apartments.find((apartment) => apartment.id === selectedId);

  function groupOf(id: number) {
    if (stopped.includes(id)) return "Closed";
    if ((id === 2 && !response) || (id === 4 && !savedContact))
      return "Needs you";
    if (id === 1) return "Tours scheduled";
    if (id === 2 || id === 3) return "Waiting for broker";
    return "Found";
  }
  function nextStep(apartment: (typeof apartments)[number]) {
    if (stopped.includes(apartment.id)) return "Pursuit stopped";
    if (apartment.id === 2 && response)
      return "Move-in date recorded · Waiting for broker";
    if (apartment.id === 4 && savedContact)
      return "Contact supplied · Ready for verification";
    return apartment.next;
  }
  function choose(id: number) {
    setSelectedId(id);
    setMobileView("Details");
    setSuggesting(false);
  }
  function answer(value: string) {
    setResponse(value);
    setSuggesting(false);
    setNotice("Demo response recorded. No message was sent.");
  }
  const visible = apartments.filter((apartment) => {
    const group = groupOf(apartment.id);
    return (
      `${apartment.address} ${apartment.area}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "All" ||
        group === filter ||
        (filter === "Contacted" &&
          ["Waiting for broker", "Tours scheduled"].includes(group)))
    );
  });
  const milestones = selected
    ? [
        {
          title: "Found in a listing alert",
          detail: "StreetEasy · Sample source",
          done: true,
        },
        {
          title: "Checked against your search",
          detail: selected.fit,
          done: true,
        },
        {
          title:
            selected.id === 4 && !savedContact
              ? "Broker contact not found"
              : selected.id === 4
                ? "Contact supplied"
                : selected.id === 5
                  ? "Checking broker details"
                  : "Broker contact verified",
          detail:
            selected.id === 4
              ? savedContact
                ? "Verification is the next step"
                : "Your help is needed to continue"
              : selected.id === 5
                ? "No outreach sent yet"
                : "Sample brokerage contact",
          done: ![4, 5].includes(selected.id),
        },
        ...([1, 2, 3].includes(selected.id)
          ? [
              {
                title: "Tour request sent",
                detail: "Sample outreach recorded",
                done: true,
              },
            ]
          : []),
        ...(selected.id === 1
          ? [
              {
                title: "Tour confirmed",
                detail: "Mon, Sep 14 · 11:00–11:30 AM",
                done: true,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className={styles.app}>
      <a href="#listing-rail" className={styles.skip}>
        Skip to listings
      </a>
      <div className={styles.window}>
        <nav className={styles.mobileNav} aria-label="Workspace panes">
          {["Inbox", "Map", "Details"].map((view) => (
            <button
              key={view}
              aria-pressed={mobileView === view}
              onClick={() => {
                setMobileView(view);
                if (view === "Map") setCenterView("Map");
              }}
            >
              {view}
            </button>
          ))}
        </nav>
        <aside
          id="listing-rail"
          className={`${styles.rail} ${mobileView !== "Inbox" ? styles.mobileHidden : ""}`}
          aria-label="Apartment inbox"
        >
          <header className={styles.railHeader}>
            <div className={styles.brand}>
              <Home aria-hidden="true" />
              <h1>Scout</h1>
              <span>{apartments.length} tracked</span>
            </div>
            <label className={styles.search}>
              <Search aria-hidden="true" />
              <input
                aria-label="Search apartments"
                placeholder="Search apartments…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </header>
          <div className={styles.filters} aria-label="Filter apartments">
            {filters.map((name) => (
              <button
                key={name}
                aria-pressed={filter === name}
                onClick={() => setFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className={styles.railList}>
            {groups.map((group) => {
              const items = visible.filter(
                (apartment) => groupOf(apartment.id) === group,
              );
              if (!items.length) return null;
              return (
                <section key={group}>
                  <button
                    className={styles.groupHeader}
                    aria-expanded={!collapsed.includes(group)}
                    onClick={() =>
                      setCollapsed(
                        collapsed.includes(group)
                          ? collapsed.filter((item) => item !== group)
                          : [...collapsed, group],
                      )
                    }
                  >
                    {collapsed.includes(group) ? (
                      <ChevronRight aria-hidden="true" />
                    ) : (
                      <ChevronDown aria-hidden="true" />
                    )}
                    {group}
                    <span>{items.length}</span>
                  </button>
                  {!collapsed.includes(group) &&
                    items.map((apartment) => (
                      <button
                        key={apartment.id}
                        className={`${styles.listingRow} ${selectedId === apartment.id ? styles.selectedRow : ""}`}
                        aria-pressed={selectedId === apartment.id}
                        onClick={() => choose(apartment.id)}
                      >
                        <span className={styles.rowTop}>
                          <Building2 aria-hidden="true" />
                          <strong>{apartment.address}</strong>
                          <span>${apartment.rent.toLocaleString("en-US")}</span>
                        </span>
                        <span className={styles.rowMeta}>
                          {apartment.area} · 1 bed
                        </span>
                        <span
                          className={`${styles.rowUpdate} ${group === "Needs you" ? styles.waitText : ""}`}
                        >
                          {nextStep(apartment)}
                        </span>
                      </button>
                    ))}
                </section>
              );
            })}
            {visible.length === 0 && (
              <div className={styles.empty}>
                <Search aria-hidden="true" />
                <p>No apartments match this view.</p>
                <button
                  className={styles.button}
                  onClick={() => {
                    setQuery("");
                    setFilter("All");
                  }}
                >
                  Show all apartments
                </button>
              </div>
            )}
          </div>
          <footer className={styles.railFooter}>
            <div>
              <span className={paused ? styles.grayDot : styles.greenDot} />
              {paused ? "Demo paused" : "Monitoring · Demo"}
              <button
                className={styles.iconButton}
                aria-label={paused ? "Resume demo" : "Pause demo"}
                onClick={() => {
                  setPaused(!paused);
                  setNotice(
                    paused
                      ? "Demo resumed."
                      : "Demo paused. No live worker is connected.",
                  );
                }}
              >
                {paused ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
              </button>
              <button
                className={styles.iconButton}
                aria-label="Search preferences"
                onClick={() => preferences.current?.showModal()}
              >
                <Settings2 aria-hidden="true" />
              </button>
            </div>
            <p>Sample data · No messages sent</p>
          </footer>
        </aside>

        <main
          className={`${styles.center} ${mobileView !== "Map" ? styles.mobileHidden : ""}`}
        >
          <header className={styles.paneHeader}>
            <Building2 aria-hidden="true" />
            <span className={styles.paneTitle}>
              {selected ? selected.address : "Your search"}
            </span>
            <div className={styles.tabs}>
              {["Map", "Photos", "Activity"].map((view) => (
                <button
                  key={view}
                  aria-pressed={centerView === view}
                  onClick={() => setCenterView(view)}
                >
                  {view}
                </button>
              ))}
            </div>
            {centerView === "Map" && (
              <button
                className={styles.iconButton}
                aria-label="Recenter map"
                onClick={() => setMapVersion(mapVersion + 1)}
              >
                <Crosshair aria-hidden="true" />
              </button>
            )}
          </header>
          <div className={styles.centerContent}>
            {centerView === "Map" ? (
              <div className={styles.map}>
                <iframe
                  key={mapVersion}
                  src={mapUrl}
                  title="OpenStreetMap overview of Brooklyn and Lower Manhattan"
                  referrerPolicy="no-referrer"
                />
                <div className={styles.mapNote}>
                  <MapPin aria-hidden="true" />
                  <span>
                    Search area overview
                    <small>
                      Brooklyn & Lower Manhattan · Demo listings are not pinned
                    </small>
                  </span>
                </div>
              </div>
            ) : centerView === "Photos" ? (
              <div className={styles.empty}>
                <ImageIcon aria-hidden="true" />
                <h2>No listing photos yet</h2>
                <p>
                  {selected
                    ? `${selected.address} is a sample apartment.`
                    : "Select an apartment from the inbox."}
                  <br />
                  Photos will appear here when a listing provides them.
                </p>
              </div>
            ) : (
              <div className={styles.activity}>
                <p className={styles.eyebrow}>PURSUIT ACTIVITY · SAMPLE</p>
                <h2>{selected?.address ?? "Select an apartment"}</h2>
                <p className={styles.muted}>
                  A record of the work behind this apartment.
                </p>
                <ol className={styles.timeline}>
                  {milestones.map((step) => (
                    <li key={step.title}>
                      <span
                        className={
                          step.done ? styles.stepDone : styles.stepPending
                        }
                      >
                        {step.done ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Search aria-hidden="true" />
                        )}
                      </span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                {selected && (
                  <p className={styles.activityNext}>
                    Next: {nextStep(selected)}
                  </p>
                )}
              </div>
            )}
          </div>
          <footer className={styles.centerFooter}>
            <span>1 bedroom · Up to $3,500 · October move-in</span>
            <span>Sample search</span>
          </footer>
        </main>

        <aside
          className={`${styles.brief} ${mobileView !== "Details" ? styles.mobileHidden : ""}`}
          aria-label="Selected apartment details"
        >
          {selected ? (
            <>
              <header
                className={`${styles.paneHeader} ${groupOf(selected.id) === "Needs you" ? styles.attentionHeader : ""}`}
              >
                <span className={styles.paneTitle}>{groupOf(selected.id)}</span>
                <button
                  className={styles.iconButton}
                  aria-label="Deselect apartment"
                  onClick={() => {
                    setSelectedId(null);
                    setMobileView("Inbox");
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className={styles.briefScroll}>
                <button
                  className={styles.back}
                  onClick={() => setMobileView("Inbox")}
                >
                  <ArrowLeft aria-hidden="true" />
                  Back to inbox
                </button>
                <div className={styles.briefHeading}>
                  <p>{selected.area}</p>
                  <h2>{selected.address}</h2>
                  <span>Apartment {selected.unit} · 1 bed · 1 bath</span>
                  <strong>
                    ${selected.rent.toLocaleString("en-US")}
                    <small> / month</small>
                  </strong>
                </div>
                <div className={styles.briefTabs}>
                  {["Overview", "Conversation"].map((view) => (
                    <button
                      key={view}
                      aria-pressed={briefView === view}
                      onClick={() => setBriefView(view)}
                    >
                      {view}
                    </button>
                  ))}
                </div>
                {briefView === "Overview" ? (
                  <div className={styles.overview}>
                    <section>
                      <h3>Why it fits</h3>
                      <p>{selected.fit}</p>
                    </section>
                    <section>
                      <h3>What to check</h3>
                      <p>{selected.caveat}</p>
                      <p>Fees have not been provided.</p>
                    </section>
                    <section>
                      <h3>Next step</h3>
                      <p>{nextStep(selected)}</p>
                    </section>
                    <button
                      className={styles.activityLink}
                      onClick={() => {
                        setCenterView("Activity");
                        setMobileView("Map");
                      }}
                    >
                      View Scout’s activity <ArrowRight aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className={styles.conversation}>
                    <p className={styles.eyebrow}>SAMPLE CONVERSATION</p>
                    <div className={styles.message}>
                      <span>
                        {[1, 2].includes(selected.id) ? "Broker" : "Scout"}
                      </span>
                      <p>{selected.activity}</p>
                    </div>
                    {selected.id === 2 && response && (
                      <div className={styles.myMessage}>
                        <span>You · Demo response</span>
                        <p>{response}</p>
                      </div>
                    )}
                    {selected.id === 4 && savedContact && (
                      <div className={styles.myMessage}>
                        <span>You · Contact supplied</span>
                        <p>{savedContact}</p>
                      </div>
                    )}
                  </div>
                )}
                {!stopped.includes(selected.id) &&
                  selected.id === 2 &&
                  !response && (
                    <section className={styles.resolve}>
                      <h3>Does an October 1 move-in work?</h3>
                      <p>Your answer lets Scout continue arranging the tour.</p>
                      {suggesting ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (date) answer(`Preferred move-in: ${date}`);
                          }}
                        >
                          <label htmlFor="move-in">
                            Preferred move-in date
                          </label>
                          <input
                            id="move-in"
                            type="date"
                            required
                            value={date}
                            onChange={(event) => setDate(event.target.value)}
                          />
                          <div className={styles.actions}>
                            <button className={styles.primaryButton}>
                              Use this date
                            </button>
                            <button
                              type="button"
                              className={styles.button}
                              onClick={() => setSuggesting(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className={styles.actions}>
                          <button
                            className={styles.primaryButton}
                            onClick={() => answer("October 1 works")}
                          >
                            Yes, October 1 works
                          </button>
                          <button
                            className={styles.button}
                            onClick={() => setSuggesting(true)}
                          >
                            Suggest another date
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                {!stopped.includes(selected.id) &&
                  selected.id === 4 &&
                  !savedContact && (
                    <section className={styles.resolve}>
                      <h3>No broker contact found</h3>
                      <p>Add an email for Scout to verify before outreach.</p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          setSavedContact(contact.trim());
                          setNotice(
                            "Contact saved in this demo. No email was sent.",
                          );
                        }}
                      >
                        <label htmlFor="broker-email">Broker email</label>
                        <input
                          id="broker-email"
                          type="email"
                          required
                          value={contact}
                          onChange={(event) => setContact(event.target.value)}
                          placeholder="broker@example.com"
                        />
                        <button className={styles.primaryButton}>
                          Save contact
                        </button>
                      </form>
                    </section>
                  )}
                {selected.id === 2 && response && (
                  <p className={styles.resolution}>
                    Demo response recorded.{" "}
                    <button
                      onClick={() => {
                        setResponse("");
                        setNotice("Demo response undone.");
                      }}
                    >
                      Undo
                    </button>
                  </p>
                )}
                {selected.id === 4 && savedContact && (
                  <p className={styles.resolution}>
                    Contact awaiting verification.{" "}
                    <button
                      onClick={() => {
                        setSavedContact("");
                        setNotice("Demo contact removed.");
                      }}
                    >
                      Undo
                    </button>
                  </p>
                )}
                <p className={styles.sourceNote}>
                  Fictional listing. Original photos and source links aren’t
                  available.
                </p>
              </div>
              <footer className={styles.briefFooter}>
                <button
                  className={styles.button}
                  onClick={() => {
                    const closed = stopped.includes(selected.id);
                    setStopped(
                      closed
                        ? stopped.filter((id) => id !== selected.id)
                        : [...stopped, selected.id],
                    );
                    setNotice(
                      closed
                        ? "Demo pursuit resumed."
                        : "Demo pursuit stopped. Find it under Closed.",
                    );
                  }}
                >
                  {stopped.includes(selected.id)
                    ? "Resume pursuit"
                    : "Stop pursuing"}
                </button>
                <span>Changes reset on refresh</span>
              </footer>
            </>
          ) : (
            <>
              <header className={styles.paneHeader}>Nothing selected</header>
              <div className={styles.empty}>
                <Inbox aria-hidden="true" />
                <p>
                  Choose an apartment from the inbox
                  <br />
                  to see its details and conversation.
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
      <p className={styles.notice} role="status">
        {notice}
      </p>
      <dialog
        ref={preferences}
        className={styles.preferences}
        aria-labelledby="preferences-title"
      >
        <header>
          <h2 id="preferences-title">Search preferences</h2>
          <button
            autoFocus
            className={styles.iconButton}
            aria-label="Close preferences"
            onClick={() => preferences.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <p>Read-only sample profile</p>
        <dl>
          <div>
            <dt>Areas</dt>
            <dd>Brooklyn & Manhattan</dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>Up to $3,500 / month</dd>
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
      </dialog>
    </div>
  );
}
