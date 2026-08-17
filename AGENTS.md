# FleetSettle Codex Instructions

This file is the Codex entrypoint. It does not replace `CLAUDE.md` — read
[CLAUDE.md](CLAUDE.md) first, in full. Everything Codex needs (the read
order, the money/time/tenancy/write rules, the interface rules, the
commands) lives there.

**No second copy here, deliberately** — `.claude/rules/docs.md`'s own reason
("two copies of a rule become two different rules") applies to a tool
entrypoint exactly as it does to a specification document. This file used to
restate CLAUDE.md's read order and core rules in full; that copy drifted out
of date (it described `TRACKER.md`/`Plan.md` priority as fixed relative to
`docs/` without ever tracking the phase model or the wave plan CLAUDE.md
itself points at) while nothing kept the two in sync. Corrected 17 August
2026, during the Wave 8b document-disposition pass.

If a Codex-specific behaviour is ever genuinely needed — something true of
running as Codex and not of running as any other agent — it belongs here,
stated once, pointing at CLAUDE.md for everything else. Nothing like that
exists yet.
