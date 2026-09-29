import Foundation
import Security

/** Secrets on this iPhone: the Otter session, each mailbox's Google refresh token or IMAP password. */
enum Keychain {
    private static let service = "dev.otterware.mail"

    static func get(_ key: String) -> String? {
        var result: AnyObject?
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
        ]
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /** Keeps `value` (readable after the first unlock, for background refresh); `thisDeviceOnly` leaves it out of backups. */
    static func set(_ key: String, _ value: String?, thisDeviceOnly: Bool = false) {
        let query = query(key)
        SecItemDelete(query as CFDictionary)
        guard let value else { return }
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = thisDeviceOnly ? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly : kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
    }

    /** Moves an item kept before to this device alone (a no-op when there's none). */
    static func makeThisDeviceOnly(_ key: String) {
        let change = [kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemUpdate(query(key) as CFDictionary, change as CFDictionary)
    }

    private static func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
