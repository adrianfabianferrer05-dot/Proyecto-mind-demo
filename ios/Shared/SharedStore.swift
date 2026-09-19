import Foundation

struct SharedStore {
    static let appGroup = "group.com.adrianfabianferrer.segundamente"
    private static let tokenKey = "native_device_token"
    private static let snapshotKey = "widget_snapshot_v1"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    static var deviceToken: String? {
        get {
            guard let value = defaults.string(forKey: tokenKey), !value.isEmpty else { return nil }
            return value
        }
        set {
            if let newValue, !newValue.isEmpty { defaults.set(newValue, forKey: tokenKey) }
            else { defaults.removeObject(forKey: tokenKey) }
        }
    }

    static func save(snapshot: WidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
    }

    static func snapshot() -> WidgetSnapshot {
        guard let data = defaults.data(forKey: snapshotKey),
              let value = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else {
            return .empty
        }
        return value
    }

    static func reset() {
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: snapshotKey)
    }
}
