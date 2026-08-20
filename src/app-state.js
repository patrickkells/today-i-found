export function createInitialState(items = []) {
  return {
    selectedId: items[0]?.id ?? null,
    inspectorOpen: Boolean(items.length),
    filtersOpen: false,
    helpOpen: false,
    query: "",
    filters: {
      categories: [],
    },
  };
}

export function filterSignals(items, filters) {
  const query = filters.query?.trim().toLowerCase() ?? "";

  return items.filter((item) => {
    const searchable = [item.title, item.summary, item.category, item.source?.publisher]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const categoryMatch =
      !filters.categories?.length || filters.categories.includes(item.category);

    return (!query || searchable.includes(query)) && categoryMatch;
  });
}

export function getNextSelection(ids, currentId, key) {
  if (!ids.length) return null;
  const currentIndex = Math.max(0, ids.indexOf(currentId));
  const step = key === "ArrowDown" || key.toLowerCase() === "j" ? 1 : -1;
  return ids[(currentIndex + step + ids.length) % ids.length];
}

export function applyVote(counts, currentVote, requestedVote) {
  const next = { up: counts.up, down: counts.down };

  if (currentVote === requestedVote) {
    next[requestedVote] = Math.max(0, next[requestedVote] - 1);
    return { counts: next, vote: null };
  }

  if (currentVote) next[currentVote] = Math.max(0, next[currentVote] - 1);
  next[requestedVote] += 1;
  return { counts: next, vote: requestedVote };
}
