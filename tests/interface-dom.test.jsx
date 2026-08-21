import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://today-i-found.test/",
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
const { App, AppFooter } = await import("../src/App.jsx");
const edition = (await import("./fixtures/edition.json", { with: { type: "json" } })).default;
const broadEdition = (await import("./fixtures/edition-v3.json", { with: { type: "json" } })).default;
const { seedVoteRecords } = await import("../src/feedback-service.js");

function canonicalService(overrides = {}) {
  const records = seedVoteRecords(edition.items);
  return {
    getVotes() { return new Promise(() => {}); },
    async setVote(itemId, value, fallbackRecord) {
      return { record: { ...fallbackRecord, myVote: value }, source: "fallback" };
    },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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
    async setVote(itemId, value, record) { return { record: { ...record, myVote: value }, source: "remote" }; },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);
  await act(async () => {
    initial.resolve({ records: seedVoteRecords(edition.items), source: "fallback" });
    await initial.promise;
  });
  assert.equal(screen.queryByText("FEEDBACK LOCAL"), null);
});

test("an older vote response cannot replace the newest feedback status", async () => {
  const mutations = [deferred(), deferred()];
  let mutationIndex = 0;
  const user = userEvent.setup({ document });
  render(<App edition={edition} feedbackService={canonicalService({
    async getVotes() { return { records: seedVoteRecords(edition.items), source: "remote" }; },
    setVote() { return mutations[mutationIndex++].promise; },
  })} />);

  await user.click(screen.getAllByRole("button", { name: /^Useful,/i })[0]);
  await user.click(screen.getAllByRole("button", { name: /^Not useful,/i })[0]);
  await act(async () => {
    mutations[1].resolve({ record: { up: 6, down: 1, myVote: "down" }, source: "remote" });
    await mutations[1].promise;
  });
  assert.equal(screen.queryByText("FEEDBACK LOCAL"), null);
  await act(async () => {
    mutations[0].resolve({ record: { up: 7, down: 0, myVote: "up" }, source: "fallback" });
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
  render(<AppFooter signalCount={12} curatedAt={edition.curatedAt} timeZone={edition.timezone} feedbackSource="fallback" isPhone onSearch={() => {}} onFilter={() => {}} onHelp={() => {}} />);
  const footer = document.querySelector(".app-footer");
  assert.ok(within(footer).getByText("FEEDBACK LOCAL"));
  assert.ok(within(footer).getByText("12 SIGNALS"));
  assert.ok(within(footer).getByRole("button", { name: /Search$/ }));
  assert.ok(within(footer).getByRole("button", { name: /Filter$/ }));
  assert.ok(within(footer).getByRole("button", { name: /Help$/ }));
  assert.equal(within(footer).queryByText("Navigate"), null);
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
