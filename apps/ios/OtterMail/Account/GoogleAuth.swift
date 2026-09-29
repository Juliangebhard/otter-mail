import AuthenticationServices
import CryptoKit
import Foundation

/**
 * Google sign-in, per mailbox, as the Mac app does it: the installed-app flow
 * (RFC 8252) with PKCE, in a browser sheet. The "iOS" OAuth client has no
 * secret and Google returns to its reversed id. Refresh tokens stay in the
 * Keychain and never leave the phone; access tokens are kept in memory and
 * renewed a minute before they expire.
 */
@MainActor
final class GoogleAuth {
    /**
     * The otter-mail project's "iOS" client for this build's bundle ID (not a
     * secret; the relay lists it too), from Info.plist's GoogleClientID.
     */
    static let clientID = Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String ?? ""
    /**
     * Gmail, its settings (saving a signature) and who you are; no calendar or
     * contacts, which the iPhone app doesn't use. Sign-ins from before the
     * settings scope can't save signatures until signed in again.
     */
    static let scopes = [
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/gmail.settings.basic",
        "openid", "email", "profile",
    ]

    struct Tokens {
        var accessToken: String
        var idToken: String?
        var expiresAt: Date
    }

    struct Profile: Decodable {
        var email: String
        var name: String?
        var picture: String?
    }

    enum Failure: LocalizedError {
        case cancelled
        /** Google no longer honors the sign-in (revoked or expired): only signing in again helps. */
        case signedOut(String)
        case google(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: "Sign-in was cancelled."
            case .signedOut(let email): "\(email) needs to sign in to Google again."
            case .google(let message): message
            }
        }
    }

    private var tokens: [String: Tokens] = [:]
    private var refreshing: [String: Task<Tokens, Error>] = [:]
    private let presenter = Presenter()

    private static var redirectScheme: String { clientID.split(separator: ".").reversed().joined(separator: ".") }
    private static var redirectURI: String { "\(redirectScheme):/oauth2redirect" }
    private static func refreshKey(_ email: String) -> String { "google-refresh-token:\(email.lowercased())" }

    func isSignedIn(_ email: String) -> Bool { Keychain.get(Self.refreshKey(email)) != nil }

    /** Opens Google's sign-in; keeps the refresh token for the address it signed in. */
    func signIn(loginHint: String? = nil) async throws -> (profile: Profile, tokens: Tokens) {
        let verifier = Self.randomURLSafe(32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = Self.randomURLSafe(16)
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            .init(name: "client_id", value: Self.clientID),
            .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: Self.scopes.joined(separator: " ")),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "consent select_account"),
        ] + (loginHint.map { [.init(name: "login_hint", value: $0)] } ?? [])

        let callback = try await presenter.authenticate(url: components.url!, scheme: Self.redirectScheme)
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value }
        if value("error") == "access_denied" { throw Failure.cancelled }
        guard value("state") == state, let code = value("code") else {
            throw Failure.google(value("error") ?? "Google sign-in didn't finish.")
        }

        let response = try await Self.tokenRequest([
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": Self.redirectURI,
        ])
        guard let refreshToken = response.refresh_token else {
            throw Failure.google("Google did not return a refresh token. Try again.")
        }
        let tokens = Tokens(response)
        let profile = try await Self.profile(accessToken: tokens.accessToken)
        Keychain.set(Self.refreshKey(profile.email), refreshToken)
        self.tokens[profile.email.lowercased()] = tokens
        return (profile, tokens)
    }

    /** A fresh access token for the mailbox (`force`: not the one Gmail just refused). */
    func accessToken(_ email: String, force: Bool = false) async throws -> String {
        if !force, let cached = tokens[email.lowercased()], cached.expiresAt > .now { return cached.accessToken }
        return try await refresh(email).accessToken
    }

    /** A fresh ID token, the proof the relay asks for to link a mailbox. */
    func idToken(_ email: String) async throws -> String {
        if let cached = tokens[email.lowercased()], cached.expiresAt > .now, let id = cached.idToken { return id }
        guard let id = try await refresh(email).idToken else { throw Failure.google("Google didn't return an ID token.") }
        return id
    }

    /** Forgets the mailbox here and asks Google to end its sign-in. */
    func signOut(_ email: String) async {
        let key = Self.refreshKey(email)
        if let refreshToken = Keychain.get(key) {
            var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Self.form(["token": refreshToken])
            _ = try? await URLSession.shared.data(for: request)
        }
        Keychain.set(key, nil)
        tokens[email.lowercased()] = nil
    }

    private func refresh(_ email: String) async throws -> Tokens {
        let key = email.lowercased()
        if let running = refreshing[key] { return try await running.value }
        let task = Task { () throws -> Tokens in
            guard let refreshToken = Keychain.get(Self.refreshKey(email)) else { throw Failure.signedOut(email) }
            do {
                return Tokens(try await Self.tokenRequest(["grant_type": "refresh_token", "refresh_token": refreshToken]))
            } catch Failure.google("invalid_grant") {
                Keychain.set(Self.refreshKey(email), nil)
                throw Failure.signedOut(email)
            }
        }
        refreshing[key] = task
        defer { refreshing[key] = nil }
        let fresh = try await task.value
        tokens[key] = fresh
        return fresh
    }

    // ── Google's endpoints ───────────────────────────────────────────────────

    fileprivate struct TokenResponse: Decodable {
        var access_token: String?
        var expires_in: Double?
        var refresh_token: String?
        var id_token: String?
        var error: String?
    }

    private static func tokenRequest(_ params: [String: String]) async throws -> TokenResponse {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = form(params.merging(["client_id": clientID]) { a, _ in a })
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(TokenResponse.self, from: data)
        if let error = response.error { throw Failure.google(error) }
        guard response.access_token != nil else { throw Failure.google("Google didn't return a token.") }
        return response
    }

    private static func profile(accessToken: String) async throws -> Profile {
        var request = URLRequest(url: URL(string: "https://www.googleapis.com/oauth2/v3/userinfo")!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.google("Couldn't read the Google profile.")
        }
        return try JSONDecoder().decode(Profile.self, from: data)
    }

    private static func form(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return Data(params.map { "\($0)=\($1.addingPercentEncoding(withAllowedCharacters: allowed) ?? $1)" }
            .joined(separator: "&").utf8)
    }

    private static func randomURLSafe(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes).base64URL
    }

    /** Runs the browser sheet over the app's window. */
    private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
        func authenticate(url: URL, scheme: String) async throws -> URL {
            try await withCheckedThrowingContinuation { continuation in
                let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { url, error in
                    if let url { return continuation.resume(returning: url) }
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    continuation.resume(throwing: cancelled ? Failure.cancelled : Failure.google(error?.localizedDescription ?? "Sign-in failed."))
                }
                session.presentationContextProvider = self
                session.start()
            }
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scenes[0])
        }
    }
}

private extension GoogleAuth.Tokens {
    init(_ response: GoogleAuth.TokenResponse) {
        self.init(
            accessToken: response.access_token ?? "",
            idToken: response.id_token,
            expiresAt: .now.addingTimeInterval((response.expires_in ?? 3600) - 60)
        )
    }
}

nonisolated extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URL: String) {
        var s = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        s += String(repeating: "=", count: (4 - s.count % 4) % 4)
        self.init(base64Encoded: s)
    }
}
