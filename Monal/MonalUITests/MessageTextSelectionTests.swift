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
        let bubble = app.staticTexts[message].firstMatch
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
        let draftValue = NSPredicate(format: "value == %@", draft)
        let textView = app.textViews.matching(draftValue).firstMatch
        let textField = app.textFields.matching(draftValue).firstMatch
        let composer = textView.waitForExistence(timeout: 3) ? textView : textField
        XCTAssertTrue(composer.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(composer.value as? String, draft)
        composer.tap()
        composer.doubleTap()
        tapMenuAction("Select All", in: app)
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
