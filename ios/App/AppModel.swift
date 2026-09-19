import Foundation
import SwiftUI
import WidgetKit

@MainActor
final class AppModel: ObservableObject {
    @Published var token: String? = SharedStore.deviceToken
    @Published var isWorking = false
    @Published var errorMessage: String?
    @Published var route: AppRoute = .today
    @Published var snapshot: WidgetSnapshot = SharedStore.snapshot()

    private let api = SecondMindAPI()
    private var lastRefresh: Date?

    var isActivated: Bool { token != nil }

    func activate(code: String) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let newToken = try await api.activate(code: code)
            SharedStore.deviceToken = newToken
            token = newToken
            try await refresh(force: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh(force: Bool = false) async throws {
        guard token != nil else { return }
        if !force, let lastRefresh, Date().timeIntervalSince(lastRefresh) < 5 * 60 { return }
        let value = try await api.refreshSnapshot(token: token)
        snapshot = value
        self.lastRefresh = .now
        WidgetCenter.shared.reloadAllTimelines()
    }

    func refreshQuietly(force: Bool = false) async {
        do { try await refresh(force: force) }
        catch { if force { errorMessage = error.localizedDescription } }
    }

    func signOutNativeLayer() {
        SharedStore.reset()
        token = nil
        snapshot = .empty
        lastRefresh = nil
        WidgetCenter.shared.reloadAllTimelines()
    }

    func handle(url: URL) {
        guard url.scheme == "segundamente" else { return }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let raw = components?.queryItems?.first(where: { $0.name == "view" })?.value ?? url.host ?? "hoy"
        route = AppRoute(rawValue: raw) ?? .today
    }
}

enum AppRoute: String, CaseIterable {
    case today = "hoy"
    case mind = "mente"
    case money = "dinero"
    case gym = "gym"
    case week = "semana"

    var javascript: String {
        switch self {
        case .today: return "if(window.go){go('hoy')}"
        case .mind: return "if(window.go){go('mente',{focusComposer:true})}"
        case .money: return "if(window.go){go('dinero')}"
        case .gym: return "document.querySelector('.nav button[data-view=\\"gym\\"]')?.click()"
        case .week: return "document.querySelector('[data-week-open]')?.click() || (window.go&&go('hoy'))"
        }
    }
}
