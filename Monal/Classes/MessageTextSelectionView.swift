//
//  MessageTextSelectionView.swift
//  Monal
//

import SwiftUI
import UIKit

struct MessageTextSelectionView: View {
    @Environment(\.dismiss) private var dismiss
    let text: String

    var body: some View {
        NavigationStack {
            SelectableMessageText(text: text)
                .navigationTitle("Select Text")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                        .keyboardShortcut(.cancelAction)
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Copy All") {
                            UIPasteboard.general.string = text
                        }
                    }
                }
        }
    }
}

private struct SelectableMessageText: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        // UITextView provides selection handles for part of a message on iPadOS,
        // independently of the chat bubble's long-press and reaction gestures.
        let textView = UITextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = true
        textView.backgroundColor = .systemBackground
        textView.textColor = .label
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        textView.textContainer.lineFragmentPadding = 0
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.accessibilityIdentifier = "SelectableMessageText"
        textView.accessibilityLabel = NSLocalizedString("Message text", comment: "Selectable message contents")
        textView.text = text
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        // Reassigning text clears the selection, including when the sheet resizes.
        if textView.text != text {
            textView.text = text
        }
    }
}
