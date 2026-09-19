import Foundation

struct SecondMindAPI {
    static let functions = URL(string: "https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1")!

    enum APIError: LocalizedError {
        case missingToken
        case badResponse(Int, String)
        case invalidActivation

        var errorDescription: String? {
            switch self {
            case .missingToken: return "Este iPhone todavía no está vinculado."
            case .invalidActivation: return "Ese código ya no sirve. Necesitas uno nuevo."
            case let .badResponse(_, message): return message
            }
        }
    }

    private let session: URLSession
    init(session: URLSession = .shared) { self.session = session }

    func activate(code: String) async throws -> String {
        var request = URLRequest(url: Self.functions.appending(path: "ios-activate"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code.trimmingCharacters(in: .whitespacesAndNewlines), "label": "iPhone nativo"])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse(0, "Respuesta inválida del servidor.") }
        let decoded = try? JSONDecoder().decode(ActivationResponse.self, from: data)
        guard (200..<300).contains(http.statusCode), decoded?.ok == true, let token = decoded?.deviceToken, !token.isEmpty else {
            if http.statusCode == 401 { throw APIError.invalidActivation }
            throw APIError.badResponse(http.statusCode, decoded?.error ?? "No pude vincular este iPhone.")
        }
        return token
    }

    func refreshSnapshot(token: String? = SharedStore.deviceToken) async throws -> WidgetSnapshot {
        guard let token, !token.isEmpty else { throw APIError.missingToken }

        async let mind: MindResponse = request(path: "mind", token: token)
        async let gym: GymResponse = request(path: "gym", token: token)
        async let money: MoneySummaryResponse = request(path: "money", token: token)
        async let bank: BankResponse = request(path: "bank", token: token, method: "POST", body: ["action": "sync", "force": false])

        let (mindValue, gymValue, moneyValue, bankValue) = try await (mind, gym, money, bank)
        let snapshot = buildSnapshot(mind: mindValue, gym: gymValue, money: moneyValue, bank: bankValue)
        SharedStore.save(snapshot: snapshot)
        return snapshot
    }

    private func request<T: Decodable>(path: String, token: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: Self.functions.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse(0, "Respuesta inválida del servidor.") }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let detail = object?["detail"] as? String ?? object?["error"] as? String ?? "No pude actualizar Segunda Mente."
            throw APIError.badResponse(http.statusCode, detail)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func buildSnapshot(mind: MindResponse, gym: GymResponse, money: MoneySummaryResponse, bank: BankResponse) -> WidgetSnapshot {
        let now = Date()
        let active = mind.captures.filter { $0.archivedAt == nil && $0.completedAt == nil && ($0.kind == "task" || $0.kind == "event") }
        let future = active.compactMap { c -> (MindCapture, Date)? in
            guard let due = ISODate.parse(c.dueAt), due >= now.addingTimeInterval(-300) else { return nil }
            return (c, due)
        }.sorted { $0.1 < $1.1 }
        let nextCapture = future.first?.0 ?? active.first
        let nextDue = future.first?.1

        let accounts = bank.bank?.accounts ?? []
        let bankBalance = accounts.reduce(0.0) { partial, account in
            partial + (account.availableBalance?.value ?? account.currentBalance?.value ?? 0)
        }
        let hasBalance = accounts.contains { $0.availableBalance != nil || $0.currentBalance != nil }

        let watermarkDates = accounts.compactMap { ISODate.parse($0.lastSyncedAt) }
        let watermark = watermarkDates.max()
        var effectiveBalance = bankBalance
        if let watermark {
            for capture in mind.captures where capture.archivedAt == nil {
                guard let amount = capture.amount?.value, let created = ISODate.parse(capture.createdAt), created > watermark else { continue }
                if capture.kind == "expense" { effectiveBalance -= amount }
                if capture.kind == "income" { effectiveBalance += amount }
            }
        }

        let calendar = Calendar(identifier: .gregorian)
        let weekday = calendar.component(.weekday, from: now) - 1 // mismo convenio que JavaScript: domingo = 0
        let scheduleConfigured = gym.schedule.contains { $0.dayId != nil }
        let assigned = gym.schedule.first { $0.weekday == weekday }?.dayId
        let gymTitle: String?
        if !scheduleConfigured { gymTitle = nil }
        else if let assigned { gymTitle = gym.days.first { $0.id == assigned }?.name ?? "Entreno" }
        else { gymTitle = "Descanso" }

        let top = money.categorias.first { $0.gastado.value > 0 }
        let syncError = bank.bank?.connection?.syncError ?? ""
        let needsReauth = bank.bank?.needsReauth == true || syncError == "reauth_required" || syncError.localizedCaseInsensitiveContains("session is expired")

        return WidgetSnapshot(
            generatedAt: now,
            nextTitle: nextCapture?.title ?? nextCapture?.rawText,
            nextDue: nextDue,
            balance: hasBalance ? effectiveBalance : nil,
            monthSpent: money.totalGastado.value,
            topCategory: top?.categoria,
            topCategorySpent: top?.gastado.value,
            gymTitle: gymTitle,
            bankNeedsReauth: needsReauth
        )
    }
}
