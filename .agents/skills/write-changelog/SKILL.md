---
name: write-changelog
description: Write Otter Mail's changelog note for a Mac and web release (changelog/<version>.md), in the house style after conductor.build/changelog - a few-word title, a one-line lead, a screenshot or two, short bullets. The changelog is marketing, so whether a release gets a note is the user's call; ask before a release, never assume. Use before running the Release workflow, or when asked for release notes or a changelog entry.
---

# Write a changelog note

The changelog is how Otter Mail announces itself: marketing and brand as much
as a record. Notes live in `changelog/<version>.md` at the repository root.
The site shows them at https://mail.otterware.app/changelog (an index, and a
page per release) and the app in Settings → What's new; after an update the
app offers the newest note since the one you last saw. The format lives in
`packages/shared/src/changelog.ts`.

The iPhone app releases on its own (TestFlight) and isn't in this changelog.

## Whether to write one

The user decides, release by release; there's no rule. Before running a
release, say what's in it and ask whether it's worth announcing, with a draft
when it might be. Never add a note unasked.

- Usually worth it: something new people would notice, want to try, or show
  someone. Those tend to be `minor` bumps (0.6.0), with a screenshot.
- Usually not: fixes, polish, internal work. Those ship as a `patch` with no
  note; gaps in the list are normal (conductor.build skips plenty).
- Unannounced changes can join a later note: it's named for the version it
  ships in and can mention anything since the last note.
- The bump (patch or minor) is the user's call too; suggest, don't decide.

## When

Write it before running the Release workflow, in the pull request that lands
the work or in one of its own. The file is named for the version it ships in:
the latest `vX.Y.Z` tag bumped the way the release will bump it.
`gh release list --limit 1` shows the latest.

A note for a version not released yet stays hidden: the site and the app show
only versions up to their own. So it's safe on `main` ahead of the release.

## The file

```markdown
---
title: A smarter ⌘K
date: 2026-09-30
---

Type what you want and Enter does it: commands you name come first, and mail search is one ↓ away.

![⌘K with "sync" typed: Sync now first, then the mail search](images/0.5.11-command-palette.webp)

## Improved

- ⌘K ranks what you type: "set" finds Settings, "work" your Work mailbox.
- Searches like `from:maya` still go straight to your mail.

## Fixed

- The setup no longer nudges sideways as a step settles.
```

- **title**: two to four words naming the release's headline, in sentence case,
  no period. The feature, not the version ("Onboarding", "A smarter ⌘K").
- **date**: the release day, `YYYY-MM-DD`.
- **Lead**: one sentence, two at most, saying what someone can do now. Plain
  words, no marketing ("powerful", "seamless", "we're excited").
- **Images** (optional, up to three): `![Caption](images/<version>-<slug>.webp)`.
  The alt text is shown as the caption, so write it as one: what's on screen.
- **Sections**, only those with something in them, in this order:
  `## New`, `## Improved`, `## Fixed`. A release with one change can skip
  headings and be the lead and a bullet or two.

## Bullets

- One line each, about fifteen words at most. What changed for the person
  using the app, not how it was built.
- Start with the thing or the change: "⌘K ranks …", "Hermes connects …",
  "Mail from shared hosts signs in …".
- Name where it applies when it isn't everywhere: "On the Mac, …",
  "In the web app, …".
- Keys as the app shows them (⌘K, ⇧⌘O), UI names as they read on screen, in
  plain quotes when it helps ("Take the tour").
- Leave out what nobody using the app would notice: refactors, CI, tests,
  internal renames. Something like "Mac releases are Apple Silicon only" is
  noticed, so it belongs.
- Three to eight bullets in all. If there's more, keep the ones people will
  feel and drop the rest.

## Screenshots

- From the demo mailbox (`pnpm dev:demo`, see the test-otter-mail skill),
  never real mail, at a 1600x1000 viewport. Dark is the default; light is fine
  when the feature is about appearance.
- Crop to the feature when the whole window isn't the point.
- Save as WebP (quality about 80) under `changelog/images/`, named
  `<version>-<slug>.webp`, around 100 KB or less. They ship inside the app.

## Check it

- Site: `pnpm --filter @otter-mail/site build`, then open
  `site/dist/changelog/index.html` and the release's page.
- App: Settings → What's new (a dev build shows notes up to its own version,
  the one in `apps/desktop/package.json`).
- `pnpm --filter @otter-mail/site test`: every note parses and every image it
  shows exists.
