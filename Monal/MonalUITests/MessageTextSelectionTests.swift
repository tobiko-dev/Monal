import XCTest

@MainActor
final class MessageTextSelectionTests: XCTestCase {
    private let message = "Alpha bravo café 👩🏽‍💻\nSecond line: 日本語 — https://example.org/test\nFinal line."
    private let draft = "Unsent draft"

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    func testSwiftUISelectAndCopyPartInLandscape() {
        checkPartialCopy(legacy: false)
    }

    func testLegacySelectAndCopyPartInLandscape() {
        checkPartialCopy(legacy: true)
    }

    func testSwiftUICopyAllPreservesDraft() {
        checkCopyAll(legacy: false)
    }

    func testLegacyCopyAllPreservesDraft() {
        checkCopyAll(legacy: true)
    }

    private func launchChat(legacy: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        // Keep animations enabled: the menu-to-sheet transition is part of the regression.
        app.launchArguments = ["--reset", "--ui-test-message-selection"]
        if legacy { app.launchArguments.append("--ui-test-legacy-chat") }
        app.launch()
        return app
    }

    private func openSelection(in app: XCUIApplication) -> XCUIElement {
        // UILabel flattens line breaks in its accessibility label; SwiftUI Text
        // preserves them. Still verify the exact original text in the sheet.
        let messageLabel = NSPredicate(format: "label == %@ OR label == %@",
                                       message, message.replacingOccurrences(of: "\n", with: " "))
        let bubble = app.staticTexts.matching(messageLabel).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 20), app.debugDescription)
        bubble.press(forDuration: 1)
        tapMenuAction("Select Text", in: app)
        let text = app.textViews["SelectableMessageText"]
        XCTAssertTrue(text.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(text.value as? String, message)
        return text
    }

    private func tapMenuAction(_ title: String, in app: XCUIApplication) {
        // UIKit's edit/context menus and ExyteChat expose different element types.
        let action = app.descendants(matching: .any).matching(identifier: title).firstMatch
        XCTAssertTrue(action.waitForExistence(timeout: 5), app.debugDescription)
        action.tap()
    }

    private func checkPartialCopy(legacy: Bool) {
        let app = launchChat(legacy: legacy)
        let text = openSelection(in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        // Double-tap the first word in the real UITextView to select "Alpha".
        text.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: 28, dy: 28)).doubleTap()
        let selection = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        selection.name = legacy ? "Legacy selection handles" : "SwiftUI selection handles"
        selection.lifetime = .keepAlways
        add(selection)
        tapMenuAction("Copy", in: app)
        app.buttons["Done"].tap()
        pasteAndCheck("Alpha", in: app)
    }

    private func checkCopyAll(legacy: Bool) {
        let app = launchChat(legacy: legacy)
        _ = openSelection(in: app)
        app.buttons["Copy All"].tap()
        app.buttons["Done"].tap()
        pasteAndCheck(message, in: app)
    }

    private func pasteAndCheck(_ expected: String, in app: XCUIApplication) {
        // Read back the clipboard through the real composer, not a test-only
        // pasteboard bridge. This also checks that opening the sheet kept the draft.
        let textView = app.textViews["NewChatMessageTextField"]
        let composer = textView.waitForExistence(timeout: 3) ? textView : app.textFields.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(composer.value as? String, draft)
        composer.tap()
        // Put the caret after the short draft and clear it without changing the
        // clipboard. Double-tapping selects a word, whose iOS 26 edit menu does
        // not offer Select All consistently across device sizes.
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: draft.count))
        composer.press(forDuration: 1)
        tapMenuAction("Paste", in: app)
        let pastedValue = NSPredicate(format: "value == %@", expected)
        let pasted = app.descendants(matching: .any).matching(pastedValue).firstMatch
        XCTAssertTrue(pasted.waitForExistence(timeout: 5), app.debugDescription)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Copied text in composer"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
