# ChatGPT Project Setup for DEMAC

The root [`AGENTS.md`](../../AGENTS.md) is the single source of truth for DEMAC's AI
engineering workflow. Codex reads it automatically when working inside the repository.

To keep normal ChatGPT chats aligned, create or use one ChatGPT Project for DEMAC, connect
the `demac-aruba/demac-corporation` GitHub repository as a project source, and paste the
following into that project's instructions:

> For every DEMAC ERP request, first read the current root `AGENTS.md` from the connected
> `demac-aruba/demac-corporation` repository and treat it as the canonical engineering
> protocol. Default to **Fast Product Validation**. Use **Deep Review** only when the owner
> explicitly requests an audit/refactor/optimization/hardening pass or when `AGENTS.md`
> classifies the change as high risk. Do not invent a different workflow. If the current
> `AGENTS.md` is unavailable, ask the user to attach or reconnect it before changing code.

Do not copy the full protocol into ChatGPT Project instructions. Keeping the detailed rules
in `AGENTS.md` prevents the Codex and ChatGPT versions from drifting apart.
