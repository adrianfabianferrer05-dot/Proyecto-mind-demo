import SwiftUI

struct ActivationView: View {
    @ObservedObject var model: AppModel
    @State private var code = ""

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.039, blue: 0.047).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 22) {
                Spacer()
                ZStack {
                    Circle().fill(Color.white.opacity(0.045)).frame(width: 76, height: 76)
                    Circle().stroke(Color(red: 0.79, green: 1.0, blue: 0.35).opacity(0.22), lineWidth: 1).frame(width: 76, height: 76)
                    Image(systemName: "iphone.gen3").font(.system(size: 28, weight: .medium)).foregroundStyle(signal)
                }
                Text("Segunda Mente\nen tu iPhone.")
                    .font(.system(size: 44, weight: .semibold, design: .serif))
                    .tracking(-1.5)
                    .foregroundStyle(.white)
                Text("Vincúlala una vez. La app nativa y los widgets usarán la misma información que ya tienes en Segunda Mente.")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 9) {
                    Text("CÓDIGO TEMPORAL")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(.secondary)
                    TextField("XXXX-XXXX-XXXX", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 18, weight: .medium, design: .monospaced))
                        .padding(.horizontal, 16)
                        .frame(height: 58)
                        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color.white.opacity(0.08)))
                }

                if let error = model.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(Color(red: 1, green: 0.55, blue: 0.55))
                }

                Button {
                    Task { await model.activate(code: code) }
                } label: {
                    HStack {
                        if model.isWorking { ProgressView().tint(.black) }
                        Text(model.isWorking ? "Vinculando…" : "Vincular este iPhone").fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(signal, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .foregroundStyle(.black)
                }
                .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).count < 8 || model.isWorking)
                .opacity(code.trimmingCharacters(in: .whitespacesAndNewlines).count < 8 ? 0.45 : 1)

                Text("El código sirve una sola vez. Las claves privadas y bancarias siguen en el servidor; no se incluyen dentro de la app.")
                    .font(.caption2)
                    .foregroundStyle(.secondary.opacity(0.8))
                Spacer()
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 20)
        }
        .preferredColorScheme(.dark)
    }

    private var signal: Color { Color(red: 0.79, green: 1.0, blue: 0.35) }
}
