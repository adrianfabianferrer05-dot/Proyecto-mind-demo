import SwiftUI
import WidgetKit

struct SecondMindEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct SecondMindProvider: TimelineProvider {
    func placeholder(in context: Context) -> SecondMindEntry {
        SecondMindEntry(date: .now, snapshot: WidgetSnapshot(
            generatedAt: .now,
            nextTitle: "Llamar al taller",
            nextDue: Calendar.current.date(byAdding: .hour, value: 1, to: .now),
            balance: 238.36,
            monthSpent: 312.40,
            topCategory: "Alimentación",
            topCategorySpent: 118.20,
            gymTitle: "Push",
            bankNeedsReauth: false
        ))
    }

    func getSnapshot(in context: Context, completion: @escaping (SecondMindEntry) -> Void) {
        completion(SecondMindEntry(date: .now, snapshot: SharedStore.snapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SecondMindEntry>) -> Void) {
        Task {
            let cached = SharedStore.snapshot()
            let snapshot: WidgetSnapshot
            if SharedStore.deviceToken != nil && Date().timeIntervalSince(cached.generatedAt) > 10 * 60 {
                snapshot = (try? await SecondMindAPI().refreshSnapshot()) ?? cached
            } else {
                snapshot = cached
            }
            let next = Date().addingTimeInterval(20 * 60)
            completion(Timeline(entries: [SecondMindEntry(date: .now, snapshot: snapshot)], policy: .after(next)))
        }
    }
}

private let signal = Color(red: 0.79, green: 1.0, blue: 0.35)
private let ink = Color(red: 0.95, green: 0.94, blue: 0.91)
private let muted = Color(red: 0.58, green: 0.61, blue: 0.64)
private let panel = Color(red: 0.055, green: 0.063, blue: 0.073)

private struct WidgetShell<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        content()
            .containerBackground(panel, for: .widget)
            .foregroundStyle(ink)
    }
}

private struct BrandLine: View {
    let trailing: String?
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "circle.hexagongrid.fill").font(.caption2).foregroundStyle(signal)
            Text("SEGUNDA MENTE").font(.system(size: 10, weight: .bold)).tracking(0.6).foregroundStyle(muted)
            Spacer(minLength: 4)
            if let trailing { Text(trailing).font(.system(size: 9, weight: .medium)).foregroundStyle(muted) }
        }
    }
}

struct TodayWidgetView: View {
    let entry: SecondMindEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        WidgetShell {
            VStack(alignment: .leading, spacing: 10) {
                BrandLine(trailing: "HOY")
                if let title = entry.snapshot.nextTitle {
                    Text(title).font(.system(size: family == .systemSmall ? 18 : 20, weight: .semibold, design: .rounded)).lineLimit(2)
                    if let due = entry.snapshot.nextDue {
                        Text(due, style: .time).font(.caption.weight(.semibold)).foregroundStyle(signal)
                    } else {
                        Text("Siguiente pendiente").font(.caption).foregroundStyle(muted)
                    }
                } else {
                    Text("Nada urgente.").font(.title3.weight(.semibold))
                    Text("Tu día está despejado.").font(.caption).foregroundStyle(muted)
                }
                Spacer(minLength: 0)
                if family == .systemMedium {
                    HStack(spacing: 8) {
                        Link(destination: URL(string: "segundamente://open?view=mente")!) {
                            Label("Hablar", systemImage: "mic.fill").font(.caption.weight(.bold)).padding(.horizontal, 11).padding(.vertical, 7).background(signal, in: Capsule()).foregroundStyle(.black)
                        }
                        if let gym = entry.snapshot.gymTitle {
                            Link(destination: URL(string: "segundamente://open?view=gym")!) {
                                Text(gym).font(.caption.weight(.semibold)).padding(.horizontal, 10).padding(.vertical, 7).background(Color.white.opacity(0.07), in: Capsule())
                            }
                        }
                    }
                }
            }.padding(2)
        }
    }
}

struct MoneyWidgetView: View {
    let entry: SecondMindEntry
    var body: some View {
        WidgetShell {
            Link(destination: URL(string: "segundamente://open?view=dinero")!) {
                VStack(alignment: .leading, spacing: 8) {
                    BrandLine(trailing: entry.snapshot.bankNeedsReauth ? "REVISAR" : "DINERO")
                    if let balance = entry.snapshot.balance {
                        Text(balance, format: .currency(code: "EUR")).font(.system(size: 24, weight: .semibold, design: .rounded)).minimumScaleFactor(0.7).lineLimit(1)
                        Text("disponible").font(.caption2).foregroundStyle(muted)
                    } else {
                        Text("—").font(.system(size: 28, weight: .semibold))
                        Text(entry.snapshot.bankNeedsReauth ? "Reconecta Cajamar" : "Saldo pendiente").font(.caption2).foregroundStyle(entry.snapshot.bankNeedsReauth ? .orange : muted)
                    }
                    Spacer(minLength: 0)
                    Text("Este mes · \(entry.snapshot.monthSpent, format: .currency(code: "EUR"))").font(.caption.weight(.semibold))
                    if let category = entry.snapshot.topCategory, let amount = entry.snapshot.topCategorySpent {
                        Text("\(category) · \(amount, format: .currency(code: "EUR"))").font(.caption2).foregroundStyle(muted).lineLimit(1)
                    }
                }.padding(2)
            }
        }
    }
}

struct GymWidgetView: View {
    let entry: SecondMindEntry
    var body: some View {
        WidgetShell {
            Link(destination: URL(string: "segundamente://open?view=gym")!) {
                VStack(alignment: .leading, spacing: 9) {
                    BrandLine(trailing: "GYM")
                    Image(systemName: entry.snapshot.gymTitle == "Descanso" ? "moon.zzz.fill" : "figure.strengthtraining.traditional")
                        .font(.system(size: 24, weight: .medium)).foregroundStyle(signal)
                    Text(entry.snapshot.gymTitle ?? "Configura tu semana")
                        .font(.system(size: 18, weight: .semibold, design: .rounded)).lineLimit(2)
                    Spacer(minLength: 0)
                    Text(entry.snapshot.gymTitle == "Descanso" ? "Hoy toca recuperar" : "Abrir entrenamiento")
                        .font(.caption2).foregroundStyle(muted)
                }.padding(2)
            }
        }
    }
}

struct TodayWidget: Widget {
    let kind = "SegundaMenteToday"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SecondMindProvider()) { TodayWidgetView(entry: $0) }
            .configurationDisplayName("Hoy")
            .description("Lo siguiente, tu entrenamiento y acceso rápido a Segunda Mente.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct MoneyWidget: Widget {
    let kind = "SegundaMenteMoney"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SecondMindProvider()) { MoneyWidgetView(entry: $0) }
            .configurationDisplayName("Dinero")
            .description("Saldo, gasto del mes y categoría principal.")
            .supportedFamilies([.systemSmall])
    }
}

struct GymWidget: Widget {
    let kind = "SegundaMenteGym"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SecondMindProvider()) { GymWidgetView(entry: $0) }
            .configurationDisplayName("Gym")
            .description("Qué entrenamiento toca hoy.")
            .supportedFamilies([.systemSmall])
    }
}

@main
struct SegundaMenteWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        MoneyWidget()
        GymWidget()
    }
}
