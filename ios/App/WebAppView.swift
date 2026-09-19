import SwiftUI
import WebKit

struct WebAppView: UIViewRepresentable {
    let token: String
    let route: AppRoute

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let encoded = (try? String(data: JSONEncoder().encode(token), encoding: .utf8)) ?? "\"\""
        let bootstrap = "localStorage.setItem('sm_device_token', \(encoded));"
        config.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.035, green: 0.039, blue: 0.047, alpha: 1)
        context.coordinator.webView = webView
        context.coordinator.route = route
        webView.load(URLRequest(url: URL(string: "https://proyecto-mind-demo.vercel.app/")!, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.route != route else { return }
        context.coordinator.route = route
        context.coordinator.applyRoute()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        var route: AppRoute = .today

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            applyRoute()
        }

        func applyRoute() {
            webView?.evaluateJavaScript(route.javascript)
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }
    }
}
