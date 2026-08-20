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
  const tierOrder = (tier) => tierIndex.get(tier) ?? policy.editorialTiers.length;

  const annotated = (edition.items ?? []).map((item, index) => {
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
          feedbackSignal,
          eligiblePreferenceCount: matches.length,
        },
      },
      index,
    };
  });

  return {
    ...edition,
    items: annotated
      .sort((left, right) => tierOrder(left.item.editorialTier) - tierOrder(right.item.editorialTier)
        || right.item.curation.feedbackSignal - left.item.curation.feedbackSignal
        || left.index - right.index)
      .map(({ item }) => item),
  };
}
