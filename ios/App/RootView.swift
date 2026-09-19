import SwiftUI

struct RootView: View {
    @ObservedObject var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if let token = model.token {
                WebAppView(token: token, route: model.route)
                    .ignoresSafeArea()
                    .overlay(alignment: .topTrailing) {
                        if model.snapshot.bankNeedsReauth {
                            Label("Reconectar Cajamar", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(.ultraThinMaterial, in: Capsule())
                                .padding(.top, 8)
                                .padding(.trailing, 12)
                                .onTapGesture { model.route = .money }
                        }
                    }
                    .task { await model.refreshQuietly(force: true) }
            } else {
                ActivationView(model: model)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, model.isActivated else { return }
            Task { await model.refreshQuietly() }
        }
    }
}
