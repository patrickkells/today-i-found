import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://today-i-found.pages.dev/",
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;

let phoneViewport = false;
window.matchMedia = () => ({
  matches: phoneViewport,
  addEventListener() {},
  removeEventListener() {},
});

const React = await import("react");
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, AppFooter, saveBrowserDownload } = await import("../src/App.jsx");
const edition = (await import("./fixtures/edition.json", { with: { type: "json" } })).default;
const broadEdition = (await import("./fixtures/edition-v3.json", { with: { type: "json" } })).default;
const { seedVoteRecords } = await import("../src/feedback-service.js");

function canonicalService(overrides = {}) {
  const records = seedVoteRecords(edition.items);
  return {
    getVotes() { return new Promise(() => {}); },
    async setVote(itemId, value, fallbackRecord) {
      return { record: { ...fallbackRecord, myVote: value }, source: "local" };
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function reportService(overrides = {}) {
  let ownedJob = null;
  return {
    hasToken() { return true; },
    async health() { return { status: "ok", version: "1", paired: true, busy: false }; },
    async pair() { return { paired: true }; },
    async startReport() { return { jobId: "job-1", status: "running", progress: { phase: "queued", completed: 0, total: 1 } }; },
    async getReport() { return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: { markdown: "/markdown", json: "/json" } }; },
    async cancel() { return { cancelled: true }; },
    async download() { return { blob: new Blob(["report"]), filename: "report.md" }; },
    getOwnedJob() { return ownedJob; },
    setOwnedJob(value) { ownedJob = value; },
    clearOwnedJob(jobId) {
      if (ownedJob?.jobId !== jobId) return false;
      ownedJob = null;
      return true;
    },
    ...overrides,
  };
}

function loadedFeedback(records = seedVoteRecords(edition.items)) {
  return canonicalService({ async getVotes() { return { records, source: "local" }; } });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  phoneViewport = false;
});

test("renders the low-key product name without a subtitle", () => {
  render(<App edition={edition} feedbackService={canonicalService()} />);

  assert.ok(screen.getByRole("heading", { level: 1, name: "today i found" }));
  assert.equal(screen.queryByText(/daily ai builder briefing/i), null);
});

test("renders valid interactive row semantics and actual edition update metadata", async () => {
  const fixture = structuredClone(edition);
  fixture.curatedAt = "2026-08-19T09:17:00-04:00";
  render(<App edition={fixture} feedbackService={canonicalService()} />);

  assert.equal(screen.queryAllByRole("option").length, 0);
  const signalList = screen.getByRole("list", { name: "Signals" });
  assert.equal(within(signalList).getAllByRole("listitem").length, 12);
  const firstRow = within(signalList).getAllByRole("listitem")[0];
  const headline = within(firstRow).getByRole("link", { name: /Read source:/i });
  const source = within(firstRow).getByRole("link", { name: /Verified source: OpenAI, checked 2026-08-19/i });
  assert.equal(headline.getAttribute("href"), edition.items[0].source.url);
  assert.equal(source.getAttribute("href"), edition.items[0].source.url);
  assert.ok(within(firstRow).getByRole("button", { name: /^Useful,/i }));
  assert.ok(screen.getByText("UPDATED 09:17"));
  assert.ok(screen.getByRole("button", { name: "Demos 1" }));
  assert.ok(screen.getByRole("button", { name: "Utilities 2" }));
  assert.ok(document.querySelector(".signal-category.accent-orange")?.textContent === "DEMO");
  assert.ok(document.querySelector(".signal-category.accent-violet")?.textContent === "UTILITY");
});

test("renders focus categories in the selected mock's fixed order", () => {
  render(<App edition={edition} feedbackService={canonicalService()} />);

  const focusSection = document.querySelector(".filter-section");
  const labels = within(focusSection).getAllByRole("button").map((button) => button.textContent.trim());
  assert.deepEqual(labels, [
    "All signals12",
    "Models2",
    "Tools4",
    "Workflows3",
    "Demos1",
    "Utilities2",
  ]);
});

test("renders broad categories, readable tags, and exact edition accounting", () => {
  render(<App edition={broadEdition} feedbackService={canonicalService()} />);

  assert.ok(screen.getByRole("button", { name: "Software & Developer Tools 1" }));
  assert.ok(screen.getByText("OPEN SOURCE"));
  assert.ok(screen.getByText("1 selected from 12 candidates"));
  assert.ok(screen.getByText("3 GitHub Trending reviewed"));
  assert.ok(screen.getByText("0 exploration picks"));
});

test("omits unreliable usefulness and time-to-try metrics from the briefing interface", () => {
  render(<App edition={edition} feedbackService={canonicalService()} />);

  assert.equal(screen.queryByText("USEFULNESS"), null);
  assert.equal(screen.queryByText("TIME TO TRY"), null);
  assert.equal(document.querySelector(".table-header")?.textContent, "#SIGNALCATEGORYVOTES");
  assert.deepEqual(
    [...document.querySelectorAll(".filter-heading")].map((heading) => heading.textContent.trim()),
    ["FOCUS"],
  );
  assert.equal(document.querySelector(".signal-meta"), null);
});

test("date navigation loads a published archive from the manifest", async () => {
  const user = userEvent.setup({ document });
  const archived = structuredClone(edition);
  archived.date = "2026-08-18";
  archived.curatedAt = "2026-08-18T07:00:00-04:00";
  archived.items[0].title = "ARCHIVED BUILDER SIGNAL";
  const requested = [];
  render(
    <App
      edition={edition}
      manifest={{ latestEdition: edition.date, editions: [archived.date, edition.date] }}
      loadEdition={async (date) => { requested.push(date); return archived; }}
      feedbackService={canonicalService()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Previous date" }));

  assert.equal((await screen.findAllByText("ARCHIVED BUILDER SIGNAL")).length, 1);
  assert.deepEqual(requested, ["2026-08-18"]);
});

test("the active all-signals filter exposes its selected state to assistive technology", async () => {
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService()} />);

  const allSignals = screen.getByRole("button", { name: "All signals 12" });
  const models = screen.getByRole("button", { name: "Models 2" });
  assert.equal(allSignals.getAttribute("aria-pressed"), "true");

  await user.click(models);
  assert.equal(allSignals.getAttribute("aria-pressed"), "false");
  assert.equal(models.getAttribute("aria-pressed"), "true");

  await user.click(allSignals);
  assert.equal(allSignals.getAttribute("aria-pressed"), "true");
  assert.equal(models.getAttribute("aria-pressed"), "false");
});

test("vote keyboard activation stays separate from row selection and survives a late initial load", async () => {
  const initial = deferred();
  const user = userEvent.setup({ document });
  render(
    <App
      edition={edition}
      feedbackService={canonicalService({ getVotes: () => initial.promise })}
    />,
  );
  const targetRow = screen.getByRole("link", { name: /Read source: Claude Code documents/i }).closest(".signal-row");
  const targetVote = within(targetRow).getByRole("button", { name: /^Useful, 0 votes$/i });
  targetVote.focus();
  await user.keyboard("{Enter}");
  assert.equal(targetVote.getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelector(".inspector"), null);

  const staleRecords = seedVoteRecords(edition.items);
  initial.resolve({ records: staleRecords, source: "remote" });
  await waitFor(() => assert.match(targetVote.getAttribute("aria-label"), /1 votes/));
});

test("filter dialog traps focus, makes the background inert, ignores global shortcuts, and restores focus", async () => {
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService()} />);
  const trigger = screen.getByRole("button", { name: "FILTER" });
  trigger.focus();
  await user.click(trigger);

  const dialog = screen.getByRole("dialog", { name: "FILTER SIGNALS" });
  const close = within(dialog).getByRole("button", { name: "Close filters" });
  await waitFor(() => assert.equal(document.activeElement, close));
  assert.ok(document.querySelector(".app-underlay").hasAttribute("inert"));
  await user.keyboard("?");
  assert.equal(screen.queryByRole("dialog", { name: "KEYBOARD CONTROLS" }), null);

  const focusable = within(dialog).getAllByRole("button");
  focusable.at(-1).focus();
  await user.keyboard("{Tab}");
  assert.equal(document.activeElement, close);
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog", { name: "FILTER SIGNALS" }), null);
  assert.equal(document.activeElement, trigger);
});

test("stories stay self-contained and do not render generated analysis or experiments", () => {
  render(<App edition={edition} feedbackService={canonicalService()} />);

  assert.equal(document.querySelector(".inspector"), null);
  assert.equal(screen.queryByText(edition.items[0].signal.whyNow), null);
  assert.equal(screen.queryByText(edition.items[0].caveat), null);
  assert.equal(screen.queryByText(edition.items[0].experiment.goal), null);
  assert.equal(screen.queryByText("TRY THIS"), null);
});

test("a stale initial feedback status cannot replace a newer mutation status", async () => {
  const initial = deferred();
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({
    getVotes: () => initial.promise,
    async setVote(itemId, value, record) { return { record: { ...record, myVote: value }, source: "synced" }; },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);
  await act(async () => {
    initial.resolve({ records: seedVoteRecords(edition.items), source: "local" });
    await initial.promise;
  });
  assert.equal(screen.queryByText("FEEDBACK LOCAL"), null);
});

test("an older vote response cannot replace the newest feedback status", async () => {
  const mutations = [deferred(), deferred()];
  let mutationIndex = 0;
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({
    async getVotes() { return { records: seedVoteRecords(edition.items), source: "synced" }; },
    setVote() { return mutations[mutationIndex++].promise; },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);
  await user.click(screen.getAllByRole("button", { name: /^Not useful,/i })[0]);
  await act(async () => {
    mutations[1].resolve({ record: { up: 6, down: 1, myVote: "down" }, source: "synced" });
    await mutations[1].promise;
  });
  assert.equal(screen.queryByText("FEEDBACK LOCAL"), null);
  await act(async () => {
    mutations[0].resolve({ record: { up: 7, down: 0, myVote: "up" }, source: "local" });
    await mutations[0].promise;
  });
  assert.equal(screen.queryByText("FEEDBACK LOCAL"), null);
});

test("phone rows keep verified sources inline without opening a story modal", async () => {
  phoneViewport = true;
  render(<App edition={edition} feedbackService={canonicalService()} />);

  const firstRow = screen.getAllByRole("listitem")[0];
  assert.ok(within(firstRow).getByRole("link", { name: /Verified source: OpenAI, checked 2026-08-19/i }));
  assert.equal(screen.queryByRole("dialog", { name: /GPT-5 adds stricter/i }), null);
});

test("phone footer renders every essential group without the desktop-only navigation hint", async () => {
  render(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="local" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  const footer = document.querySelector(".app-footer");
  assert.ok(within(footer).getByText("FEEDBACK LOCAL"));
  assert.ok(within(footer).getByText("12 SIGNALS"));
  assert.ok(within(footer).getByRole("button", { name: /Search$/ }));
  assert.ok(within(footer).getByRole("button", { name: /Filter$/ }));
  assert.ok(within(footer).getByRole("button", { name: /Help$/ }));
  assert.equal(within(footer).queryByText("Navigate"), null);
});

test("the footer exposes whether feedback is synced, syncing, or local", () => {
  const view = render(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="synced" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  assert.ok(screen.getByText("FEEDBACK SYNCED"));

  view.rerender(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="syncing" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  assert.ok(screen.getByText("FEEDBACK SYNCING"));

  view.rerender(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="local" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  assert.ok(screen.getByText("FEEDBACK LOCAL"));

  view.rerender(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="persistence" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  assert.ok(screen.getByText("FEEDBACK LOCAL · STORAGE UNAVAILABLE"));
});

test("a vote that cannot be durably queued never claims to be syncing", async () => {
  const pending = deferred();
  Object.assign(pending.promise, { initialSource: "local", initialPersistence: "failed" });
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({ setVote() { return pending.promise; } })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);
  assert.ok(screen.getByText("FEEDBACK LOCAL · STORAGE UNAVAILABLE"));
  assert.equal(screen.queryByText("FEEDBACK SYNCING"), null);

  pending.resolve({ record: { up: 1, down: 0, myVote: "up" }, source: "local", persistence: "failed" });
  await waitFor(() => assert.ok(screen.getByText("FEEDBACK LOCAL · STORAGE UNAVAILABLE")));
  assert.equal(screen.queryByText("FEEDBACK SYNCING"), null);
});

test("a vote load with unavailable storage exposes the persistence limitation", async () => {
  render(<App edition={edition} feedbackService={canonicalService({
    async getVotes() { return { records: seedVoteRecords(edition.items), source: "local", persistence: "failed" }; },
  })} />);
  await waitFor(() => assert.ok(screen.getByText("FEEDBACK LOCAL · STORAGE UNAVAILABLE")));
});

test("an optimistic vote shows syncing feedback before Worker acknowledgement", async () => {
  const pending = deferred();
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({
    setVote() { return pending.promise; },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);

  assert.ok(screen.getByText("FEEDBACK SYNCING"));
});

test("a rejected vote request exposes local feedback instead of a retired fallback state", async () => {
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({
    setVote() { return Promise.reject(new Error("offline")); },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);

  await waitFor(() => assert.ok(screen.getByText("FEEDBACK LOCAL")));
  assert.equal(screen.queryByText("FEEDBACK SYNCING"), null);
});

test("loading, error, filter-empty, and help states stay reachable without an inspector", async () => {
  const user = userEvent.setup({ document });
  const view = render(<App edition={null} feedbackService={canonicalService()} />);
  assert.ok(screen.getByText("LOADING TODAY'S SIGNALS"));
  view.rerender(<App edition={new Error("broken")} feedbackService={canonicalService()} />);
  assert.ok(screen.getByRole("alert"));
  view.rerender(<App edition={edition} feedbackService={canonicalService()} />);

  await user.click(screen.getByRole("button", { name: "SEARCH" }));
  await user.type(screen.getByLabelText("Search signals"), "does-not-exist");
  assert.ok(screen.getByRole("heading", { name: "NO SIGNALS MATCH" }));
  await user.click(screen.getByRole("button", { name: "CLEAR FILTERS" }));
  await user.keyboard("{Escape}");
  await user.keyboard("?");
  assert.ok(screen.getByRole("dialog", { name: "KEYBOARD CONTROLS" }));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("button", { name: "OPEN INSPECTOR" }), null);
});

test("report selection uses every displayed-edition story despite filters and excludes downvotes", async () => {
  const user = userEvent.setup({ document });
  const records = seedVoteRecords(edition.items);
  records[edition.items[0].id].myVote = "up";
  records[edition.items[1].id].myVote = "down";
  const starts = [];
  render(<App
    edition={edition}
    feedbackService={canonicalService({ async getVotes() { return { records, source: "synced" }; } })}
    reportService={reportService({ async startReport(selection) {
      starts.push(selection);
      return { jobId: "job-1", status: "running", progress: { phase: "queued", completed: 0, total: 1 } };
    }, async getReport() { return new Promise(() => {}); } })}
    reportPollInterval={0}
  />);

  await screen.findByRole("button", { name: "Generate report" });
  await user.click(screen.getByRole("button", { name: "Models 2" }));
  assert.equal(screen.getAllByRole("listitem").length, 2);
  assert.ok(screen.getByText("1 liked · 10 unvoted · 1 downvoted excluded"));

  await user.click(screen.getByRole("button", { name: "Generate report" }));
  assert.deepEqual(starts, [{
    date: edition.date,
    itemIds: edition.items.filter((item) => item.id !== edition.items[1].id).map((item) => item.id),
  }]);
});

test("a successful start persists the owned report before polling it", async () => {
  const owned = [];
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      setOwnedJob(value) { owned.push(value); },
      async getReport() { return new Promise(() => {}); },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  await waitFor(() => assert.deepEqual(owned, [{ jobId: "job-1", editionDate: edition.date, status: "active" }]));
});

test("a storage failure after report creation keeps the live job attached in this tab", async () => {
  const liveStatus = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      setOwnedJob() { throw new Error("local storage blocked"); },
      async getReport() { return liveStatus.promise; },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));

  assert.ok(await screen.findByText("REPORT CONTINUITY LIMITED"));
  assert.ok(screen.getByRole("button", { name: "Cancel report" }));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  assert.equal(screen.queryByText("REPORT FAILED"), null);
});

test("a completed report marks retained ownership as terminal", async () => {
  const ownership = [];
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({ setOwnedJob(value) { ownership.push(value); } })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.deepEqual(ownership, [
    { jobId: "job-1", editionDate: edition.date, status: "active" },
    { jobId: "job-1", editionDate: edition.date, status: "completed" },
  ]);
});

test("report generation waits for the displayed edition's browser votes before selecting stories", async () => {
  const votes = deferred();
  render(<App
    edition={edition}
    feedbackService={canonicalService({ getVotes() { return votes.promise; } })}
    reportService={reportService()}
  />);

  const generate = await screen.findByRole("button", { name: "Generate report" });
  assert.equal(generate.disabled, true);
  assert.ok(screen.getByText("CHECKING YOUR VOTES"));

  await act(async () => {
    votes.resolve({ records: seedVoteRecords(edition.items), source: "local" });
    await votes.promise;
  });
  await waitFor(() => assert.equal(generate.disabled, false));
});

test("report generation is disabled when every story is downvoted", async () => {
  const records = Object.fromEntries(edition.items.map((item) => [item.id, { up: 0, down: 1, myVote: "down" }]));
  render(<App
    edition={edition}
    feedbackService={canonicalService({ async getVotes() { return { records, source: "local" }; } })}
    reportService={reportService()}
  />);

  const generate = await screen.findByRole("button", { name: "Generate report" });
  await waitFor(() => assert.equal(generate.disabled, true));
  assert.ok(screen.getByText("0 liked · 0 unvoted · 12 downvoted excluded"));
});

test("random visitors see an offline paired-Mac state and can retry health", async () => {
  let attempts = 0;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      hasToken() { return false; },
      async health() {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("offline"), { code: "offline" });
        return { status: "ok", version: "1", paired: true, busy: false };
      },
    })}
  />);

  assert.ok(await screen.findByText("REPORT COMPANION OFFLINE"));
  assert.ok(screen.getByText(/only available on Patrick's paired Mac/i));
  await user.click(screen.getByRole("button", { name: "Retry companion" }));
  assert.ok(await screen.findByText("PAIRED MAC REQUIRED"));
  assert.equal(attempts, 2);
});

test("the GitHub Pages mirror directs report users to the private-capable origin", async () => {
  let healthChecks = 0;
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({ async health() { healthChecks += 1; return { status: "ok", paired: false, busy: false }; } })}
    reportOrigin="https://patrickkells.github.io"
  />);

  assert.ok(await screen.findByText("REPORTS USE THE PRIVATE-CAPABLE SITE"));
  assert.equal(screen.getByRole("link", { name: "Open report-capable site" }).getAttribute("href"), "https://today-i-found.pages.dev/");
  assert.equal(screen.queryByLabelText("Pairing code"), null);
  assert.equal(healthChecks, 0);
});

test("an unapproved localhost port does not expose private report controls", async () => {
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService()}
    reportOrigin="http://localhost:8765"
  />);

  assert.ok(await screen.findByText("REPORTS USE THE PRIVATE-CAPABLE SITE"));
  assert.equal(screen.queryByLabelText("Pairing code"), null);
  assert.equal(screen.queryByRole("button", { name: "Generate report" }), null);
});

test("a companion-owned active job blocks a second report until health is checked again", async () => {
  let busy = true;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async health() { return { status: "ok", version: "1", paired: true, busy }; },
    })}
  />);

  assert.ok(await screen.findByText("REPORT RUNNER BUSY"));
  assert.equal(screen.queryByRole("button", { name: "Generate report" }), null);
  busy = false;
  await user.click(screen.getByRole("button", { name: "Check again" }));
  assert.ok(await screen.findByRole("button", { name: "Generate report" }));
});

test("one-time pairing accepts a six-digit code and transitions to ready", async () => {
  let paired = false;
  let receivedCode;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      hasToken() { return paired; },
      async health() { return { status: "ok", version: "1", paired, busy: false }; },
      async pair(code) { receivedCode = code; paired = true; return { paired: true }; },
    })}
  />);

  const input = await screen.findByLabelText("Pairing code");
  await user.type(input, "482931");
  await user.click(screen.getByRole("button", { name: "Pair this browser" }));

  assert.equal(receivedCode, "482931");
  assert.ok(await screen.findByRole("button", { name: "Generate report" }));
});

test("pairing network failures return to the offline companion state", async () => {
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      hasToken() { return false; },
      async health() { return { status: "ok", version: "1", paired: false, busy: false }; },
      async pair() { throw Object.assign(new Error("offline"), { code: "offline" }); },
    })}
  />);

  await user.type(await screen.findByLabelText("Pairing code"), "482931");
  await user.click(screen.getByRole("button", { name: "Pair this browser" }));

  assert.ok(await screen.findByText("REPORT COMPANION OFFLINE"));
  assert.equal(screen.queryByText("The pairing code was not accepted."), null);
});

test("running reports announce progress, can be cancelled, and ignore stale poll results", async () => {
  const oldPoll = deferred();
  let cancelCount = 0;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async getReport() { return oldPoll.promise; },
      async cancel() { cancelCount += 1; return { cancelled: true }; },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("QUEUED"));
  assert.ok(screen.getByRole("progressbar", { name: "QUEUED" }));
  await user.click(screen.getByRole("button", { name: "Cancel report" }));
  assert.equal(cancelCount, 1);
  assert.ok(await screen.findByText("REPORT CANCELLED"));

  await act(async () => {
    oldPoll.resolve({ jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} });
    await oldPoll.promise;
  });
  assert.equal(screen.queryByText("REPORT READY"), null);
});

test("a committing report stays active, cannot be cancelled, and continues polling to completion", async () => {
  const finalPoll = deferred();
  let polls = 0;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async getReport() {
        polls += 1;
        if (polls === 1) return { jobId: "job-1", status: "committing", progress: { phase: "saving", completed: 0, total: 1 } };
        return finalPoll.promise;
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("SAVING REPORT"));
  assert.equal(screen.queryByRole("button", { name: "Cancel report" }), null);
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  await waitFor(() => assert.equal(polls, 2));

  finalPoll.resolve({ jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} });
  assert.ok(await screen.findByText("REPORT READY"));
});

test("date navigation stays disabled while a report owns the companion job", async () => {
  const poll = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({ async getReport() { return poll.promise; } })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  const previous = screen.getByRole("button", { name: "Previous date" });
  const next = screen.getByRole("button", { name: "Next date" });
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
  assert.equal(previous.getAttribute("title"), "Finish or cancel the active report before changing editions");

  await user.click(screen.getByRole("button", { name: "Cancel report" }));
  await waitFor(() => assert.equal(previous.disabled, false));
  assert.equal(next.disabled, false);
});

test("a transient polling outage keeps the owned job attached and resumes it after health recovers", async () => {
  let polls = 0;
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async getReport() {
        polls += 1;
        if (polls === 1) throw Object.assign(new Error("offline"), { code: "offline" });
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("REPORT COMPANION OFFLINE"));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);

  await user.click(screen.getByRole("button", { name: "Retry companion" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, false);
  assert.equal(polls, 2);
});

test("a generic polling failure preserves ownership until status can be fetched again", async () => {
  let polls = 0;
  const cleared = [];
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
      async getReport() {
        polls += 1;
        if (polls === 1) throw Object.assign(new Error("temporary server error"), { code: "request", status: 500 });
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("REPORT STATUS UNAVAILABLE"));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  assert.deepEqual(cleared, []);

  await user.click(screen.getByRole("button", { name: "Retry report status" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.deepEqual(cleared, []);
});

test("status retry stays single-flight until its direct response resolves", async () => {
  let polls = 0;
  const retryResponse = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async getReport() {
        polls += 1;
        if (polls === 1) throw Object.assign(new Error("temporary server error"), { code: "request", status: 500 });
        if (polls === 2) return retryResponse.promise;
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("REPORT STATUS UNAVAILABLE"));
  await user.click(screen.getByRole("button", { name: "Retry report status" }));

  assert.ok(await screen.findByText("CHECKING REPORT STATUS"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(polls, 2);
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);

  await act(async () => {
    retryResponse.resolve({ jobId: "job-1", status: "running", progress: { phase: "batch-summarization", completed: 1, total: 2 } });
    await retryResponse.promise;
  });
  assert.ok(await screen.findByText("REPORT READY"));
  assert.equal(polls, 3);
});

test("an offline cancellation failure keeps the report owned and resumable", async () => {
  let polls = 0;
  const cleared = [];
  const stalePoll = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
      async cancel() { throw Object.assign(new Error("offline"), { code: "offline" }); },
      async getReport() {
        polls += 1;
        if (polls === 1) return stalePoll.promise;
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  await user.click(await screen.findByRole("button", { name: "Cancel report" }));
  assert.ok(await screen.findByText("REPORT COMPANION OFFLINE"));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  assert.deepEqual(cleared, []);

  await user.click(screen.getByRole("button", { name: "Retry companion" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.deepEqual(cleared, []);
});

test("a generic cancellation failure keeps the report owned until status confirms completion", async () => {
  let polls = 0;
  const cleared = [];
  const stalePoll = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
      async cancel() { throw Object.assign(new Error("temporary server error"), { code: "request", status: 500 }); },
      async getReport() {
        polls += 1;
        if (polls === 1) return stalePoll.promise;
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  await user.click(await screen.findByRole("button", { name: "Cancel report" }));
  assert.ok(await screen.findByText("REPORT STATUS UNAVAILABLE"));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  assert.deepEqual(cleared, []);

  await user.click(screen.getByRole("button", { name: "Retry report status" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.deepEqual(cleared, []);
});

test("a declined cancellation immediately re-fetches status instead of claiming cancellation", async () => {
  let polls = 0;
  const cleared = [];
  const stalePoll = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
      async cancel() { return { cancelled: false }; },
      async getReport() {
        polls += 1;
        if (polls === 1) return stalePoll.promise;
        return { jobId: "job-1", status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} };
      },
    })}
    reportPollInterval={0}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  await user.click(await screen.findByRole("button", { name: "Cancel report" }));

  assert.ok(await screen.findByText("REPORT READY"));
  assert.equal(screen.queryByText("REPORT CANCELLED"), null);
  assert.deepEqual(cleared, []);
  assert.equal(polls, 2);
});

test("a running owned report resumes polling after the page remounts", async () => {
  const status = deferred();
  let healthChecks = 0;
  const owned = { jobId: "owned-job", editionDate: edition.date };
  const service = reportService({
    getOwnedJob() { return owned; },
    async health() { healthChecks += 1; return { status: "ok", version: "1", paired: true, busy: true }; },
    async getReport() { return status.promise; },
  });
  render(<App edition={edition} feedbackService={loadedFeedback()} reportService={service} reportPollInterval={0} />);

  assert.ok(await screen.findByRole("progressbar", { name: "RESUMING REPORT" }));
  assert.equal(screen.getByRole("button", { name: "Previous date" }).disabled, true);
  assert.equal(healthChecks, 0);

  await act(async () => {
    status.resolve({ jobId: owned.jobId, status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} });
    await status.promise;
  });
  assert.ok(await screen.findByText("REPORT READY"));
});

test("a completed owned report restores its download controls on reload", async () => {
  const owned = { jobId: "owned-complete", editionDate: edition.date };
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      getOwnedJob() { return owned; },
      async getReport() { return { jobId: owned.jobId, status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} }; },
    })}
    reportPollInterval={0}
  />);

  assert.ok(await screen.findByText("REPORT READY"));
  assert.ok(screen.getByRole("button", { name: "Download Markdown" }));
  assert.ok(screen.getByRole("button", { name: "Download JSON" }));
});

test("a missing owned job is cleared and returns the edition to ready", async () => {
  const owned = { jobId: "missing-job", editionDate: edition.date };
  const cleared = [];
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      getOwnedJob() { return owned; },
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
      async getReport() { throw Object.assign(new Error("not found"), { status: 404, code: "request" }); },
    })}
    reportPollInterval={0}
  />);

  assert.ok(await screen.findByRole("button", { name: "Generate report" }));
  assert.deepEqual(cleared, [owned.jobId]);
});

test("an owned report for an edition outside the archive is discarded as stale", async () => {
  const owned = { jobId: "stale-job", editionDate: "2026-07-01" };
  const cleared = [];
  render(<App
    edition={edition}
    manifest={{ latestEdition: edition.date, editions: [edition.date] }}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      getOwnedJob() { return owned; },
      clearOwnedJob(jobId) { cleared.push(jobId); return true; },
    })}
  />);

  assert.ok(await screen.findByRole("button", { name: "Generate report" }));
  await waitFor(() => assert.deepEqual(cleared, [owned.jobId]));
  assert.equal(screen.getByRole("time").getAttribute("datetime"), edition.date);
});

test("completed historical ownership leaves the latest edition open and remains recoverable from its archive", async () => {
  const archived = structuredClone(edition);
  archived.date = "2026-08-18";
  archived.curatedAt = "2026-08-18T07:00:00-04:00";
  const owned = { jobId: "archived-job", editionDate: archived.date, status: "completed" };
  const loads = [];
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    manifest={{ latestEdition: edition.date, editions: [archived.date, edition.date] }}
    loadEdition={async (date) => { loads.push(date); return archived; }}
    feedbackService={loadedFeedback(seedVoteRecords(archived.items))}
    reportService={reportService({
      getOwnedJob() { return owned; },
      async getReport() { return { jobId: owned.jobId, status: "completed", progress: { phase: "completed", completed: 1, total: 1 }, downloads: {} }; },
    })}
    reportPollInterval={0}
  />);

  assert.ok(await screen.findByRole("button", { name: "Generate report" }));
  assert.equal(screen.getByRole("time").getAttribute("datetime"), edition.date);
  assert.deepEqual(loads, []);

  await user.click(screen.getByRole("button", { name: "Previous date" }));
  assert.ok(await screen.findByText("REPORT READY"));
  assert.equal(screen.getByRole("time").getAttribute("datetime"), archived.date);
  assert.deepEqual(loads, [archived.date]);
});

test("running historical ownership stays recoverable without replacing the latest edition at boot", async () => {
  const archived = structuredClone(edition);
  archived.date = "2026-08-18";
  archived.curatedAt = "2026-08-18T07:00:00-04:00";
  const owned = { jobId: "archived-running-job", editionDate: archived.date, status: "active" };
  const status = deferred();
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    manifest={{ latestEdition: edition.date, editions: [archived.date, edition.date] }}
    loadEdition={async () => archived}
    feedbackService={loadedFeedback(seedVoteRecords(archived.items))}
    reportService={reportService({
      getOwnedJob() { return owned; },
      async health() { return { status: "ok", version: "1", paired: true, busy: true }; },
      async getReport() { return status.promise; },
    })}
    reportPollInterval={0}
  />);

  assert.equal(screen.getByRole("time").getAttribute("datetime"), edition.date);
  assert.ok(await screen.findByText("REPORT RUNNER BUSY"));
  await user.click(screen.getByRole("button", { name: "Previous date" }));
  assert.ok(await screen.findByRole("progressbar", { name: "RESUMING REPORT" }));
  assert.equal(screen.getByRole("time").getAttribute("datetime"), archived.date);
});

test("completed reports offer authenticated Markdown and JSON downloads", async () => {
  const downloads = [];
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      async download(jobId, kind) {
        downloads.push({ jobId, kind });
        return { blob: new Blob([kind]), filename: `report.${kind === "markdown" ? "md" : "json"}` };
      },
    })}
    reportPollInterval={0}
    saveReportDownload={() => {}}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("REPORT READY"));
  await user.click(screen.getByRole("button", { name: "Download Markdown" }));
  await user.click(screen.getByRole("button", { name: "Download JSON" }));

  assert.deepEqual(downloads, [
    { jobId: "job-1", kind: "markdown" },
    { jobId: "job-1", kind: "json" },
  ]);
});

test("browser downloads defer object URL revocation until after the click task", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  const events = [];
  URL.createObjectURL = () => "blob:report";
  URL.revokeObjectURL = (url) => events.push(`revoke:${url}`);
  window.HTMLAnchorElement.prototype.click = function click() { events.push(`click:${this.download}`); };
  try {
    saveBrowserDownload({ blob: new Blob(["report"]), filename: "report.md" });
    assert.deepEqual(events, ["click:report.md"]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.deepEqual(events, ["click:report.md", "revoke:blob:report"]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("an expired companion token returns the report surface to paired-device authorization", async () => {
  const user = userEvent.setup({ document });
  render(<App
    edition={edition}
    feedbackService={loadedFeedback()}
    reportService={reportService({
      hasToken() { return true; },
      async startReport() { throw Object.assign(new Error("Device token is invalid"), { code: "auth", status: 401 }); },
    })}
  />);

  await user.click(await screen.findByRole("button", { name: "Generate report" }));
  assert.ok(await screen.findByText("PAIRING REQUIRED"));
  assert.equal(document.body.textContent.includes("Device token is invalid"), false);
});
