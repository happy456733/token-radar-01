# Token Radar

A token launch radar: every protocol that records no token in the sealed
DefiLlama snapshot, ranked by what its token would be worth if it launched
one — plus a concrete farm plan for each.

## What it does

`main.ts` (Node 22+, standard library only) reads `/input/snapshot.json`,
scores every pre-token protocol, and writes to `/output`:

- `board.json` — 300 ranked rows (the 40-protocol watchlist plus 260 early
  pre-token finds below the $50M floor), each with an implied value and six
  farm steps.
- `data.js` — the same board in compact form for the dashboard.
- `dashboard/` — a static, zero-network page: sortable + filterable board,
  a detail view per protocol (valuation breakdown + farm plan), a separate
  Live Tokens view, and a Value Model view.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `dossier.json` — built with the vendored make.fun library.

## The value model (radar-2-comparables)

Nothing is special-cased by name. Implied value is derived only from the
snapshot's own figures:

```
implied = TVL × category multiple × growth multiplier × tenure multiplier
```

- **Category multiple** — the median market-cap-per-TVL of the live-token
  protocols in the same category, taken from this snapshot (global median
  where a category has fewer than 3 live comparables), clamped to
  [0.05, 1.50]. The market prices each line of business itself.
- **Growth multiplier** — the protocol's 7-day TVL change, clamped to
  [-40%, +100%], at weight 0.7.
- **Tenure multiplier** — how long the protocol has run with no token
  (from `listed_at`): 0.75 for a brand-new listing rising to 1.20 after four
  years; 0.90 when the listing date is unknown.

Live-token protocols are never ranked: the dashboard shows them at their
market cap, in a separate view, as the comparables the model is priced from.

## Farm plans

Six steps per protocol, generated from its own record (category, chains,
TVL, age): the core action for its category, weekly qualifying activity, a
hold period that grows for younger protocols, claiming only from the
protocol's own published link, and a written farm log. Each step states what
it costs and how long it takes.

## Honesty notes

A protocol on this board *records* no token in DefiLlama's data — that is not
proof it has none, and the board never predicts whether or when a token is
issued. Implied values are this radar's own claim, not make.fun's.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
```

## License

MIT — see `LICENSE`.
