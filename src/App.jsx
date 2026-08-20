import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Funnel,
  MagnifyingGlass,
  Question,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { applyVote, createInitialState, filterSignals, getNextSelection } from "./app-state.js";
import {
  createFeedbackService,
  reconcileFeedbackSource,
  reconcileLoadedRecords,
  reconcileMutationRecord,
  seedVoteRecords,
} from "./feedback-service.js";

const CATEGORY_ORDER = ["Models", "Tools", "Workflows", "Demos", "Utilities"];
const CATEGORY_ACCENTS = {
  Models: "lime",
  Tools: "cyan",
  Workflows: "lime",
  Demos: "orange",
  Utilities: "violet",
};
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function rankItems(items) {
  return items.map((item, index) => ({ ...item, rank: index + 1 }));
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`)).toUpperCase();
}

function formatCuratedTime(curatedAt, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(curatedAt));
}

function formatVerifiedDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`)).toUpperCase();
}

function shiftDate(date, amount) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function shortCategory(category) {
  return ({
    Models: "MODEL",
    Tools: "TOOL",
    Workflows: "WORKFLOW",
    Demos: "DEMO",
    Utilities: "UTILITY",
  })[category] ?? category.toUpperCase();
}

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => globalThis.window?.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = globalThis.window?.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

function useDialogFocus(open, dialogRef, onClose, restoreSelector) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = () => [...(dialog?.querySelectorAll(FOCUSABLE) ?? [])];
    (dialog?.querySelector("[data-autofocus]") ?? focusables()[0])?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const fallback = restoreSelector ? document.querySelector(restoreSelector) : null;
      const target = previous && previous !== document.body ? previous : fallback;
      window.setTimeout(() => target?.focus(), 0);
    };
  }, [dialogRef, onClose, open, restoreSelector]);
}

function FilterPanel({ items, filters, onChange, onReset, compact = false }) {
  const presentCategories = new Set(items.map((item) => item.category));
  const categories = CATEGORY_ORDER.filter((category) => presentCategories.has(category));
  const hasFilters = filters.categories.length;
  const toggleCategory = (category) => {
    const categories = filters.categories.includes(category)
      ? filters.categories.filter((value) => value !== category)
      : [...filters.categories, category];
    onChange({ ...filters, categories });
  };

  return (
    <div className={`filter-panel ${compact ? "filter-panel--compact" : ""}`}>
      <section className="filter-section">
        <div className="filter-heading">
          <span>FOCUS</span>
          {hasFilters ? <button className="text-button" type="button" onClick={onReset}>CLEAR</button> : null}
        </div>
        <button
          className={`filter-option filter-option--all ${!filters.categories.length ? "is-active" : ""}`}
          type="button"
          onClick={() => onChange({ ...filters, categories: [] })}
          aria-pressed={!filters.categories.length}
        >
          <span>All signals</span><span>{items.length}</span>
        </button>
        {categories.map((category) => (
          <button
            className={`filter-option ${filters.categories.includes(category) ? "is-active" : ""}`}
            type="button"
            key={category}
            onClick={() => toggleCategory(category)}
            aria-pressed={filters.categories.includes(category)}
          >
            <span>{category}</span><span>{countBy(items, (item) => item.category === category)}</span>
          </button>
        ))}
      </section>

    </div>
  );
}

function VoteControls({ itemId, record, onVote }) {
  return (
    <div className="vote-controls" aria-label="Signal usefulness votes">
      <button
        className={record.myVote === "up" ? "is-voted" : ""}
        type="button"
        onClick={() => onVote(itemId, "up")}
        aria-label={`Useful, ${record.up} votes`}
        aria-pressed={record.myVote === "up"}
      >
        <ThumbsUp size={15} weight={record.myVote === "up" ? "fill" : "regular"} /><span>{record.up}</span>
      </button>
      <button
        className={record.myVote === "down" ? "is-voted is-voted--down" : ""}
        type="button"
        onClick={() => onVote(itemId, "down")}
        aria-label={`Not useful, ${record.down} votes`}
        aria-pressed={record.myVote === "down"}
      >
        <ThumbsDown size={15} weight={record.myVote === "down" ? "fill" : "regular"} /><span>{record.down}</span>
      </button>
    </div>
  );
}

function SignalRow({ item, selected, record, onVote }) {
  const accent = CATEGORY_ACCENTS[item.category] ?? "lime";
  return (
    <article className={`signal-row ${selected ? "is-selected" : ""}`} role="listitem">
      <span className="signal-rank">{String(item.rank).padStart(2, "0")}</span>
      <div className="signal-copy">
        <a
          className="signal-title"
          href={item.source.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Read source: ${item.title}`}
          aria-current={selected ? "true" : undefined}
          data-signal-id={item.id}
        >{item.title}</a>
        <span className="signal-summary">{item.summary}</span>
        <a
          className="signal-source-inline"
          href={item.source.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Verified source: ${item.source.publisher}, checked ${item.source.verification.verifiedAt}`}
        >
          <CheckCircle size={13} weight="bold" />
          <span>{item.source.publisher}</span>
          <span>· VERIFIED {formatVerifiedDate(item.source.verification.verifiedAt)}</span>
          <ArrowSquareOut size={13} />
        </a>
      </div>
      <span className={`signal-category accent-${accent}`}>{shortCategory(item.category)}</span>
      <VoteControls itemId={item.id} record={record} onVote={onVote} />
    </article>
  );
}

function EmptyState({ date, filtered, status = "idle", onReset, onReturn }) {
  if (status === "loading") {
    return <div className="state-panel" aria-live="polite"><ArrowClockwise size={28} className="spin" /><h2>LOADING EDITION</h2><p>Fetching the published briefing for {formatDate(date)}.</p></div>;
  }
  if (status === "error") {
    return <div className="state-panel" role="alert"><WarningCircle size={28} /><h2>EDITION UNAVAILABLE</h2><p>The published briefing could not be loaded.</p><button type="button" className="outlined-button" onClick={onReturn}>RETURN TO LATEST</button></div>;
  }
  return (
    <div className="state-panel">
      <MagnifyingGlass size={28} />
      <h2>{filtered ? "NO SIGNALS MATCH" : "NO EDITION FOR THIS DATE"}</h2>
      <p>{filtered ? "Clear the filters or broaden your search." : `today i found has no published briefing for ${formatDate(date)}.`}</p>
      <button type="button" className="outlined-button" onClick={filtered ? onReset : onReturn}>{filtered ? "CLEAR FILTERS" : "RETURN TO LATEST"}</button>
    </div>
  );
}

export function AppFooter({ signalCount, curatedAt, timeZone, feedbackSource, isPhone, onSearch, onFilter, onHelp }) {
  return (
    <footer className="app-footer">
      <div className="footer-status">
        <span>{signalCount} SIGNALS</span><span>·</span>
        <span>UPDATED {formatCuratedTime(curatedAt, timeZone)}</span>
        {feedbackSource === "fallback" ? <span className="local-badge">FEEDBACK LOCAL</span> : null}
      </div>
      <div className="shortcut-list">
        {!isPhone ? <span className="navigate-hint"><kbd>j</kbd><kbd>k</kbd> Navigate</span> : null}
        <button type="button" onClick={onSearch}><kbd>/</kbd> Search</button>
        <button type="button" onClick={onFilter}><kbd>f</kbd> Filter</button>
        <button type="button" onClick={onHelp}><kbd>?</kbd> Help</button>
      </div>
    </footer>
  );
}

function SignalExperience({ edition, manifest, loadEdition, feedbackService: providedFeedbackService }) {
  const latestDate = manifest?.latestEdition ?? edition.date;
  const publishedDates = useMemo(() => new Set(manifest?.editions ?? [edition.date]), [edition.date, manifest]);
  const [loadedEditions, setLoadedEditions] = useState(() => ({ [edition.date]: edition }));
  const [currentDate, setCurrentDate] = useState(latestDate);
  const [archiveStatus, setArchiveStatus] = useState("idle");
  const activeEdition = loadedEditions[currentDate] ?? null;
  const items = useMemo(() => rankItems(activeEdition?.items ?? []), [activeEdition]);
  const initial = useMemo(() => createInitialState(items), [items]);
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(initial.filters);
  const [records, setRecords] = useState(() => seedVoteRecords(items));
  const [feedbackSource, setFeedbackSource] = useState("loading");
  const searchRef = useRef(null);
  const filterDialogRef = useRef(null);
  const helpDialogRef = useRef(null);
  const mutationVersions = useRef({});
  const feedbackStatusVersion = useRef(0);
  const isPhone = useMediaQuery("(max-width: 720px)");
  const feedbackService = useMemo(() => providedFeedbackService ?? createFeedbackService(), [providedFeedbackService]);
  const isPublishedDate = activeEdition?.date === currentDate;
  const visibleItems = useMemo(
    () => isPublishedDate ? filterSignals(items, { ...filters, query }) : [],
    [filters, isPublishedDate, items, query],
  );
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const modalOpen = filtersOpen || helpOpen;

  useDialogFocus(filtersOpen, filterDialogRef, closeFilters);
  useDialogFocus(helpOpen, helpDialogRef, closeHelp);

  useEffect(() => {
    if (loadedEditions[currentDate] || !publishedDates.has(currentDate) || !loadEdition) {
      setArchiveStatus("idle");
      return undefined;
    }
    let active = true;
    setArchiveStatus("loading");
    Promise.resolve(loadEdition(currentDate)).then((loaded) => {
      if (!active) return;
      setLoadedEditions((current) => ({ ...current, [currentDate]: loaded }));
      setArchiveStatus("idle");
    }).catch(() => {
      if (active) setArchiveStatus("error");
    });
    return () => { active = false; };
  }, [currentDate, loadEdition, loadedEditions, publishedDates]);

  useEffect(() => {
    if (visibleItems.length && !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(visibleItems[0].id);
    }
  }, [selectedId, visibleItems]);

  useEffect(() => {
    if (!activeEdition) return undefined;
    let active = true;
    const versionsAtStart = { ...mutationVersions.current };
    const statusVersionAtStart = feedbackStatusVersion.current;
    feedbackService.getVotes(activeEdition.date, items).then((result) => {
      if (!active) return;
      setRecords((current) => reconcileLoadedRecords(current, result.records, versionsAtStart, mutationVersions.current));
      setFeedbackSource((current) => reconcileFeedbackSource(current, result.source, statusVersionAtStart, feedbackStatusVersion.current));
    });
    return () => { active = false; };
  }, [activeEdition, feedbackService, items]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  const selectItem = useCallback((id) => {
    setSelectedId(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (modalOpen) return;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (event.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        return;
      }
      if (typing) return;
      if (event.key === "/") { event.preventDefault(); setSearchOpen(true); return; }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); setSearchOpen(false); setFiltersOpen(true); return; }
      if (event.key === "?") { event.preventDefault(); setSearchOpen(false); setHelpOpen(true); return; }
      if (["ArrowDown", "ArrowUp", "j", "k", "J", "K"].includes(event.key)) {
        event.preventDefault();
        const nextId = getNextSelection(visibleItems.map((item) => item.id), selectedId, event.key);
        if (nextId) {
          selectItem(nextId);
          requestAnimationFrame(() => document.querySelector(`[data-signal-id="${nextId}"]`)?.focus());
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, searchOpen, selectItem, selectedId, visibleItems]);

  const resetFilters = () => { setFilters(initial.filters); setQuery(""); };
  const openFilters = () => { setSearchOpen(false); setHelpOpen(false); setFiltersOpen(true); };
  const openHelp = () => { setSearchOpen(false); setFiltersOpen(false); setHelpOpen(true); };

  const handleVote = (itemId, requestedVote) => {
    const current = records[itemId] ?? { up: 0, down: 0, myVote: null };
    const transition = applyVote({ up: current.up, down: current.down }, current.myVote, requestedVote);
    const optimistic = { ...current, ...transition.counts, myVote: transition.vote };
    const version = (mutationVersions.current[itemId] ?? 0) + 1;
    const statusVersion = feedbackStatusVersion.current + 1;
    mutationVersions.current[itemId] = version;
    feedbackStatusVersion.current = statusVersion;
    setRecords((value) => ({ ...value, [itemId]: optimistic }));
    Promise.resolve(feedbackService.setVote(itemId, transition.vote, optimistic)).then((result) => {
      setFeedbackSource((current) => reconcileFeedbackSource(current, result.source, statusVersion, feedbackStatusVersion.current));
      setRecords((value) => ({
        ...value,
        [itemId]: reconcileMutationRecord(value[itemId], result.record, version, mutationVersions.current[itemId]),
      }));
    }).catch(() => {
      setFeedbackSource((current) => reconcileFeedbackSource(current, "fallback", statusVersion, feedbackStatusVersion.current));
    });
  };

  return (
    <main className="app-shell">
      <div className="app-underlay" inert={modalOpen}>
        <header className="app-header">
          <div className="brand-block"><h1>today i found</h1></div>
          <nav className="date-navigation" aria-label="Edition date">
            <button type="button" className="icon-button date-button" onClick={() => setCurrentDate((date) => shiftDate(date, -1))} aria-label="Previous date"><CaretLeft size={20} weight="bold" /></button>
            <div><CalendarBlank size={17} /><time dateTime={currentDate}>{formatDate(currentDate)}</time></div>
            <button type="button" className="icon-button date-button" onClick={() => setCurrentDate((date) => shiftDate(date, 1))} aria-label="Next date"><CaretRight size={20} weight="bold" /></button>
          </nav>
          <div className="header-actions">
            <button className="header-action" type="button" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={17} /> SEARCH</button>
            <button className="header-action filter-trigger" type="button" onClick={openFilters}><Funnel size={17} /> FILTER</button>
          </div>
        </header>

        <div className="workspace">
          <aside className="filter-rail" aria-label="Signal filters">
            <FilterPanel items={items} filters={filters} onChange={setFilters} onReset={resetFilters} />
            <div className="rail-about">
              <span>ABOUT</span>
              <a href="#help" onClick={(event) => { event.preventDefault(); openHelp(); }}>How it works <ArrowSquareOut size={14} /></a>
            </div>
          </aside>
          <section className="signal-table" aria-label="Ranked signals">
            <div className="table-header" aria-hidden="true"><span>#</span><span>SIGNAL</span><span>CATEGORY</span><span>VOTES</span></div>
            <div className="signal-list" role="list" aria-label="Signals">
              {visibleItems.map((item) => (
                <SignalRow
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  record={records[item.id] ?? { up: 0, down: 0, myVote: null }}
                  onVote={handleVote}
                />
              ))}
              {!visibleItems.length ? <EmptyState date={currentDate} filtered={isPublishedDate} status={archiveStatus} onReset={resetFilters} onReturn={() => setCurrentDate(latestDate)} /> : null}
            </div>
          </section>
        </div>

        <AppFooter
          signalCount={visibleItems.length}
          curatedAt={activeEdition?.curatedAt ?? edition.curatedAt}
          timeZone={activeEdition?.timezone ?? edition.timezone}
          feedbackSource={feedbackSource}
          isPhone={isPhone}
          onSearch={() => setSearchOpen(true)}
          onFilter={openFilters}
          onHelp={openHelp}
        />

        {searchOpen ? (
          <div className="search-popover">
            <MagnifyingGlass size={18} /><label htmlFor="signal-search" className="sr-only">Search signals</label>
            <input id="signal-search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, summaries, categories, sources…" autoComplete="off" />
            <button className="icon-button" type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={18} /></button>
          </div>
        ) : null}
      </div>

      {filtersOpen ? (
        <div className="modal-scrim" onMouseDown={closeFilters}>
          <aside className="filter-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="filter-dialog-title" ref={filterDialogRef}>
            <div className="drawer-header"><span id="filter-dialog-title"><SlidersHorizontal size={18} /> FILTER SIGNALS</span><button className="icon-button" type="button" onClick={closeFilters} aria-label="Close filters" data-autofocus="true"><X size={19} /></button></div>
            <FilterPanel items={items} filters={filters} onChange={setFilters} onReset={resetFilters} compact />
            <button className="drawer-apply" type="button" onClick={closeFilters}>SHOW {visibleItems.length} SIGNALS</button>
          </aside>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="modal-scrim" onMouseDown={closeHelp}>
          <section className="help-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="help-title" ref={helpDialogRef}>
            <div className="drawer-header"><span id="help-title"><Question size={19} /> KEYBOARD CONTROLS</span><button className="icon-button" type="button" onClick={closeHelp} aria-label="Close help" data-autofocus="true"><X size={19} /></button></div>
            <dl>
              <div><dt><kbd>j</kbd> <kbd>↓</kbd></dt><dd>Next signal</dd></div><div><dt><kbd>k</kbd> <kbd>↑</kbd></dt><dd>Previous signal</dd></div>
              <div><dt><kbd>/</kbd></dt><dd>Search</dd></div><div><dt><kbd>f</kbd></dt><dd>Open filters</dd></div>
              <div><dt><kbd>esc</kbd></dt><dd>Close the active panel</dd></div><div><dt><kbd>?</kbd></dt><dd>Show this help</dd></div>
            </dl>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export function App({ edition, manifest, loadEdition, feedbackService }) {
  if (edition === null) {
    return <main className="status-screen" aria-live="polite"><ArrowClockwise size={28} className="spin" /><span>LOADING TODAY&apos;S SIGNALS</span></main>;
  }
  if (edition instanceof Error) {
    return <main className="status-screen status-screen--error" role="alert"><WarningCircle size={30} /><span>THE BRIEFING COULD NOT BE LOADED</span><button type="button" className="outlined-button" onClick={() => globalThis.location?.reload()}>RETRY</button></main>;
  }
  return <SignalExperience edition={edition} manifest={manifest} loadEdition={loadEdition} feedbackService={feedbackService} />;
}
