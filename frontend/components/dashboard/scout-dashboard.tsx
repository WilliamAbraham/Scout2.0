"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Home,
  Inbox,
  List,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { demoListings, demoNow } from "./inbox-fixtures";
import {
  actionOwner,
  activeGroups,
  assessmentGroups,
  compareListings,
  dismissDemoListing,
  groupFor,
  isClosed,
  nextStep,
  stageLabels,
  statusLabel,
  stopDemoPursuit,
  submitDemoResolution,
} from "./inbox-model";
import type { InboxListing, View } from "./inbox-model";
import { ListingQuestions, ListingSnapshot } from "./listing-snapshot";
import {
  LiveBlockerControl,
  LiveClosePursuitControl,
} from "./live-pursuit-controls";
import { SearchPauseControl } from "./search-pause-control";
import { setSearchPaused, submitPursuitCommand } from "@/app/actions/pursuits";
import type { CommandActionState } from "@/lib/inbox-command";
import {
  profileSummary,
  sampleProfile,
  signedOutPreferences,
} from "@/lib/search-profile";
import type { PreferencesContext, SearchProfile } from "@/lib/search-profile";
import styles from "./scout-dashboard.module.css";

export type InboxAccount = {
  status: string;
  detail: string;
  paused: boolean;
  profileSummary: string;
  error: boolean;
};
const demoAccount: InboxAccount = {
  status: "Demo workspace",
  detail: "Sample data · No messages sent",
  paused: false,
  profileSummary: "1 bedroom · Up to $3,500",
  error: false,
};
const initialCommandState: CommandActionState = {
  error: null,
  message: null,
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
function timestamp(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}
function shortTime(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}
function beds(value: number | null) {
  return value === null
    ? "Beds unknown"
    : value === 0
      ? "Studio"
      : `${value} bed${value === 1 ? "" : "s"}`;
}

export function ScoutDashboard({
  initialListings = demoListings,
  mode = "demo",
  account = demoAccount,
  preferencesContext = signedOutPreferences,
}: {
  initialListings?: InboxListing[];
  mode?: "demo" | "live";
  account?: InboxAccount;
  preferencesContext?: PreferencesContext;
}) {
  const router = useRouter();
  const searchSummary = preferencesContext.profileError
    ? "Search preferences unavailable"
    : preferencesContext.signedIn
      ? profileSummary(preferencesContext.profile)
      : account.profileSummary;
  const [demoListingState, setDemoListingState] = useState(initialListings);
  const [view, setView] = useState<View>("Active");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialListings.find((item) => item.pursuit?.blocker)?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [assessment, setAssessment] = useState("All");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [workspace, setWorkspace] = useState("List");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [demoPaused, setDemoPaused] = useState(account.paused);
  const [pursuitState, pursuitAction, pursuitPending] = useActionState(
    submitPursuitCommand,
    initialCommandState,
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    setSearchPaused,
    initialCommandState,
  );
  const [refreshPending, startRefresh] = useTransition();
  const [notice, setNotice] = useState("");
  const [previous, setPrevious] = useState<Record<string, InboxListing>>({});
  const listHeading = useRef<HTMLHeadingElement>(null);
  const listings = mode === "live" ? initialListings : demoListingState;
  const paused = mode === "live" ? account.paused : demoPaused;
  const controlsDisabled = pursuitPending || pausePending || refreshPending;
  const refreshInbox = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const selected = listings.find((item) => item.id === selectedId);
  const active = listings.filter((item) => groupFor(item, "Active"));
  const needsYou = active.filter((item) => item.pursuit?.blocker).length;
  const counts: Record<View, number> = {
    Active: active.length,
    "All listings": listings.length,
    Closed: listings.filter(isClosed).length,
  };
  const filtered = listings.filter(
    (item) =>
      groupFor(item, view) &&
      `${item.address} ${item.unit ?? ""} ${item.area ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (view !== "Active" || !attentionOnly || item.pursuit?.blocker) &&
      (view !== "All listings" ||
        assessment === "All" ||
        groupFor(item, view) === assessment),
  );
  const groups =
    view === "Active"
      ? activeGroups
      : view === "All listings"
        ? assessmentGroups
        : ["Closed"];
  function choose(item: InboxListing) {
    setSelectedId(item.id);
    setShowDetails(true);
  }
  function switchView(nextView: View) {
    setView(nextView);
    setAttentionOnly(false);
    setAssessment("All");
    setShowDetails(false);
  }
  function update(item: InboxListing, changed: InboxListing) {
    if (mode !== "demo" || item === changed) return;
    setPrevious((value) => ({ ...value, [item.id]: item }));
    setDemoListingState((value) =>
      value.map((entry) => (entry.id === item.id ? changed : entry)),
    );
  }
  function undo(item: InboxListing) {
    const original = previous[item.id];
    if (!original) return;
    setDemoListingState((value) =>
      value.map((entry) => (entry.id === item.id ? original : entry)),
    );
    setPrevious((value) => {
      const copy = { ...value };
      delete copy[item.id];
      return copy;
    });
    setNotice("Demo change undone.");
  }
  function back() {
    setShowDetails(false);
    requestAnimationFrame(() => listHeading.current?.focus());
  }

  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#inbox">
        Skip to apartments
      </a>
      <div className={styles.window}>
        <aside className={styles.navigation} aria-label="Scout navigation">
          <div className={styles.brand}>
            <Home aria-hidden="true" />
            <span>Scout</span>
            <small>{mode === "demo" ? "PREVIEW" : "YOUR SEARCH"}</small>
          </div>
          <nav className={styles.views} aria-label="Listing views">
            {(["Active", "All listings", "Closed"] as View[]).map((name) => {
              const Icon =
                name === "Active"
                  ? Inbox
                  : name === "Closed"
                    ? Archive
                    : Building2;
              return (
                <button
                  key={name}
                  aria-current={
                    view === name && !attentionOnly ? "page" : undefined
                  }
                  onClick={() => switchView(name)}
                >
                  <Icon aria-hidden="true" />
                  <span>{name}</span>
                  <small>{counts[name]}</small>
                </button>
              );
            })}
            <button
              className={styles.needsShortcut}
              aria-current={attentionOnly ? "page" : undefined}
              onClick={() => {
                switchView("Active");
                setAttentionOnly(true);
              }}
            >
              <CircleHelp aria-hidden="true" />
              <span>Needs you</span>
              <small>{needsYou}</small>
            </button>
          </nav>
          <div className={styles.mobileAccount}>
            <span>{paused ? "Scout paused" : account.status}</span>
            {mode === "demo" ? (
              <button
                onClick={() => setDemoPaused(!paused)}
                aria-label={paused ? "Resume demo" : "Pause demo"}
              >
                {paused ? (
                  <Play aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
              </button>
            ) : (
              <SearchPauseControl
                paused={paused}
                compact
                action={pauseAction}
                state={pauseState}
                pending={pausePending}
                disabled={controlsDisabled}
                onRefresh={refreshInbox}
              />
            )}
            <Link href="/preferences" aria-label="Search preferences">
              <Settings2 aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.searchProfile}>
            <span>Your search</span>
            <p>{searchSummary}</p>
            <Link href="/preferences">
              <Settings2 aria-hidden="true" /> View preferences
            </Link>
          </div>
          <footer className={styles.navFooter}>
            <div>
              <span className={styles.statusDot} />
              <strong>{paused ? "Scout paused" : account.status}</strong>
            </div>
            <p>
              {paused
                ? "Actions paused. Your progress is preserved."
                : account.detail}
            </p>
            {mode === "demo" ? (
              <>
                <button
                  onClick={() => {
                    setDemoPaused(!paused);
                    setNotice(
                      paused
                        ? "Demo resumed."
                        : "Demo paused. No external actions are running.",
                    );
                  }}
                >
                  {paused ? (
                    <Play aria-hidden="true" />
                  ) : (
                    <Pause aria-hidden="true" />
                  )}
                  {paused ? "Resume demo" : "Pause demo"}
                </button>
                <Link href="/dashboard">
                  Open connected inbox <ArrowUpRight aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <SearchPauseControl
                  paused={paused}
                  action={pauseAction}
                  state={pauseState}
                  pending={pausePending}
                  disabled={controlsDisabled}
                  onRefresh={refreshInbox}
                />
                <Link href="/">
                  Open sample workspace <ArrowUpRight aria-hidden="true" />
                </Link>
              </>
            )}
          </footer>
        </aside>

        <main
          id="inbox"
          className={`${styles.center} ${showDetails ? styles.hideOnMobile : ""}`}
        >
          <header className={styles.centerHeader}>
            <div>
              <p className={styles.eyebrow}>
                {mode === "demo"
                  ? "YOUR APARTMENT SEARCH · SAMPLE"
                  : "YOUR APARTMENT SEARCH"}
              </p>
              <h1 tabIndex={-1} ref={listHeading}>
                {attentionOnly
                  ? "Needs you"
                  : view === "Active"
                    ? "Active pursuits"
                    : view}
                <span>{filtered.length}</span>
              </h1>
            </div>
            <div className={styles.viewSwitch} aria-label="Workspace view">
              {["List", "Map"].map((name) => (
                <button
                  key={name}
                  aria-pressed={workspace === name}
                  onClick={() => setWorkspace(name)}
                >
                  {name === "List" ? (
                    <List aria-hidden="true" />
                  ) : (
                    <MapPin aria-hidden="true" />
                  )}
                  {name}
                </button>
              ))}
            </div>
          </header>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search aria-hidden="true" />
              <input
                aria-label="Search apartments"
                placeholder="Search address or neighborhood"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X aria-hidden="true" />
                </button>
              )}
            </label>
            <span className={styles.sortNote}>
              {view === "Active" ? "Needs you first" : "Newest received first"}
            </span>
          </div>
          {view === "All listings" && (
            <div className={styles.filters} aria-label="Listing assessment">
              {["All", ...assessmentGroups].map((name) => (
                <button
                  key={name}
                  aria-pressed={assessment === name}
                  onClick={() => setAssessment(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {account.error && (
            <p className={styles.accountBanner} role="alert">
              {account.detail}
            </p>
          )}
          {paused && (
            <p className={styles.accountBanner}>
              Scout is paused. You can still review apartments and their
              progress.
            </p>
          )}
          {workspace === "Map" ? (
            <div className={styles.mapWorkspace}>
              <iframe
                title="OpenStreetMap overview of Brooklyn and Lower Manhattan"
                src="https://www.openstreetmap.org/export/embed.html?bbox=-74.025%2C40.673%2C-73.935%2C40.741&layer=mapnik"
                referrerPolicy="no-referrer"
              />
              <div className={styles.mapNote}>
                <MapPin aria-hidden="true" />
                <div>
                  <strong>Search area overview</strong>
                  <p>
                    Listing locations aren’t pinned. Use the list to review
                    individual apartments.
                  </p>
                  <button onClick={() => setWorkspace("List")}>
                    Back to list
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.listScroll}>
              {filtered.length === 0 ? (
                <div className={styles.empty}>
                  <Inbox aria-hidden="true" />
                  <h2>
                    {account.error
                      ? "Your inbox is unavailable"
                      : query || assessment !== "All"
                        ? "No apartments match this view"
                        : attentionOnly
                          ? "Nothing needs your input"
                          : view === "Closed"
                            ? "No closed pursuits"
                            : view === "Active"
                              ? "No active pursuits yet"
                              : "No listings received yet"}
                  </h2>
                  <p>
                    {account.error
                      ? account.detail
                      : query
                        ? "Try another address or neighborhood."
                        : attentionOnly
                          ? "You can check the rest of your search in Active."
                          : view === "Closed"
                            ? "Pursuits you stop or complete will appear here."
                            : view === "Active"
                              ? "Matched apartments appear here once a pursuit starts."
                              : account.detail}
                  </p>
                  <button
                    className={styles.button}
                    onClick={() => {
                      if (account.error) {
                        window.location.reload();
                        return;
                      }
                      if (query || assessment !== "All") {
                        setQuery("");
                        setAssessment("All");
                        return;
                      }
                      setQuery("");
                      setAssessment("All");
                      switchView(
                        view === "Active" && !attentionOnly
                          ? "All listings"
                          : "Active",
                      );
                    }}
                  >
                    {" "}
                    {account.error
                      ? "Try again"
                      : query || assessment !== "All"
                        ? "Clear filters"
                        : view === "Active" && !attentionOnly
                          ? "View all listings"
                          : "Back to active"}
                  </button>
                </div>
              ) : (
                groups.map((group) => {
                  const rows = filtered
                    .filter((item) => groupFor(item, view) === group)
                    .sort((a, b) => compareListings(a, b, view));
                  if (!rows.length) return null;
                  const hidden = collapsed.includes(group);
                  return (
                    <section key={group} className={styles.group}>
                      <button
                        className={styles.groupHeading}
                        aria-expanded={!hidden}
                        aria-controls={`group-${group.replaceAll(" ", "-")}`}
                        onClick={() =>
                          setCollapsed(
                            hidden
                              ? collapsed.filter((name) => name !== group)
                              : [...collapsed, group],
                          )
                        }
                      >
                        {hidden ? (
                          <ChevronRight aria-hidden="true" />
                        ) : (
                          <ChevronDown aria-hidden="true" />
                        )}
                        <span>{group}</span>
                        <small>{rows.length}</small>
                        {group === "Needs you" && (
                          <em>A little input to keep things moving</em>
                        )}
                      </button>
                      <div
                        id={`group-${group.replaceAll(" ", "-")}`}
                        hidden={hidden}
                      >
                        <table
                          className={styles.listingTable}
                          aria-label={`${group} apartments`}
                        >
                          <colgroup>
                            <col className={styles.apartmentCol} />
                            <col className={styles.rentCol} />
                            <col className={styles.progressCol} />
                            <col className={styles.updateCol} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th scope="col">Apartment</th>
                              <th scope="col">Rent</th>
                              <th scope="col">Progress</th>
                              <th scope="col">Latest update</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((item) => (
                              <tr
                                key={item.id}
                                className={
                                  selectedId === item.id
                                    ? styles.selectedRow
                                    : ""
                                }
                              >
                                <td>
                                  <button
                                    className={styles.apartmentButton}
                                    aria-label={`Open ${item.address}${item.unit ? ` apartment ${item.unit}` : ""}`}
                                    aria-pressed={selectedId === item.id}
                                    onClick={() => choose(item)}
                                  >
                                    <Building2 aria-hidden="true" />
                                    <span>
                                      <strong>{item.address}</strong>
                                      <small>
                                        {[
                                          item.unit ? `#${item.unit}` : null,
                                          item.area,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ") ||
                                          "Neighborhood not provided"}
                                      </small>
                                      {item.brokerage && <small>{item.brokerage}</small>}
                                    </span>
                                  </button>
                                </td>
                                <td className={styles.rentCell}>
                                  <strong>{money(item.rent)}</strong>
                                  <small>
                                    {beds(item.beds)}
                                    {item.baths !== null
                                      ? ` · ${item.baths} bath`
                                      : ""}
                                  </small>
                                </td>
                                <td className={styles.progressCell}>
                                  <span
                                    className={`${styles.badge} ${item.pursuit?.blocker && !isClosed(item) ? styles.attentionBadge : ""}`}
                                  >
                                    {statusLabel(item)}
                                  </span>
                                  {item.pursuit?.blocker && !isClosed(item) && (
                                    <small>Needs you</small>
                                  )}
                                </td>
                                <td className={styles.updateCell}>
                                  <p>{nextStep(item)}</p>
                                  {item.pursuit?.recoveredContacts?.map((contact, index) => (
                                    <small key={`contact-${index}`}>
                                      {contact.name ? `${contact.name} · ` : ""}{contact.label}: {[contact.email, contact.phone].filter(Boolean).join(" · ") || "Email and phone not yet found"}
                                    </small>
                                  ))}
                                  <time
                                    dateTime={
                                      item.pursuit?.updatedAt ?? item.observedAt
                                    }
                                    title={timestamp(
                                      item.pursuit?.updatedAt ??
                                        item.observedAt,
                                    )}
                                  >
                                    {item.pursuit?.tour &&
                                    !item.pursuit.blocker &&
                                    !isClosed(item)
                                      ? timestamp(item.pursuit.tour.at)
                                      : `Updated ${shortTime(item.pursuit?.updatedAt ?? item.observedAt)}`}
                                  </time>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          )}
          <footer className={styles.centerFooter}>
            <span>
              {mode === "demo"
                ? "Fictional apartments · Changes reset on refresh"
                : "Persisted records · Worker updates arrive between cycles"}
            </span>
            {mode === "live" && (
              <button
                className={styles.refreshButton}
                onClick={refreshInbox}
                disabled={controlsDisabled}
              >
                <RefreshCw aria-hidden="true" />
                {refreshPending ? "Refreshing…" : "Refresh inbox"}
              </button>
            )}
            <span>
              {listings.length} received · {active.length} active
            </span>
          </footer>
        </main>

        <aside
          className={`${styles.detail} ${!showDetails ? styles.hideOnMobile : ""}`}
          aria-label="Selected apartment details"
        >
          <header className={styles.detailHeader}>
            <button className={styles.back} onClick={back}>
              <ArrowLeft aria-hidden="true" /> Inbox
            </button>
            <span>Apartment details</span>
            {selected && (
              <button
                aria-label="Close apartment details"
                className={styles.iconButton}
                onClick={() => {
                  setSelectedId(null);
                  back();
                }}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </header>
          {selected ? (
            <>
              <ApartmentDetails
                key={selected.id}
                item={selected}
                mode={mode}
                profile={
                  mode === "demo"
                    ? sampleProfile
                    : preferencesContext.profileError
                      ? null
                      : preferencesContext.profile
                }
                canUndo={Boolean(previous[selected.id])}
                onUndo={() => undo(selected)}
                onResolve={(value) => {
                  update(
                    selected,
                    submitDemoResolution(selected, value, demoNow),
                  );
                  setNotice("Saved in the demo. No email or booking was made.");
                }}
                controlsDisabled={controlsDisabled}
                pursuitAction={pursuitAction}
                pursuitState={pursuitState}
                pursuitPending={pursuitPending}
                onRefresh={refreshInbox}
                openPreferences={() => router.push("/preferences#profile-availability")}
              />
              <footer className={styles.detailFooter}>
                {mode === "demo" &&
                  (selected.pursuit ? (
                    isClosed(selected) ? (
                      previous[selected.id] ? (
                        <button
                          className={styles.button}
                          onClick={() => undo(selected)}
                        >
                          Restore pursuit
                        </button>
                      ) : (
                        <span>Pursuit closed</span>
                      )
                    ) : (
                      <button
                        className={styles.button}
                        onClick={() => {
                          update(selected, stopDemoPursuit(selected, demoNow));
                          setNotice(
                            "Pursuit stopped in the demo. Find it in Closed.",
                          );
                        }}
                      >
                        Stop pursuing
                      </button>
                    )
                  ) : (
                    <button
                      className={styles.button}
                      onClick={() =>
                        update(selected, dismissDemoListing(selected))
                      }
                    >
                      {selected.dismissed
                        ? "Restore listing"
                        : "Dismiss listing"}
                    </button>
                  ))}
                {mode === "live" && selected.pursuit && !isClosed(selected) && (
                  <LiveClosePursuitControl
                    pursuitId={selected.pursuit.id}
                    expectedUpdatedAt={selected.pursuit.updatedAt}
                    action={pursuitAction}
                    state={pursuitState}
                    pending={pursuitPending}
                    disabled={controlsDisabled}
                    onRefresh={refreshInbox}
                  />
                )}
                <span>
                  {mode === "demo" ? "Demo controls" : "Live controls"}
                </span>
              </footer>
            </>
          ) : (
            <div className={styles.empty}>
              <Building2 aria-hidden="true" />
              <h2>Pick an apartment</h2>
              <p>Its next step, details and conversation will appear here.</p>
            </div>
          )}
        </aside>
      </div>
      {mode === "live" && (
        <div className={styles.commandResults}>
          <MutationResult
            label="Pursuit update"
            state={pursuitState}
            onRefresh={refreshInbox}
          />
          <MutationResult
            label="Search status"
            state={pauseState}
            onRefresh={refreshInbox}
          />
        </div>
      )}
      <p className={styles.notice} role="status">
        {notice}
      </p>
    </div>
  );
}

function MutationResult({
  label,
  state,
  onRefresh,
}: {
  label: string;
  state: CommandActionState;
  onRefresh: () => void;
}) {
  const [dismissed, setDismissed] = useState<CommandActionState | null>(null);
  if (dismissed === state || (!state.error && !state.message)) return null;
  return (
    <div
      className={state.error ? styles.commandError : styles.commandSuccess}
      role={state.error ? "alert" : "status"}
    >
      <p>
        <strong>{label}:</strong> {state.error ?? state.message}
      </p>
      {state.error && (
        <button type="button" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" /> Refresh inbox
        </button>
      )}
      <button
        type="button"
        className={styles.commandDismiss}
        aria-label={`Dismiss ${label.toLowerCase()}`}
        onClick={() => setDismissed(state)}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

function ApartmentDetails({
  item,
  mode,
  profile,
  canUndo,
  onUndo,
  onResolve,
  controlsDisabled,
  pursuitAction,
  pursuitState,
  pursuitPending,
  onRefresh,
  openPreferences,
}: {
  item: InboxListing;
  mode: "demo" | "live";
  profile: SearchProfile | null;
  canUndo: boolean;
  onUndo: () => void;
  onResolve: (value: string) => void;
  controlsDisabled: boolean;
  pursuitAction: (form: FormData) => void;
  pursuitState: CommandActionState;
  pursuitPending: boolean;
  onRefresh: () => void;
  openPreferences: () => void;
}) {
  const [tab, setTab] = useState("Overview");
  const [value, setValue] = useState("");
  const pursuit = item.pursuit;
  const tourEndsAt = pursuit?.tour?.endsAt;
  const blocker = !isClosed(item) ? pursuit?.blocker : null;
  const actionHeading = useRef<HTMLHeadingElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onResolve(value);
    requestAnimationFrame(() => actionHeading.current?.focus());
  }
  return (
    <div className={styles.detailScroll}>
      <div className={styles.detailTitle}>
        <p>{item.area ?? "Area not provided"}</p>
        <h2>{item.address}</h2>
        <p>
          {item.unit ? `Apartment ${item.unit} · ` : ""}
          {beds(item.beds)} ·{" "}
          {item.baths === null ? "Baths unknown" : `${item.baths} bath`}
        </p>
        <div>
          <strong>
            {money(item.rent)}
            <small> / month</small>
          </strong>
          <span className={styles.badge}>
            {pursuit ? stageLabels[pursuit.stage] : statusLabel(item)}
          </span>
        </div>
      </div>
      <section
        className={`${styles.nextAction} ${blocker ? styles.needsAction : ""}`}
        aria-label="Current action"
      >
        <p className={styles.eyebrow}>
          {pursuit?.tour && !blocker && !isClosed(item)
            ? "TOUR DETAILS"
            : actionOwner(item)}
        </p>
        <h3 ref={actionHeading} tabIndex={-1}>
          {pursuit?.tour && !blocker && !isClosed(item)
            ? `${timestamp(pursuit.tour.at)}${tourEndsAt ? ` – ${timestamp(tourEndsAt)}` : ""}`
            : blocker
              ? blocker.question
              : statusLabel(item)}
        </h3>
        <p>{blocker ? blocker.detail : nextStep(item)}</p>
        {pursuit?.tour && !isClosed(item) && (
          <div className={styles.tourInfo}>
            <CalendarDays aria-hidden="true" />
            <span>
              {pursuit.tour.location}
              <small>
                {tourEndsAt && `Ends ${timestamp(tourEndsAt)} · `}
                {pursuit.tour.calendarStatus}
              </small>
            </span>
          </div>
        )}
        {blocker &&
          mode === "demo" &&
          ["no_contact", "unanswerable_question", "no_fitting_slot"].includes(
            blocker.reason,
          ) && (
            <form onSubmit={submit}>
              <label htmlFor={`resolve-${item.id}`}>
                {blocker.reason === "no_contact"
                  ? "Broker email"
                  : blocker.reason === "no_fitting_slot"
                    ? "Your preferred tour time"
                    : "Your answer"}
              </label>
              {blocker.reason === "no_contact" ? (
                <input
                  id={`resolve-${item.id}`}
                  type="email"
                  placeholder="broker@example.com"
                  required
                  value={value}

                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <textarea
                  id={`resolve-${item.id}`}
                  placeholder={
                    blocker.reason === "unanswerable_question"
                      ? "For example: October 1 works for me."
                      : "Tell Scout when you can tour"
                  }
                  required
                  value={value}

                  onChange={(event) => setValue(event.target.value)}
                />
              )}
              <button className={styles.primaryButton} disabled={!value.trim()}>
                {blocker.reason === "no_contact"
                  ? "Submit contact"
                  : "Submit answer"}
                <ChevronRight aria-hidden="true" />
              </button>
            </form>
          )}
        {blocker && mode === "live" && pursuit && (
          <LiveBlockerControl
            blockerReason={blocker.reason}
            pursuitId={pursuit.id}
            expectedUpdatedAt={pursuit.updatedAt}
            action={pursuitAction}
            state={pursuitState}
            pending={pursuitPending}
            disabled={controlsDisabled}
            onRefresh={onRefresh}
            openPreferences={openPreferences}
          />
        )}
        {pursuit?.submittedValue && !isClosed(item) && (
          <div className={styles.receipt} role="status">
            <Check aria-hidden="true" />
            <div>
              <strong>
                {pursuit.work === "contact_submitted"
                  ? "Contact supplied · Demo receipt"
                  : "Answer submitted"}
              </strong>
              <p>{pursuit.submittedValue}</p>
              <small>Queued in this demo. No external action completed.</small>
            </div>
          </div>
        )}
        {!blocker && pursuit?.nextFollowUpAt && !isClosed(item) && (
          <div className={styles.followUpDetails}>
            <strong>Follow-up scheduled</strong>
            <time dateTime={pursuit.nextFollowUpAt}>
              {timestamp(pursuit.nextFollowUpAt)}
            </time>
            {pursuit.followUpCount !== undefined && (
              <small>
                {pursuit.followUpCount} follow-up
                {pursuit.followUpCount === 1 ? "" : "s"} recorded
              </small>
            )}
          </div>
        )}
        {canUndo && !isClosed(item) && mode === "demo" && (
          <button className={styles.textButton} onClick={onUndo}>
            Undo demo change
          </button>
        )}
      </section>
      <div className={styles.detailTabs} aria-label="Apartment information">
        {["Overview", "Conversation", "Activity"].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <div className={styles.overview}>
          <ListingSnapshot
            item={item}
            profile={profile}
            demo={mode === "demo"}
          />
          <section>
            <h3>
              {item.assessment === "not_fit"
                ? "Why it didn’t match"
                : item.assessment === "checking"
                  ? "Checking your criteria"
                  : "Why it fits"}
            </h3>
            <p>
              {item.matchReason ??
                "Scout has not recorded a match explanation yet."}
            </p>
          </section>
          <ListingQuestions item={item} profile={profile} />
          <section>
            <h3>Broker / brokerage contact</h3>
            {item.brokerage && <p>{item.brokerage}</p>}
            {pursuit?.contactProvidedByUser && (
              <p className={styles.userProvidedLabel}>Provided by you</p>
            )}
            {pursuit?.contacts.length ? (
              pursuit.contacts.map((contact, index) => (
                <p key={`${contact.email}-${index}`}>
                  {contact.name ?? "Name not provided"}
                  <br />
                  {contact.email ?? "Email not provided"}
                  {contact.phone && <><br />{contact.phone}</>}
                </p>
              ))
            ) : (
              !pursuit?.recoveredContacts?.length && (
                <p>Email and phone have not been recovered yet. Check the listing’s contact section.</p>
              )
            )}
            {pursuit?.recoveredContacts?.map((contact, index) => (
              <p key={`recovered-${index}`}>
                <small>{contact.label}</small><br />
                {contact.name ?? item.brokerage ?? "Name not provided"}<br />
                {contact.email ?? "Email not provided"}
                {contact.phone && <><br />{contact.phone}</>}
                {contact.checkedAt && <><br /><small>Recorded {timestamp(contact.checkedAt)}</small></>}
                {contact.sourceUrl && <><br /><a href={contact.sourceUrl} target="_blank" rel="noreferrer">View contact source <ArrowUpRight aria-hidden="true" /></a></>}
              </p>
            ))}
            {pursuit?.contactEvidenceUrl && (
              <a
                href={pursuit.contactEvidenceUrl}
                target="_blank"
                rel="noreferrer"
              >
                View contact evidence <ArrowUpRight aria-hidden="true" />
              </a>
            )}
          </section>
          <section>
            <h3>Listing source</h3>
            <p>Received {timestamp(item.observedAt)}</p>
            {item.lastSeenAt && (
              <p>Last seen in alerts {timestamp(item.lastSeenAt)}</p>
            )}
            <p>Availability and current price have not been rechecked.</p>
            {item.sourceUrl ? (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Open original listing <ArrowUpRight aria-hidden="true" />
              </a>
            ) : (
              <p>
                {mode === "demo"
                  ? "Fictional listing. Original photos and source links aren’t available."
                  : "The original listing link is unavailable in this record."}
              </p>
            )}
          </section>
        </div>
      ) : tab === "Conversation" ? (
        <div className={styles.conversation}>
          <p className={styles.eyebrow}>
            {mode === "demo" ? "SAMPLE CONVERSATION" : "CONVERSATION"}
          </p>
          {item.messages.length ? (
            item.messages.map((message) => {
              const draft = message.kind === "draft";
              return (
                <article
                  key={message.id}
                  className={draft ? styles.draftMessage : undefined}
                >
                  <header>
                    <strong>{draft ? "Draft · Not sent" : message.from}</strong>
                    <time dateTime={message.at}>{timestamp(message.at)}</time>
                  </header>
                  {message.subject && (
                    <p className={styles.messageField}>
                      <strong>Subject</strong> {message.subject}
                    </p>
                  )}
                  {message.to?.length ? (
                    <p className={styles.messageField}>
                      <strong>To</strong> {message.to.join(", ")}
                    </p>
                  ) : null}
                  {message.cc?.length ? (
                    <p className={styles.messageField}>
                      <strong>Cc</strong> {message.cc.join(", ")}
                    </p>
                  ) : null}
                  <p className={styles.messageBody}>{message.text}</p>
                </article>
              );
            })
          ) : (
            <p className={styles.muted}>
              {mode === "demo"
                ? "No conversation has started for this apartment."
                : "Message content is not connected yet. No conversation is inferred from the pursuit stage."}
            </p>
          )}
        </div>
      ) : (
        <ol className={styles.timeline}>
          {[...item.events]
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .map((event) => (
              <li key={event.id}>
                <span className={styles.timelineDot} />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                  <time dateTime={event.at}>{timestamp(event.at)}</time>
                </div>
              </li>
            ))}
          {!item.events.length && <li>No activity recorded yet.</li>}
        </ol>
      )}
    </div>
  );
}
