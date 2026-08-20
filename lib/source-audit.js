function normalizedHost(value) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function relatedHosts(left, right) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export async function auditEditionSources(edition, { fetchImpl = globalThis.fetch } = {}) {
  const errors = [];
  for (const item of edition?.items ?? []) {
    const sourceUrl = item?.source?.url;
    if (!sourceUrl) continue;
    try {
      const response = await fetchImpl(sourceUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 (compatible; today-i-found-source-audit/1.0)",
        },
        redirect: "follow",
      });
      if (!response.ok) {
        errors.push(`${item.id} source returned HTTP ${response.status}.`);
        continue;
      }
      const finalUrl = response.url || sourceUrl;
      const expectedHost = normalizedHost(sourceUrl);
      const finalHost = normalizedHost(finalUrl);
      if (!relatedHosts(expectedHost, finalHost)) {
        errors.push(`${item.id} source redirected to an unrelated host: ${finalHost}.`);
      }
    } catch (error) {
      errors.push(`${item.id} source request failed: ${error.message}.`);
    }
  }
  return errors;
}
