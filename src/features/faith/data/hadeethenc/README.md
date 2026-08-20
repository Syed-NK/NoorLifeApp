# HadeethEnc integration boundary

This directory contains the validated HadeethEnc response adapter. It does **not** enable Hadith in
the application.

Production remains on `createUnconfiguredHadithRepository()` until NoorLife records written
confirmation covering its mobile-app use. In particular, the response adapter must not be imported
by `faith-repository-context.tsx`, and `PERMITTED_HADITH_PROVIDERS` remains empty.

Before production wiring, the provider response must travel through a NoorLife server boundary. A
direct mobile request would disclose the device IP and the narration being read to the provider, and
would make provider changes depend on an app-store release. The server boundary must allow-list the
three operations modelled in `HadeethEncRequest`, validate every response before returning it, avoid
logging query data or content, and attach the approved translation-version metadata.

The adapter deliberately models HadeethEnc's roots as **topics**, not collections. HadeethEnc is an
encyclopedia organised by subject; representing a topic as “Sahih al-Bukhari” or another canonical
book would be a false provenance claim.
