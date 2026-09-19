import SwiftUI

@main
struct SegundaMenteApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .onOpenURL { model.handle(url: $0) }
        }
    }
}
