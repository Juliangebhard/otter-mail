# Otter Mail for iPhone

A native SwiftUI app (iOS 27, Liquid Glass), the sibling of the Mac and web apps (`apps/desktop` and
`apps/web`, one TypeScript app). It shares their Otter account, mailboxes, themes and settings, not
their code.

## Design

- **ChatGPT's frame.** The mail list is the page; a swipe from the left slides it aside to
  show the drawer: a page per mailbox (All first) that you swipe through, as on the desktop, each
  with its folders and labels, then Compose and Settings. Settings is ChatGPT's grouped sheet.
- **Otter Code's rows.** Who and when, the subject, a line of the latest message; the mailbox's mark
  in All mailboxes. Swipe for read, archive and trash; long-press for the rest.
- **iOS's own bars.** The list's bottom bar (assistant, search, compose) and the reader's buttons are
  the system's glass toolbar. Replying starts from a glass field at the bottom, like ChatGPT's
  composer.
- **Every theme.** The themes are the desktop's (`Resources/Themes.json`), light and dark, blended
  the same way (`Theme/Theme.swift`).

## How it works

Like the Mac app, the phone signs in to Google itself and talks to Gmail directly; the relay
never sees its mail or tokens.

- `Account/GoogleAuth.swift`: Google sign-in per mailbox with the otter-mail project's "iOS" OAuth
  client (no secret; PKCE; Google returns to the client ID's reversed form). Refresh tokens stay in
  the Keychain.
- `Account/Relay.swift`: the Otter relay (`packages/contracts/src/relay.ts`). Signing in hands it
  the Google ID token (the relay accepts the iOS client's, see `GOOGLE_IOS_CLIENT_ID`); then the
  linked mailboxes, the preferences, and the `/v1/events` socket while the app is open.
- `Account/Session.swift`: the demo or the signed-in account, and keeping it in step: mailboxes
  linked on any device show here (signed out until this phone signs in to them), preferences sync
  both ways under the other apps' keys (`ui` and `settings` sections), relay events trigger syncs.
- `Gmail/`: the Gmail API (`GmailAPI.swift`), messages out (`MIME.swift`), and sync
  (`MailSync.swift`): history-based, local-first, cached on disk, changes shown at once then
  written to Gmail. `users.watch` is renewed daily so pushes reach the relay.
- `Assistant/`: the assistant, as on the desktop. Hermes (`Hermes.swift`) runs anywhere, so it
  runs here: the same server-side chats, model and key (the `assistant` preferences section and
  the sealed `hermesKey` follow the Otter account). Conversations go to it as pointers, the
  desktop's "context from Otter Mail" block; the agent reads the mail itself. Codex and Claude are
  local agents on the Mac, listed but off.
- `Mail/`: the model and `MailStore`, which screens render from. `DemoMail.swift` loads the demo.
- `Home/`, `Reader/`, `Compose/`, `Settings/`: the screens.

Also: Apple's on-device Translation (on request, or automatically for languages you don't read),
background refresh with notifications (Settings › Notifications) and the unread badge,
attachments in Quick Look, one-click unsubscribe, and signatures edited as Gmail keeps them.

## Running

```sh
pnpm dev:ios               # build, then run in the simulator (production relay)
pnpm dev:ios --relay local # against `pnpm dev`'s relay on :8787
```

Or open `OtterMail.xcodeproj` in Xcode (27 or later). The welcome screen offers the demo mailbox,
the same pretend mail as `pnpm dev:demo`; build and test against it rather than real accounts.

Debug builds are `dev.otterware.mail.dev`, release builds `dev.otterware.mail`. The Google "iOS"
client is registered for the former. The project signs with team 838JVGY7W4; to run on your
iPhone, pick it in Xcode, or from the command line:

```sh
xcodebuild -project apps/ios/OtterMail.xcodeproj -scheme OtterMail -destination 'platform=iOS,id=<udid>' \
  -derivedDataPath apps/ios/.build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <udid> "apps/ios/.build/Build/Products/Debug-iphoneos/Otter Mail.app"
```

(`xcrun devicectl list devices` gives the UDID. Without an Apple account signed in to Xcode, add
`-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID` with an App Store Connect
API key.)

`Resources/Themes.json` and `Resources/DemoMailboxes.json` are exported from `apps/web` by
`pnpm ios:resources` (`dev:ios` runs it); rerun it after changing the palettes or the demo seed.
