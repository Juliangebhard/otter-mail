# Draft PR: Add Outlook and Microsoft 365 mail to the desktop app

The code is pushed to `feat/outlook-mail`. [Open a draft PR from this branch](https://github.com/Juliangebhard/otter-mail/pull/new/feat/outlook-mail), then copy the **PR description** section below into its body.

## PR description

### Summary

This adds a desktop-first Outlook mail connection to Otter Mail. Users can choose Outlook during onboarding or when adding a mailbox, sign in through Microsoft's system-browser OAuth flow, and use the existing mail UI with IMAP for reading and SMTP for sending. The Outlook option now shows the Outlook logo.

### Implementation

- Uses an authorization-code flow with PKCE, a localhost callback, and delegated `IMAP.AccessAsUser.All`, `SMTP.Send`, and `offline_access` scopes.
- Authenticates IMAP and SMTP with XOAUTH2. Access tokens are refreshed locally; refresh tokens stay in the desktop secret store.
- Verifies both mail connections before saving an account, supports reconnecting on a device, and removes local tokens when the mailbox is removed.
- Keeps the relay limited to mailbox identity and server settings; it does not receive Microsoft tokens.
- Enables the feature in the macOS/Linux desktop app. Browser and iPhone Outlook sign-in are outside this PR.

### Verification completed

- `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, `pnpm build`, and the full `pnpm test` suite pass with Node 24.13.1, the repository's supported runtime.
- The desktop onboarding UI was opened locally and the Outlook card and logo were visually checked.
- The OAuth callback/refresh and relay-settings tests are included in the passing suite.

### Required before merge

1. Register a Microsoft Entra **public client** that supports both organizational and personal Microsoft accounts. Add the **Mobile and desktop applications** redirect URI `http://localhost`, enable public-client flows, and grant the delegated **Office 365 Exchange Online** IMAP and SMTP permissions. The code requests `offline_access` for token renewal. [Microsoft desktop configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration), [IMAP/SMTP OAuth scopes](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).
2. Set `OTTER_MAIL_MICROSOFT_CLIENT_ID` for the local app or build. No Microsoft client secret is needed. The cloned checkout currently has no client ID, so a live Microsoft sign-in has **not** been tested.
3. Test an Outlook.com mailbox and a Microsoft 365 mailbox end to end: sign-in, initial sync, reading, sending, token refresh, app restart, reconnect on another desktop, and removal. Confirm that neither tokens nor mail are sent to the relay.
4. Check the Microsoft 365 test mailbox's IMAP and SMTP AUTH policy. Some tenants disable SMTP AUTH, which this implementation needs to send mail and currently verifies before adding an account. Decide whether a later Microsoft Graph path is needed for broader tenant support. [Microsoft SMTP AUTH settings](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission).
5. Review the PR and pass CI on the supported Node version before merging.

### Review note

This is ready as a **draft PR** so others can review and continue development in parallel. The live mailbox checks above are the release gate; the UI and automated tests alone do not establish that Outlook works for real accounts.

---

## Message to share with the team after opening the PR

I've opened a draft PR for desktop Outlook/Microsoft 365 mail support: **<PR link>**. The implementation, UI, and automated tests are in place, and the full suite passes on Node 24. We can continue building on this branch now. The remaining validation is a real Microsoft sign-in and receive/send test, which needs an Entra public-client ID and a test mailbox. Microsoft 365 tenants may also need IMAP and SMTP AUTH enabled. Please keep the PR in draft until those live checks and review are complete.
