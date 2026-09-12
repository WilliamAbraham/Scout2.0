"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Compass,
  Pause,
  Play,
  SlidersHorizontal,
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
    stage: "New match",
    next: "Checking the broker’s contact details",
    fit: "Within budget · Dishwasher · Near transit",
    caveat: "Pet policy and move-in date are unknown.",
    activity:
      "This apartment was found in a sample listing alert. Broker contact details still need verification.",
  },
];

export function ScoutDashboard() {
  const [paused, setPaused] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [stopped, setStopped] = useState<number[]>([]);
  const [response, setResponse] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [date, setDate] = useState("");
  const [panel, setPanel] = useState<number | "preferences" | null>(null);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const question = useRef<HTMLHeadingElement>(null);
  const selected = apartments.find((apartment) => apartment.id === panel);
  const needsAnswer = !response && !stopped.includes(2);
  const visible = apartments.filter(
    (apartment) => showAll || !stopped.includes(apartment.id),
  );
  const waiting = [2, 3].filter(
    (id) => !stopped.includes(id) && (id === 3 || response),
  ).length;

  function openPanel(value: number | "preferences") {
    setPanel(value);
    dialog.current?.showModal();
  }

  function answer(value: string) {
    setResponse(value);
    setSuggesting(false);
    setNotice(`Demo response recorded: ${value}. No message was sent.`);
  }

  function stage(id: number, fallback: string) {
    if (stopped.includes(id)) return "Stopped";
    if (id === 2) return response ? "Awaiting reply" : "Needs you";
    return fallback;
  }

  return (
    <div className={styles.dashboard}>
      <a className={styles.skip} href="#main">
        Skip to apartments
      </a>
      <header className={styles.header}>
        <span className={styles.logo}>
          <Compass aria-hidden="true" />
          scout
        </span>
        <span className={styles.demo}>Interactive demo</span>
        <button
          className={styles.preferences}
          onClick={() => openPanel("preferences")}
        >
          <SlidersHorizontal aria-hidden="true" />
          Search preferences
        </button>
      </header>
      <main id="main" className={styles.main}>
        <div className={styles.title}>
          <h1>Your apartment search</h1>
          <p>Brooklyn & Manhattan · 1 bed · Up to $3,500</p>
        </div>
        <div className={styles.status}>
          <div>
            <span className={paused ? styles.pausedDot : styles.liveDot} />
            <p>
              <strong>{paused ? "Search paused" : "Scout is on it"}</strong>
              <span>
                {paused
                  ? "Resume when you’re ready."
                  : `Sample check: 10 minutes ago · Waiting for ${waiting} ${waiting === 1 ? "reply" : "replies"}`}
              </span>
            </p>
          </div>
          <button
            className={styles.quietButton}
            onClick={() => {
              setPaused(!paused);
              setNotice(
                paused
                  ? "Demo search resumed."
                  : "Demo search paused. No live automation is connected.",
              );
            }}
          >
            {paused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
        <p className={styles.demoNote}>
          Sample apartments and activity. Changes reset on refresh. No messages
          are sent.
        </p>

        <section
          className={needsAnswer ? styles.needsYou : styles.caughtUp}
          aria-labelledby="needs-heading"
        >
          {needsAnswer ? (
            <>
              <div className={styles.sectionLabel}>
                <span className={styles.amberDot} />
                <h2 id="needs-heading" ref={question} tabIndex={-1}>
                  Needs you
                </h2>
                <span>1 question</span>
              </div>
              <p className={styles.requestAddress}>
                87 Clinton Street <span>· $3,200 / mo</span>
              </p>
              <h3>Does an October 1 move-in work for you?</h3>
              <p className={styles.muted}>
                The broker needs your date before arranging a tour.
              </p>
              {suggesting ? (
                <form
                  className={styles.dateForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (date) answer(`Suggested move-in: ${date}`);
                  }}
                >
                  <label htmlFor="move-in">Your preferred move-in date</label>
                  <div>
                    <input
                      id="move-in"
                      type="date"
                      required
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                    <button className={styles.primaryButton} type="submit">
                      Use this date
                    </button>
                    <button
                      type="button"
                      className={styles.quietButton}
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
                    Yes, October 1 works <ArrowRight aria-hidden="true" />
                  </button>
                  <button
                    className={styles.quietButton}
                    onClick={() => setSuggesting(true)}
                  >
                    Suggest another date
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <Check aria-hidden="true" />
              <h2 id="needs-heading">Nothing needs your attention</h2>
              {response && (
                <button
                  className={styles.quietButton}
                  onClick={() => {
                    setResponse("");
                    setNotice("Sample response undone.");
                  }}
                >
                  Undo response
                </button>
              )}
            </>
          )}
        </section>

        {!stopped.includes(1) && (
          <button className={styles.tour} onClick={() => openPanel(1)}>
            <span className={styles.calendarIcon}>
              <CalendarDays aria-hidden="true" />
            </span>
            <span>
              <strong>Next tour · Mon, Sep 14 at 11 AM</strong>
              <span>234 Wythe Avenue · Williamsburg</span>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        )}

        <section
          className={styles.apartments}
          aria-labelledby="apartments-heading"
        >
          <div className={styles.listHeader}>
            <h2 id="apartments-heading">
              Your apartments <span>{visible.length}</span>
            </h2>
            <div className={styles.filters} aria-label="Apartment filter">
              <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>
                Active
              </button>
              <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
                All
              </button>
            </div>
          </div>
          <ul className={styles.list}>
            {visible.map((apartment) => (
              <li key={apartment.id}>
                <button
                  className={styles.apartment}
                  onClick={() => openPanel(apartment.id)}
                  aria-label={`View ${apartment.address}`}
                >
                  <span className={styles.thumbnail} aria-hidden="true">
                    <Building2 />
                  </span>
                  <span className={styles.apartmentInfo}>
                    <strong>{apartment.address}</strong>
                    <span>{apartment.area} · 1 bed</span>
                    <small>
                      {stopped.includes(apartment.id)
                        ? "Scout won’t pursue this apartment"
                        : apartment.id === 2 && response
                          ? "Move-in date recorded · Waiting for broker"
                          : apartment.next}
                    </small>
                  </span>
                  <span className={styles.apartmentMeta}>
                    <strong>
                      ${apartment.rent.toLocaleString("en-US")}
                      <small> / mo</small>
                    </strong>
                    <span
                      className={
                        apartment.id === 2 && needsAnswer
                          ? styles.attentionBadge
                          : styles.stage
                      }
                    >
                      {stage(apartment.id, apartment.stage)}
                    </span>
                  </span>
                  <ChevronRight
                    className={styles.rowArrow}
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && (
            <div className={styles.empty}>
              <p>No active apartments.</p>
              <button
                className={styles.quietButton}
                onClick={() => setShowAll(true)}
              >
                View stopped apartments
              </button>
            </div>
          )}
        </section>
        <p className={styles.notice} role="status">
          {notice}
        </p>
      </main>

      <dialog
        ref={dialog}
        className={styles.dialog}
        onClose={() => setPanel(null)}
        aria-labelledby="panel-title"
      >
        <div className={styles.dialogHeader}>
          <span>
            {panel === "preferences" ? "Your search" : "Apartment details"}
          </span>
          <button
            autoFocus
            className={styles.iconButton}
            aria-label="Close details"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className={styles.dialogBody}>
          {panel === "preferences" ? (
            <>
              <h2 id="panel-title">Search preferences</h2>
              <p className={styles.muted}>
                Read-only sample profile for this preview.
              </p>
              <dl className={styles.facts}>
                <div>
                  <dt>Areas</dt>
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
              <p className={styles.muted}>
                In the connected product, Scout will use your preferences for
                routine outreach and ask when a decision needs your input.
              </p>
            </>
          ) : (
            selected && (
              <>
                <h2 id="panel-title">{selected.address}</h2>
                <p className={styles.muted}>
                  {selected.area} · Apartment {selected.unit}
                </p>
                <div className={styles.detailSummary}>
                  <strong>
                    ${selected.rent.toLocaleString("en-US")}
                    <small> / month</small>
                  </strong>
                  <span className={styles.stage}>
                    {stage(selected.id, selected.stage)}
                  </span>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>Layout</dt>
                    <dd>1 bed · 1 bath</dd>
                  </div>
                  <div>
                    <dt>Fees</dt>
                    <dd>Not provided</dd>
                  </div>
                </dl>
                <section>
                  <h3>Why it fits</h3>
                  <p>{selected.fit}</p>
                </section>
                <section>
                  <h3>What to check</h3>
                  <p>{selected.caveat}</p>
                </section>
                <section>
                  <h3>Conversation</h3>
                  <p>{selected.activity}</p>
                  {selected.id === 2 && response && (
                    <p className={styles.response}>
                      You: {response}
                      <small>Recorded in this demo only.</small>
                    </p>
                  )}
                </section>
                <section className={styles.sourceNote}>
                  <h3>Photos & original listing</h3>
                  <p>
                    This is a fictional apartment fixture. Photos and an
                    original listing link aren’t available.
                  </p>
                </section>
                {selected.id === 2 && needsAnswer && (
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      dialog.current?.close();
                      question.current?.focus();
                      question.current?.scrollIntoView({ block: "center" });
                    }}
                  >
                    Answer move-in question <ArrowRight aria-hidden="true" />
                  </button>
                )}
                <button
                  className={styles.stopButton}
                  onClick={() => {
                    const wasStopped = stopped.includes(selected.id);
                    setStopped(
                      wasStopped
                        ? stopped.filter((id) => id !== selected.id)
                        : [...stopped, selected.id],
                    );
                    setNotice(
                      `${selected.address}: ${wasStopped ? "restored to active apartments" : "stopped in this demo"}.`,
                    );
                  }}
                >
                  {stopped.includes(selected.id)
                    ? "Resume pursuing this apartment"
                    : "Stop pursuing this apartment"}
                </button>
              </>
            )
          )}
        </div>
      </dialog>
    </div>
  );
}
