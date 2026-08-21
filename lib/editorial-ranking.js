import policy from "../config/curation-policy.json" with { type: "json" };

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function eligiblePreferenceMap(groups) {
  return new Map(
    (groups ?? [])
      .filter((entry) => typeof entry?.value === "string"
        && Number.isFinite(entry.effectiveVotes)
        && entry.effectiveVotes >= policy.feedback.minEffectiveVotes
        && Number.isFinite(entry.adjustment))
      .map((entry) => [entry.value, entry.adjustment]),
  );
}

export function applyFeedbackTieBreak(edition, feedback = {}) {
  const preferences = feedback.preferences ?? {};
  const category = eligiblePreferenceMap(preferences.category);
  const source = eligiblePreferenceMap(preferences.source);
  const tag = eligiblePreferenceMap(preferences.tag);
  const tierIndex = new Map(policy.editorialTiers.map((tier, index) => [tier, index]));
  const annotated = (edition.items ?? []).map((item, index) => {
    const matches = [category.get(item.category), source.get(item.source?.publisher), ...(item.tags ?? []).map((value) => tag.get(value))]
      .filter(Number.isFinite);
    const feedbackSignal = matches.length
      ? clamp(matches.reduce((total, value) => total + value, 0) / matches.length, -policy.feedback.maxAdjustment, policy.feedback.maxAdjustment)
      : 0;
    return { item: { ...item, curation: { feedbackSignal, eligiblePreferenceCount: matches.length } }, index };
  });
  return {
    ...edition,
    items: annotated.sort((left, right) => (tierIndex.get(left.item.editorialTier) ?? 99) - (tierIndex.get(right.item.editorialTier) ?? 99)
      || right.item.curation.feedbackSignal - left.item.curation.feedbackSignal
      || left.index - right.index).map(({ item }) => item),
  };
}

function interleave(personalized, exploration) {
  const result = [];
  let explorationIndex = 0;
  for (const item of personalized) {
    result.push(item);
    if (result.length % 5 === 4 && explorationIndex < exploration.length) result.push(exploration[explorationIndex++]);
  }
  return [...result, ...exploration.slice(explorationIndex)];
}

export function selectPersonalizedItems(items, feedback = {}, {
  maxItems = policy.edition.maxItems,
  explorationRatio = policy.feedback.explorationRatio,
} = {}) {
  const preferences = feedback.preferences ?? {};
  const category = eligiblePreferenceMap(preferences.category);
  const source = eligiblePreferenceMap(preferences.source);
  const tag = eligiblePreferenceMap(preferences.tag);
  const tierIndex = new Map(policy.editorialTiers.map((tier, index) => [tier, index]));
  const tierOrder = (tier) => tierIndex.get(tier) ?? policy.editorialTiers.length;

  const annotated = (items ?? []).map((item, index) => {
    const matches = [
      category.get(item.category),
      source.get(item.source?.publisher),
      ...(item.tags ?? []).map((value) => tag.get(value)),
    ].filter(Number.isFinite);
    const feedbackSignal = matches.length
      ? clamp(matches.reduce((total, value) => total + value, 0) / matches.length, -policy.feedback.maxAdjustment, policy.feedback.maxAdjustment)
      : 0;

    return {
      item: {
        ...item,
        curation: {
          preferenceSignal: feedbackSignal,
          feedbackSignal,
          eligiblePreferenceCount: matches.length,
          selectionMode: matches.length ? "personalized" : "editorial",
        },
      },
      index,
    };
  });

  const eligiblePreferenceGroups = category.size + source.size + tag.size;
  if (!eligiblePreferenceGroups) {
    const selected = annotated.slice(0, maxItems).map(({ item }) => ({
      ...item,
      curation: { ...item.curation, selectionMode: "editorial" },
    }));
    return { items: selected, stats: { eligiblePreferenceGroups: 0, personalizedItems: 0, editorialItems: selected.length, explorationItems: 0 } };
  }

  const byPreference = [...annotated].sort((left, right) => right.item.curation.preferenceSignal - left.item.curation.preferenceSignal
    || tierOrder(left.item.editorialTier) - tierOrder(right.item.editorialTier)
    || left.index - right.index);

  if (annotated.length <= maxItems) {
    const selected = byPreference.map(({ item }) => item);
    return {
      items: selected,
      stats: {
        eligiblePreferenceGroups,
        personalizedItems: selected.filter((item) => item.curation.eligiblePreferenceCount > 0).length,
        editorialItems: selected.filter((item) => item.curation.eligiblePreferenceCount === 0).length,
        explorationItems: 0,
      },
    };
  }

  const explorationLimit = Math.floor(maxItems * explorationRatio);
  const personalizedLimit = maxItems - explorationLimit;
  const personalizedEntries = byPreference.slice(0, personalizedLimit);
  const selectedIndexes = new Set(personalizedEntries.map((entry) => entry.index));
  const explorationEntries = annotated.filter((entry) => !selectedIndexes.has(entry.index)).slice(0, explorationLimit);
  const personalized = personalizedEntries.map(({ item }) => item);
  const exploration = explorationEntries.map(({ item }) => ({
    ...item,
    curation: { ...item.curation, selectionMode: "exploration" },
  }));
  return {
    items: interleave(personalized, exploration),
    stats: {
      eligiblePreferenceGroups,
      personalizedItems: personalized.length,
      editorialItems: 0,
      explorationItems: exploration.length,
    },
  };
}
