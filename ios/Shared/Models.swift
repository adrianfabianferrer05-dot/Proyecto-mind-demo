import Foundation

struct FlexibleDouble: Codable, Hashable {
    let value: Double

    init(_ value: Double) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { value = d; return }
        if let i = try? c.decode(Int.self) { value = Double(i); return }
        if let s = try? c.decode(String.self), let d = Double(s) { value = d; return }
        value = 0
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

struct MindCapture: Codable, Hashable {
    let id: String
    let rawText: String?
    let kind: String
    let amount: FlexibleDouble?
    let category: String?
    let title: String?
    let dueAt: String?
    let createdAt: String
    let completedAt: String?
    let archivedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, amount, category, title
        case rawText = "raw_text"
        case dueAt = "due_at"
        case createdAt = "created_at"
        case completedAt = "completed_at"
        case archivedAt = "archived_at"
    }
}

struct MindResponse: Codable { let captures: [MindCapture] }

struct BankConnection: Codable {
    let status: String?
    let lastSyncedAt: String?
    let balanceSyncedAt: String?
    let syncError: String?

    enum CodingKeys: String, CodingKey {
        case status
        case lastSyncedAt = "last_synced_at"
        case balanceSyncedAt = "balance_synced_at"
        case syncError = "sync_error"
    }
}

struct BankAccount: Codable, Hashable {
    let displayName: String?
    let currentBalance: FlexibleDouble?
    let availableBalance: FlexibleDouble?
    let lastSyncedAt: String?

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case currentBalance = "current_balance"
        case availableBalance = "available_balance"
        case lastSyncedAt = "last_synced_at"
    }
}

struct BankPayload: Codable {
    let connection: BankConnection?
    let accounts: [BankAccount]?
    let needsReauth: Bool?

    enum CodingKeys: String, CodingKey {
        case connection, accounts
        case needsReauth = "needs_reauth"
    }
}

struct BankResponse: Codable { let bank: BankPayload? }

struct MoneyCategorySummary: Codable, Hashable {
    let categoria: String
    let gastado: FlexibleDouble
    let porcentaje: FlexibleDouble
}

struct MoneySummaryResponse: Codable {
    let totalGastado: FlexibleDouble
    let totalIngresado: FlexibleDouble
    let categorias: [MoneyCategorySummary]

    enum CodingKeys: String, CodingKey {
        case totalGastado = "total_gastado"
        case totalIngresado = "total_ingresado"
        case categorias
    }
}

struct GymDay: Codable, Hashable { let id: String; let name: String }
struct GymScheduleItem: Codable, Hashable {
    let weekday: Int
    let dayId: String?
    enum CodingKeys: String, CodingKey { case weekday; case dayId = "day_id" }
}
struct GymResponse: Codable {
    let days: [GymDay]
    let schedule: [GymScheduleItem]
}

struct ActivationResponse: Codable {
    let ok: Bool
    let deviceToken: String?
    let label: String?
    let error: String?
    enum CodingKeys: String, CodingKey { case ok, label, error; case deviceToken = "deviceToken" }
}

struct WidgetSnapshot: Codable, Hashable {
    var generatedAt: Date
    var nextTitle: String?
    var nextDue: Date?
    var balance: Double?
    var monthSpent: Double
    var topCategory: String?
    var topCategorySpent: Double?
    var gymTitle: String?
    var bankNeedsReauth: Bool

    static let empty = WidgetSnapshot(
        generatedAt: .now,
        nextTitle: nil,
        nextDue: nil,
        balance: nil,
        monthSpent: 0,
        topCategory: nil,
        topCategorySpent: nil,
        gymTitle: nil,
        bankNeedsReauth: false
    )
}

enum ISODate {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        return fractional.date(from: value) ?? plain.date(from: value)
    }
}
