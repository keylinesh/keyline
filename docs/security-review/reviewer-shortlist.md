# Reviewer Shortlist

Candidate firms and independents for the crypto design + implementation review.
All do applied-cryptography / protocol work and publish reports. Final selection
and engagement is a founder decision (budget + availability); this list exists so
that decision is fast and informed.

## Selection criteria

- Track record in **applied cryptography and protocol review** (not just web pentest).
- Experience with **client-side / end-to-end encryption** products.
- Willing to review a **small, well-scoped Node/TypeScript** codebase.
- Publishes (or will let us publish) the report — supports our "verifiable, not
  asserted" stance.
- Turnaround and cost fit an early-stage budget.

## Candidates

| Firm | Why them | Notes |
|---|---|---|
| **Trail of Bits** | Deep applied-crypto practice; reviews E2EE systems; strong public reports. | Likely higher cost; premium signal. |
| **NCC Group (Cryptography Services)** | Dedicated crypto group; many published E2EE/protocol audits. | Established, broad availability. |
| **Cure53** | Fast, thorough; many published reports on privacy/E2EE tools. | Good fit for a small scoped review. |
| **Least Authority** | Focus on privacy and zero-knowledge / E2EE systems specifically. | Mission-aligned with our ZK claim. |
| **Kudelski Security** | Strong cryptography team; protocol and implementation review. | Good for crypto-construction questions. |
| **Independent applied cryptographer** | Lower cost; can be excellent for a focused design review. | Vet references; less brand signal than a firm. |

## Recommended next step

Send the **two-paragraph engagement email** (below) to the top 2–3 with the scope
link, and pick on responsiveness, relevant published work, turnaround, and quote.

> Subject: Crypto design + implementation review — small E2EE secrets manager
>
> We're building Keyline, a zero-knowledge secrets manager for small dev teams.
> The client-side encryption (AES-256-GCM, scrypt, X25519 sealed-box envelopes)
> is implemented and tested in a ~600-line Node/TypeScript package, with a public
> design doc and threat model. Before we make any public "we can't read your
> secrets" claim, we want an independent review.
>
> Scope, questions, and the runnable prototype are in our review packet
> [link]. Could you share availability, rough turnaround, and a quote for a
> design + implementation review of this scope?

_Inclusion here is a research shortlist, not an endorsement or an existing
relationship._
