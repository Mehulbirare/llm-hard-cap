# Launch playbook — 1500 downloads in week one

Honest expectations: 1500 first-week downloads is **above average**. Most new npm packages get under 50. Getting there requires distribution, not just SEO. SEO works on a 3–6 month timeline; week-one numbers come from posts and timing. Below is a concrete plan.

---

## T-2 days: pre-launch checklist

- [ ] Replace `your-username` in `package.json` `repository`, `homepage`, `bugs` fields.
- [ ] Push code to a public GitHub repo. Repo name = package name.
- [ ] Add a 1-line repo description: "Hard spend limits for OpenAI, Anthropic, Gemini and any LLM API."
- [ ] Add GitHub topics: `openai`, `anthropic`, `claude`, `gemini`, `llm`, `typescript`, `nodejs`, `ai`, `cost-tracking`, `budget`.
- [ ] Pin a "Why this exists" issue/discussion with the runaway-bill story.
- [ ] Add a clean social preview image (1200×630). Tools: ray.so, carbon, screenshot of code + tagline.
- [ ] `npm publish` (after a private `npm pack --dry-run` to verify the tarball doesn't include junk).
- [ ] Verify the npmjs.com page renders the README correctly — the first 200 chars of the description appear in npm search results.

## T-1 day: prep distribution assets

You need 4 artifacts:

1. **Twitter/X thread** (5–7 tweets). Hook: "I built a thing that would have saved $34k for the Cloudflare team last month."
2. **HN post** — title only. The title is the entire post; HN strips marketing. Best titles for tools: `Show HN: llm-hard-cap – Hard spend caps for OpenAI/Claude/Gemini in 3 KB`
3. **Reddit post** for r/node, r/typescript, r/LocalLLaMA, r/SaaS, r/javascript. r/javascript is moderated tightly — read their rules; "Showoff Saturday" is your safest slot.
4. **Dev.to article** — long form, includes the same code as the README plus a "why I built this" narrative. Cross-post to Hashnode + Medium.

## Launch day (Tuesday or Wednesday, 9–11am ET is optimal)

Why Tue/Wed: HN traffic peaks midweek. Avoid Mondays (catch-up email) and Fridays (people checked out).

**Order of operations (all within ~90 minutes):**

1. 9:00 — Twitter/X thread goes live. Pin it.
2. 9:05 — Submit to HN. Title only. Don't comment immediately.
3. 9:15 — r/node post. Title: "I built llm-hard-cap: hard $ caps on OpenAI/Claude calls"
4. 9:30 — Dev.to article published. Add tags: `ai`, `openai`, `typescript`, `node`, `webdev`.
5. 9:45 — Post in 2–3 Discord/Slack communities where you're already a member (TypeScript, AI Engineer, etc.). Never spam communities you don't belong to.
6. 10:00 — Reply to the first comments on every channel. Engagement in the first hour is what HN/Reddit rank on.
7. 10:30 — Submit to ProductHunt (scheduled for the next day; PH counts a day starting at midnight PT).

## Day 2

- Post on LinkedIn (B2B engineering crowd — good for SaaS users with budgets).
- Submit to: dailydev.com, awesome-llm lists (PR to repos like `awesome-llm-apps`, `awesome-nodejs`), Hacker Newsletter.
- DM 5 specific people who have publicly complained about LLM bills on Twitter. Don't pitch — share the link as "thought you'd want to know this exists."

## Days 3–7

- Submit a PR to one popular LLM-adjacent repo adding `llm-hard-cap` to their README's "ecosystem" section.
- Write a second blog post: case-study format. "We capped a customer's OpenAI bill at $10/day. Here's the 8 lines of code."
- Respond to every GitHub issue within 6 hours. Fast response = social proof.

---

## Realistic week-one math

| Channel        | Realistic installs (median outcome) |
|----------------|-------------------------------------|
| HN front page  | 300–1500 (binary — front page or nothing) |
| HN no front page | 30–80 |
| r/node         | 50–150 |
| r/javascript   | 80–300 (if approved) |
| Twitter thread (no virality) | 20–60 |
| Twitter thread (1 retweet from someone with 10k+ followers) | 200–600 |
| Dev.to         | 30–100 over the week |
| ProductHunt    | 50–200 |
| Word of mouth / awesome lists | 20–80 |

**Most likely outcome without HN front page: 300–700 installs week one.**
**With HN front page: 1500–5000 is realistic.**

So: 1500 in week one is *one good HN day* away. Optimize the HN title and the first comment.

---

## HN-specific tips

- Title is everything. Limit 80 chars. Lead with `Show HN:` and the value prop.
- Don't post yourself + comment "this is cool" from a friend. HN detects this and drops you.
- First comment from you: a 4–6 line "why I built this" explaining the problem. Be specific (mention the Cloudflare $34k incident).
- If you don't hit front page in 2 hours, you won't. Don't repost the same week.

---

## npm SEO that actually moves the needle

npm search ranks on:

1. **Name match** — your name has `llm` and `budget`. Good for `llm budget`, `budget guard` queries.
2. **Keyword match** — you've got 25 high-intent keywords. Don't add irrelevant ones; npm penalizes spam.
3. **Downloads** — circular but that's the bigger ranking signal. Distribution unlocks SEO, not the other way around.
4. **README quality** — Google indexes npmjs.com pages heavily. Long-tail traffic ("openai cost limit nodejs") will come, but over months.
5. **Maintenance signals** — recent publish date, low open-issue ratio, semver discipline.

What does NOT help: keyword stuffing the README, fake reviews, buying downloads.

---

## Anti-pattern: download manipulation

Don't do it. npm and bundle analyzers detect it; you'll lose all credibility with engineers — your actual audience. Real downloads from real installs compound; gamed numbers don't.

---

## After week one

- 50 GitHub stars → submit to "trending TypeScript" newsletters.
- 200 stars → reach out to Vercel AI SDK / LangChain JS to be listed as an integration.
- 500 stars → consider a hosted version (`budgetguard.dev` SaaS) — but only if usage signals demand.
