//
//  HelperToolsTest.swift
//  MonalXMPPUnitTests
//
//  Created by Matthew Fennell on 09/08/2026.
//  Copyright © 2026 monal-im.org. All rights reserved.
//

import Testing
import monalxmpp
import Foundation
import Security

struct HelperToolsTest {

#if MONAL_SIDELOAD
    @Test("Personal storage can write and read without an App Group")
    func personalStorageRoundTrip() throws {
        let root = HelperTools.getContainerURL(forPathComponents: [])
        #expect(root.resolvingSymlinksInPath().path.hasPrefix(
            URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"))
        let file = root.appendingPathComponent("storage-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: file) }
        let data = Data("café 👩🏽‍💻 日本語\nprivate storage".utf8)
        try data.write(to: file, options: .atomic)
        #expect(try Data(contentsOf: file) == data)
    }

    @Test("Personal preferences retain Monal's binary serialization")
    func personalPreferencesRoundTrip() {
        let key = "personal-test-\(UUID().uuidString)"
        let defaults = HelperTools.defaultsDB()
        defer { defaults.removeObject(forKey: key) }
        let data = Data([0, 1, 127, 128, 255])
        defaults.set(data, forKey: key)
        #expect(defaults.object(forKey: key) as? Data == data)
    }

    @Test("Personal keychain entries work without a shared access group")
    func personalKeychainRoundTrip() throws {
        let data = Data("offline-test-secret".utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "personal-test-\(UUID().uuidString)",
            kSecAttrAccount as String: "offline-test",
        ]
        defer { SecItemDelete(query as CFDictionary) }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #expect(SecItemAdd(item as CFDictionary, nil) == errSecSuccess)
        var lookup = query
        lookup[kSecReturnData as String] = true
        var result: CFTypeRef?
        #expect(SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess)
        #expect(result as? Data == data)
    }
#endif

    @Test("parseDateTime treats UTC XEP-0082 DateTimes as UTC", arguments: ["2026-08-09T19:51:11Z", "2026-08-09T19:51:11+00:00", "2026-08-09T19:51:11.000-00:00", "2026-08-09T19:51:11.000Z"])
    func testParseDateTimeTreatsUTCDatesAsUTC(_ dateString: String) {
        let expected = try! Date.ISO8601FormatStyle.iso8601.parse("2026-08-09T19:51:11Z")
        #expect(HelperTools.parseDateTime(dateString) == expected)
    }

    @Test("parseDateTime takes timezone offset into account when parsing non-UTC XEP-0082 DateTimes", arguments: ["2026-08-09T17:51:11-02:00", "2026-08-09T18:51:11.000-01:00", "2026-08-09T20:51:11+01:00", "2026-08-09T21:51:11.000+02:00"])
    func testParseDateTimeTakesTimezoneIntoAccount(_ dateString: String) {
        let expected = try! Date.ISO8601FormatStyle.iso8601.parse("2026-08-09T19:51:11Z")
        #expect(HelperTools.parseDateTime(dateString) == expected)
    }

}
