# First run: measured (#36)

The sub-2-minute first run is the core differentiator. This is the measurement
and the friction log behind it.

## The happy path

```bash
npm i -g @keyline/cli   # interim; curl|sh + Homebrew land with #37
keyline login           # two questions: workspace name, email
cd my-app
keyline link            # project = folder name
keyline push            # .env encrypted on your machine, uploaded
```

A teammate's version is `login → link → pull`. Same three commands.

## Measurement (2026-07-07)

Method: compiled CLI, clean `$HOME`, local API, interactive login driven by
`expect` with human-ish pauses. Scripted, repeatable.

| Step | Wall time |
|---|---|
| login (incl. typing two answers) | ~0.5 s |
| link + push + pull | ~0.2 s |
| **All commands** | **0.74 s** |

Human budget on top: `npm i -g` ~20–30 s, reading + typing ~30 s.
**Total ≈ 60 s. Target < 120 s: met**, with headroom for the #37 installer.

Zero failed commands and zero new concepts on the happy path: no init, no
config file, no token copy-paste, no dashboard visit.

## Friction found → fixed

| Friction | Fix |
|---|---|
| Naive `keyline login` (a user's very first command) errored, demanding `--workspace` and `--email` flags | TTY: asks the two questions inline. Flags still work; non-TTY keeps the explicit error for scripts |
| Naive `keyline link` errored: `missing required argument 'project'` | Project argument optional — defaults to the folder name (printed as such) |
| `login` next-step hint pointed at `link <project> --env <env>` placeholders | Hints now name the literal next commands: `keyline link`, `keyline push` |

## Still on the path (tracked)

- #37: real install (`curl | sh`, Homebrew, npm) — the install step dominates the budget.
- #66: teammate join flow — an invited member can't yet enroll a device from the CLI.
