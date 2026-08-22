import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  FileText,
  Funnel,
  MagnifyingGlass,
  Question,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { applyVote, createInitialState, filterSignals, getNextSelection, getReportSelection } from "./app-state.js";
import {
  createFeedbackService,
  reconcileFeedbackSource,
  reconcileLoadedRecords,
  reconcileMutationRecord,
  seedVoteRecords,
} from "./feedback-service.js";
import { CATEGORY_PRESENTATION, PRIMARY_CATEGORIES } from "../shared/editorial-contract.js";
import { prepareVisitorTransfer } from "./visitor-transfer.js";

const LEGACY_CATEGORY_PRESENTATION = {
  Models: { short: "MODEL", accent: "lime" },
  Tools: { short: "TOOL", accent: "cyan" },
  Workflows: { short: "WORKFLOW", accent: "lime" },
  Demos: { short: "DEMO", accent: "orange" },
  Utilities: { short: "UTILITY", accent: "violet" },
};
const CATEGORY_ORDER = [...PRIMARY_CATEGORIES, ...Object.keys(LEGACY_CATEGORY_PRESENTATION)];
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NOOP = () => {};

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
  return CATEGORY_PRESENTATION[category]?.short ?? LEGACY_CATEGORY_PRESENTATION[category]?.short ?? category.toUpperCase();
}

export function displayTag(tag = "") {
  const value = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  return value.replaceAll("-", " ").toUpperCase();
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
  const accent = CATEGORY_PRESENTATION[item.category]?.accent ?? LEGACY_CATEGORY_PRESENTATION[item.category]?.accent ?? "lime";
  const tags = (item.tags ?? []).map(displayTag).filter((tag, index, values) => tag && values.indexOf(tag) === index).slice(0, 4);
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
        {tags.length ? <span className="signal-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</span> : null}
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

function EditionTransparency({ stats }) {
  if (!stats || !Number.isInteger(stats.rawCandidates)) return null;
  return (
    <div className="edition-transparency" aria-label="Edition discovery summary">
      <span>{stats.publishedItems} selected from {stats.rawCandidates} candidates</span>
      <span>{stats.trendingReviewed} GitHub Trending reviewed</span>
      <span>{stats.explorationItems} exploration picks</span>
    </div>
  );
}

const REPORT_PHASE_LABELS = {
  resuming: "RESUMING REPORT",
  queued: "QUEUED",
  "source-retrieval": "RETRIEVING SOURCES",
  "batch-summarization": "SUMMARIZING STORIES",
  editing: "EDITING NARRATION",
  validation: "VALIDATING REPORT",
  saving: "SAVING REPORT",
  committing: "SAVING REPORT",
  completed: "REPORT READY",
  failed: "REPORT FAILED",
  cancelled: "REPORT CANCELLED",
};

export const DEFAULT_REPORT_APP_ORIGIN = "https://today-i-found.pages.dev";
const LOCAL_REPORT_APP_ORIGINS = new Set([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

export function isReportCapableOrigin(origin, reportAppOrigin = DEFAULT_REPORT_APP_ORIGIN) {
  return origin === reportAppOrigin || LOCAL_REPORT_APP_ORIGINS.has(origin);
}

function reportErrorMode(error, fallback = "connection") {
  if (error?.code === "auth") return "auth";
  if (error?.code === "offline") return "offline";
  if (error?.code === "busy") return "busy";
  return fallback;
}

export function saveBrowserDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ReportGenerator({
  edition,
  records,
  service,
  pollInterval = 750,
  saveDownload = saveBrowserDownload,
  onActiveChange = NOOP,
  votesReady = true,
  pageOrigin = globalThis.location?.origin ?? globalThis.window?.location?.origin,
  reportAppOrigin = DEFAULT_REPORT_APP_ORIGIN,
  visitorId,
}) {
  const originAvailable = isReportCapableOrigin(pageOrigin, reportAppOrigin);
  const selection = useMemo(() => getReportSelection(edition.items, records), [edition.items, records]);
  const [mode, setMode] = useState(originAvailable ? "checking" : "origin");
  const [healthBusy, setHealthBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingError, setPairingError] = useState("");
  const [job, setJob] = useState(null);
  const [downloadError, setDownloadError] = useState("");
  const [continuityWarning, setContinuityWarning] = useState("");
  const requestVersion = useRef(0);
  const jobRef = useRef(null);
  jobRef.current = job;

  const acceptJobStatus = useCallback((next) => {
    setJob(next);
    jobRef.current = next;
    if (next.status === "completed") {
      try {
        service.setOwnedJob?.({ jobId: next.jobId, editionDate: edition.date, status: "completed" });
      } catch {
        setContinuityWarning("REPORT CONTINUITY LIMITED");
      }
      setMode("completed");
    } else if (next.status === "failed" || next.status === "cancelled") {
      service.clearOwnedJob?.(next.jobId);
      setMode(next.status);
    } else {
      setMode(next.status === "committing" ? "committing" : "running");
    }
  }, [edition.date, service]);

  const checkHealth = useCallback(async () => {
    if (!originAvailable) {
      setMode("origin");
      return;
    }
    const version = ++requestVersion.current;
    setMode("checking");
    setPairingError("");
    try {
      const health = await service.health();
      if (version !== requestVersion.current) return;
      setHealthBusy(Boolean(health.busy));
      if (!health.paired) setMode("unpaired");
      else if (!service.hasToken()) setMode("locked");
      else if (jobRef.current?.jobId && jobRef.current.status === "running") setMode("running");
      else if (health.busy) setMode("busy");
      else setMode("ready");
    } catch {
      if (version === requestVersion.current) setMode("offline");
    }
  }, [originAvailable, service]);

  const recoverMissingJob = useCallback((jobId) => {
    service.clearOwnedJob?.(jobId);
    jobRef.current = null;
    setJob(null);
    checkHealth();
  }, [checkHealth, service]);

  useEffect(() => {
    if (!originAvailable) {
      setMode("origin");
      return () => { requestVersion.current += 1; };
    }
    const owned = service.getOwnedJob?.();
    if (owned?.editionDate === edition.date) {
      requestVersion.current += 1;
      const resumed = { jobId: owned.jobId, status: "running", progress: { phase: "resuming", completed: 0, total: 1 } };
      jobRef.current = resumed;
      setJob(resumed);
      setMode("running");
    } else {
      checkHealth();
    }
    return () => { requestVersion.current += 1; };
  }, [checkHealth, edition.date, originAvailable, service]);

  useEffect(() => {
    const terminal = ["completed", "failed", "cancelled"].includes(mode);
    const activeMode = ["running", "cancelling", "committing"].includes(mode);
    const activeJob = !terminal && job?.jobId && ["running", "committing"].includes(job.status);
    onActiveChange(Boolean(activeMode || activeJob));
    return () => onActiveChange(false);
  }, [job, mode, onActiveChange]);

  useEffect(() => {
    if (!["running", "committing"].includes(mode) || !job?.jobId) return undefined;
    const version = requestVersion.current;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await service.getReport(job.jobId);
        if (!active || version !== requestVersion.current) return;
        acceptJobStatus(next);
      } catch (error) {
        if (!active || version !== requestVersion.current) return;
        if (error?.status === 404) {
          recoverMissingJob(job.jobId);
        } else {
          setMode(reportErrorMode(error));
        }
      }
    }, pollInterval);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [acceptJobStatus, job, mode, pollInterval, recoverMissingJob, service]);

  const pair = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(pairingCode)) {
      setPairingError("Enter the six-digit code shown by the companion.");
      return;
    }
    const version = ++requestVersion.current;
    setMode("pairing");
    setPairingError("");
    try {
      await service.pair(pairingCode);
      if (version !== requestVersion.current) return;
      setPairingCode("");
      setHealthBusy(false);
      setMode("ready");
    } catch (error) {
      if (version === requestVersion.current && error?.code === "offline") {
        setMode("offline");
      } else if (version === requestVersion.current) {
        setPairingError("The pairing code was not accepted.");
        setMode("unpaired");
      }
    }
  };

  const start = async () => {
    if (!votesReady || !selection.itemIds.length || healthBusy) return;
    const version = ++requestVersion.current;
    setDownloadError("");
    setContinuityWarning("");
    setJob({ status: "running", progress: { phase: "queued", completed: 0, total: 1 } });
    setMode("running");
    try {
      const started = await service.startReport({ date: edition.date, itemIds: selection.itemIds });
      if (version === requestVersion.current) {
        jobRef.current = started;
        setJob(started);
      }
      try {
        service.setOwnedJob?.({ jobId: started.jobId, editionDate: edition.date, status: "active" });
      } catch {
        if (version === requestVersion.current) setContinuityWarning("REPORT CONTINUITY LIMITED");
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setJob(null);
      setMode(reportErrorMode(error, "failed"));
    }
  };

  const cancel = async () => {
    if (!job?.jobId) return;
    const version = ++requestVersion.current;
    const jobId = job.jobId;
    setMode("cancelling");
    try {
      const result = await service.cancel(jobId);
      if (version !== requestVersion.current) return;
      if (result?.cancelled === true) {
        service.clearOwnedJob?.(jobId);
        const cancelled = { ...job, status: "cancelled", progress: { ...(job.progress ?? {}), phase: "cancelled" } };
        jobRef.current = cancelled;
        setJob(cancelled);
        setMode("cancelled");
      } else {
        const next = await service.getReport(jobId);
        if (version === requestVersion.current) acceptJobStatus(next);
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      if (error?.status === 404) {
        recoverMissingJob(jobId);
      } else {
        setMode(reportErrorMode(error));
      }
    }
  };

  const retryStatus = async () => {
    if (!job?.jobId) return;
    const version = ++requestVersion.current;
    setMode("retrying");
    try {
      const next = await service.getReport(job.jobId);
      if (version === requestVersion.current) acceptJobStatus(next);
    } catch (error) {
      if (version !== requestVersion.current) return;
      if (error?.status === 404) {
        recoverMissingJob(job.jobId);
      } else {
        setMode(reportErrorMode(error));
      }
    }
  };

  const download = async (kind) => {
    if (!job?.jobId) return;
    setDownloadError("");
    try {
      saveDownload(await service.download(job.jobId, kind));
    } catch (error) {
      setDownloadError(error?.code === "auth" ? "Pair this browser again to download the report." : "The report download failed.");
    }
  };

  const countCopy = votesReady ? `${selection.liked} liked · ${selection.unvoted} unvoted · ${selection.excluded} downvoted excluded` : "CHECKING YOUR VOTES";
  const phase = REPORT_PHASE_LABELS[job?.progress?.phase] ?? String(job?.progress?.phase ?? "WORKING").replaceAll("-", " ").toUpperCase();
  const progressValue = job?.progress?.total ? Math.round((job.progress.completed / job.progress.total) * 100) : 0;

  return (
    <section className="report-generator" aria-labelledby={`report-title-${edition.date}`}>
      <div className="report-heading">
        <div><FileText size={18} /><div><h2 id={`report-title-${edition.date}`}>GENERATE REPORT</h2><p>{countCopy}</p></div></div>
        <span>PRIVATE · PAIRED MAC</span>
      </div>
      <div className="report-status" aria-live="polite">
        {mode === "checking" ? <p>CHECKING REPORT COMPANION</p> : null}
        {mode === "origin" ? <><strong>REPORTS USE THE PRIVATE-CAPABLE SITE</strong><p>The GitHub Pages mirror is read-only for local report access.</p><a className="report-primary report-origin-link" href={`${reportAppOrigin}/`} onClick={() => prepareVisitorTransfer(globalThis.window, visitorId, reportAppOrigin)}>Open report-capable site</a></> : null}
        {mode === "offline" ? <><strong>REPORT COMPANION OFFLINE</strong><p>Report generation is only available on Patrick&apos;s paired Mac.</p><button type="button" className="report-secondary" onClick={checkHealth}>Retry companion</button></> : null}
        {mode === "locked" ? <><strong>PAIRED MAC REQUIRED</strong><p>This local report runner is paired with another browser.</p><button type="button" className="report-secondary" onClick={checkHealth}>Retry companion</button></> : null}
        {mode === "auth" ? <><strong>PAIRING REQUIRED</strong><p>This browser&apos;s pairing has expired. Reset the local companion before pairing again.</p><button type="button" className="report-secondary" onClick={checkHealth}>Check companion</button></> : null}
        {mode === "unpaired" || mode === "pairing" ? (
          <form className="report-pairing" onSubmit={pair}>
            <label htmlFor={`pairing-code-${edition.date}`}>Pairing code</label>
            <div><input id={`pairing-code-${edition.date}`} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={mode === "pairing"} /><button type="submit" disabled={mode === "pairing"}>{mode === "pairing" ? "PAIRING…" : "Pair this browser"}</button></div>
            {pairingError ? <p role="alert">{pairingError}</p> : <p>Enter the one-time code shown when the local companion starts.</p>}
          </form>
        ) : null}
        {mode === "ready" ? <button type="button" className="report-primary" onClick={start} disabled={!votesReady || !selection.itemIds.length || healthBusy}>Generate report</button> : null}
        {mode === "busy" ? <><strong>REPORT RUNNER BUSY</strong><p>One report is already running on this Mac.</p><button type="button" className="report-secondary" onClick={checkHealth}>Check again</button></> : null}
        {mode === "connection" ? <><strong>REPORT STATUS UNAVAILABLE</strong><p>The report may still be running. Its ownership is preserved until the companion confirms a final state.</p><button type="button" className="report-secondary" onClick={retryStatus}>Retry report status</button></> : null}
        {mode === "retrying" ? <><strong>CHECKING REPORT STATUS</strong><p>The report remains attached while the companion confirms its current state.</p></> : null}
        {mode === "running" || mode === "cancelling" || mode === "committing" ? <div className="report-progress"><strong id={`report-progress-${edition.date}`}>{mode === "cancelling" ? "CANCELLING REPORT" : phase}</strong><progress max="100" value={progressValue} aria-labelledby={`report-progress-${edition.date}`}>{progressValue}%</progress><span>{job?.progress?.completed ?? 0} / {job?.progress?.total ?? 1}</span>{mode !== "committing" ? <button type="button" className="report-secondary" onClick={cancel} disabled={mode === "cancelling" || !job?.jobId}>Cancel report</button> : null}</div> : null}
        {mode === "cancelled" ? <><strong>REPORT CANCELLED</strong><button type="button" className="report-secondary" onClick={() => setMode("ready")}>Start again</button></> : null}
        {mode === "failed" ? <><strong>REPORT FAILED</strong><p>{job?.error || "The local report runner could not complete this report."}</p><button type="button" className="report-secondary" onClick={() => setMode("ready")}>Try again</button></> : null}
        {mode === "completed" ? <div className="report-complete"><strong>REPORT READY</strong><p>Saved locally. Download either version here.</p><div><button type="button" onClick={() => download("markdown")}><DownloadSimple size={15} />Download Markdown</button><button type="button" onClick={() => download("json")}><DownloadSimple size={15} />Download JSON</button></div>{downloadError ? <p role="alert">{downloadError}</p> : null}</div> : null}
        {continuityWarning ? <p role="alert" className="report-continuity-warning"><strong>{continuityWarning}</strong> Recovery data could not be saved. Keep this tab open to retain access to this report.</p> : null}
      </div>
    </section>
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
  const feedbackLabel = {
    synced: "FEEDBACK SYNCED",
    syncing: "FEEDBACK SYNCING",
    local: "FEEDBACK LOCAL",
    persistence: "FEEDBACK LOCAL · STORAGE UNAVAILABLE",
  }[feedbackSource];
  return (
    <footer className="app-footer">
      <div className="footer-status">
        <span>{signalCount} SIGNALS</span><span>·</span>
        <span>UPDATED {formatCuratedTime(curatedAt, timeZone)}</span>
        {feedbackLabel ? <span className="local-badge">{feedbackLabel}</span> : null}
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

function SignalExperience({ edition, manifest, loadEdition, feedbackService: providedFeedbackService, reportService, reportPollInterval, saveReportDownload, reportOrigin, reportAppOrigin }) {
  const latestDate = manifest?.latestEdition ?? edition.date;
  const publishedDates = useMemo(() => new Set(manifest?.editions ?? [edition.date]), [edition.date, manifest]);
  const ownedReportAtBoot = useMemo(() => reportService?.getOwnedJob?.() ?? null, [reportService]);
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
  const [feedbackEditionDate, setFeedbackEditionDate] = useState(null);
  const [reportActive, setReportActive] = useState(false);
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
    if (ownedReportAtBoot && !publishedDates.has(ownedReportAtBoot.editionDate)) {
      reportService?.clearOwnedJob?.(ownedReportAtBoot.jobId);
    }
  }, [ownedReportAtBoot, publishedDates, reportService]);

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
    setFeedbackEditionDate(null);
    setFeedbackSource("loading");
    setRecords(seedVoteRecords(items));
    const versionsAtStart = { ...mutationVersions.current };
    const statusVersionAtStart = feedbackStatusVersion.current;
    feedbackService.getVotes(activeEdition.date, items).then((result) => {
      if (!active) return;
      setRecords((current) => reconcileLoadedRecords(current, result.records, versionsAtStart, mutationVersions.current));
      const source = result.persistence === "failed" ? "persistence" : result.source;
      setFeedbackSource((current) => reconcileFeedbackSource(current, source, statusVersionAtStart, feedbackStatusVersion.current));
      setFeedbackEditionDate(activeEdition.date);
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
    let mutation;
    try {
      mutation = feedbackService.setVote(itemId, transition.vote, optimistic);
    } catch {
      setFeedbackSource("local");
      return;
    }
    setFeedbackSource(mutation?.initialPersistence === "failed" ? "persistence" : mutation?.initialSource ?? "syncing");
    Promise.resolve(mutation).then((result) => {
      const source = result.persistence === "failed" ? "persistence" : result.source;
      setFeedbackSource((current) => reconcileFeedbackSource(current, source, statusVersion, feedbackStatusVersion.current));
      setRecords((value) => ({
        ...value,
        [itemId]: reconcileMutationRecord(value[itemId], result.record, version, mutationVersions.current[itemId]),
      }));
    }).catch(() => {
      setFeedbackSource((current) => reconcileFeedbackSource(current, "local", statusVersion, feedbackStatusVersion.current));
    });
  };

  return (
    <main className="app-shell">
      <div className="app-underlay" inert={modalOpen}>
        <header className="app-header">
          <div className="brand-block"><h1>today i found</h1></div>
          <nav className="date-navigation" aria-label="Edition date">
            <button type="button" className="icon-button date-button" onClick={() => setCurrentDate((date) => shiftDate(date, -1))} aria-label="Previous date" disabled={reportActive} title={reportActive ? "Finish or cancel the active report before changing editions" : undefined}><CaretLeft size={20} weight="bold" /></button>
            <div><CalendarBlank size={17} /><time dateTime={currentDate}>{formatDate(currentDate)}</time></div>
            <button type="button" className="icon-button date-button" onClick={() => setCurrentDate((date) => shiftDate(date, 1))} aria-label="Next date" disabled={reportActive} title={reportActive ? "Finish or cancel the active report before changing editions" : undefined}><CaretRight size={20} weight="bold" /></button>
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
            <EditionTransparency stats={activeEdition?.discoveryStats} />
            <div className="signal-scroll">
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
              {reportService && activeEdition?.items?.length ? <ReportGenerator key={activeEdition.date} edition={activeEdition} records={records} service={reportService} pollInterval={reportPollInterval} saveDownload={saveReportDownload} onActiveChange={setReportActive} votesReady={feedbackEditionDate === activeEdition.date} pageOrigin={reportOrigin} reportAppOrigin={reportAppOrigin} visitorId={feedbackService.visitorId} /> : null}
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

export function App({ edition, manifest, loadEdition, feedbackService, reportService, reportPollInterval, saveReportDownload, reportOrigin = globalThis.location?.origin ?? globalThis.window?.location?.origin, reportAppOrigin = DEFAULT_REPORT_APP_ORIGIN }) {
  if (edition === null) {
    return <main className="status-screen" aria-live="polite"><ArrowClockwise size={28} className="spin" /><span>LOADING TODAY&apos;S SIGNALS</span></main>;
  }
  if (edition instanceof Error) {
    return <main className="status-screen status-screen--error" role="alert"><WarningCircle size={30} /><span>THE BRIEFING COULD NOT BE LOADED</span><button type="button" className="outlined-button" onClick={() => globalThis.location?.reload()}>RETRY</button></main>;
  }
  return <SignalExperience edition={edition} manifest={manifest} loadEdition={loadEdition} feedbackService={feedbackService} reportService={reportService} reportPollInterval={reportPollInterval} saveReportDownload={saveReportDownload} reportOrigin={reportOrigin} reportAppOrigin={reportAppOrigin} />;
}
