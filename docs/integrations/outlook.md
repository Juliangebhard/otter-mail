# Outlook mail on the desktop

Otter Mail connects Outlook.com and Microsoft 365 mailboxes through Microsoft's OAuth sign-in,
then uses IMAP to read and SMTP to send. The mail cache, folders and drafts use the same provider
as other IMAP mailboxes. Microsoft tokens stay on this computer in the desktop secret store; the
Otter relay receives the mailbox address and server settings, never the tokens or mail.

## Microsoft app registration

1. Register an application in Microsoft Entra with account types that include organizational and personal Microsoft accounts.
2. Add **Mobile and desktop applications** with redirect URI `http://localhost`.
3. Add delegated **Office 365 Exchange Online** permissions `IMAP.AccessAsUser.All` and `SMTP.Send`.
4. Set `OTTER_MAIL_MICROSOFT_CLIENT_ID` in the environment or the repo's ignored `.env.local`, then rebuild the desktop app. This is a public client ID; no client secret is used.

The sign-in requests `offline_access` so the desktop can refresh the access token. Users must
consent to the requested permissions. Microsoft 365 tenants may also require an administrator's
consent or permission for IMAP and SMTP AUTH. Outlook.com users must enable IMAP access in Outlook
settings. Otter Mail verifies both IMAP and SMTP before adding the mailbox, so an unavailable
server does not leave a half-connected account.

Outlook.com uses `outlook.office365.com:993` for IMAP and `smtp-mail.outlook.com:587` for SMTP.
Microsoft 365 uses `outlook.office365.com:993` and `smtp.office365.com:587`. A linked mailbox
on another desktop asks for Microsoft sign-in there. Browser and iPhone sign-in are not yet
available.

Microsoft references: [IMAP/SMTP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [Outlook.com server settings](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com), [authorization code with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
