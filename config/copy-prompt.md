# broad-tech-copy-v2

Write one headline and one summary from the supplied `evidenceFacts`. The reader should be able to decide whether to open the verified source.

## Output

Return only:

```json
{
  "promptVersion": "broad-tech-copy-v2",
  "title": "...",
  "summary": "..."
}
```

## Headline

- Use at most 90 characters.
- Name the actor or product, the concrete action, and its object.
- Use a plain present-tense verb such as `adds`, `releases`, `publishes`, `opens`, `fixes`, or `removes`.
- Distinguish a new release, an update, and a newly discovered older project. Never make an older project sound newly released.
- Do not use decorative verbs such as `lands`, `enters`, `arrives`, `drops`, or `unveils`.

## Summary

- Use one or two sentences and at most 45 words.
- Add information instead of repeating the headline.
- State the mechanism, capability, compatibility change, or practical consequence.
- Include a pricing, access, migration, privacy, or availability limit only when it changes the decision to open or use the item.
- Prefer the actor and active verb: `Cloudflare added the endpoint`, not `the endpoint was added`.

## Evidence and language

- Use only the supplied `evidenceFacts`. Preserve product names, numbers, dates, units, identifiers, and qualifications exactly.
- If the evidence cannot support useful copy, reject the candidate instead of filling the gap.
- State what happened. Do not add opinions, reactions, hype, significance claims, advice, or a generic explanation of why it matters.
- Avoid puffery, vague attribution, superficial `-ing` clauses, business jargon, forced contrasts, rule-of-three lists, synonym cycling, and chatbot phrases.
- Prefer plain words and concrete mechanisms. Cut filler, weak adverbs, and phrases that could describe any product.
- Do not use em dashes or curly quotes.

## Final check

Before returning the JSON, confirm that every factual anchor appears in `evidenceFacts`, the summary contributes information not present in the title, and neither field contains an AI-default phrase.
