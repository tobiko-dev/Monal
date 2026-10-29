# Install Monal (modified) on your iPad for free

This fork can produce an unsigned **device** app for personal signing. It
includes the Select Text improvement. It is not an App Store or TestFlight build.

## What you need

- An iPad running iPadOS 17 or later and a free Apple account.
- A Windows, Mac, or Linux computer and a USB cable for initial SideStore setup.
- Wi-Fi and SideStore's LocalDevVPN for installation and refreshes on the iPad.

Follow SideStore's current [prerequisites](https://docs.sidestore.io/docs/installation/prerequisites)
and [installation guide](https://docs.sidestore.io/docs/installation/install).
They cover iloader, trusting the developer, and enabling Developer Mode. Enter
Apple credentials only in the local installer/SideStore, never in this repository,
GitHub Actions secrets, or a chat. Refresh SideStore itself once before adding Monal.

## Install the app

1. Open a successful **Build personal iPad app** run in this repository's Actions
   tab and download the **Monal-Modified-iPad** artifact. Unzip it in Files.
2. Keep `Monal-Modified-unsigned.ipa`. The artifact also includes its SHA-256
   checksum and source commit in `build-info.json`.
3. With Wi-Fi and LocalDevVPN connected, import the IPA into SideStore using the
   add-app control in My Apps. SideStore signs it with your free Apple account.
   Tapping an IPA directly in Files does not install it.
4. Open **Monal (modified)** and sign in with your existing full 5july XMPP address
   and password. Keep these credentials on your iPad.
5. Open a conversation, long-press a text message, choose **Select Text**, and
   select/copy part of the message or use **Copy All**.

Refresh both SideStore and Monal before their seven-day profiles expire.
SideStore supports refreshes on the iPad without a nearby computer, although an
expired app or invalidated device pairing may require the computer again. See
[SideStore FAQ](https://docs.sidestore.io/docs/faq) and Apple's
[personal account limits](https://developer.apple.com/help/account/basics/about-your-developer-account/).

## Behavior of this build

- Its bundle ID is `dev.tobiko.monal.personal`, with private storage and its own
  keychain access. It can be installed alongside App Store Monal.
- Background push notifications, incoming call alerts while suspended, and the
  iOS share extension are unavailable. Reopen the app to reconnect and fetch
  messages. Notification settings and onboarding explain this limitation.
- It has its own account database and OMEMO identity. Existing local history and
  encryption keys from App Store Monal are not automatically imported. A new
  device may not decrypt older messages; review its OMEMO device trust as usual.
- Refresh/update the installed app using the same Apple account and bundle ID.
  Deleting it removes its local message database and encryption state.
- CI checks the actual arm64/iPhoneOS executable and runs offline iPad simulator
  tests. The chat fixture verifies password storage through Monal's real keychain
  API inside the app, because unhosted framework tests lack an app identity.
  A successful CI run does not verify free Apple signing on your device,
  live 5july login, push delivery, or hardware trackpad behavior.

## Rebuild

Run **Build personal iPad app** from Actions. No Apple account, signing key,
certificate, or 5july password is needed by CI. GitHub builds the unsigned IPA;
SideStore signs it locally for your device.

The normal project stays configured for upstream Monal. The personal workflow
runs `scripts/prepare-personal-build.rb` after `pod install` in its disposable
checkout. It opts into `MONAL_SIDELOAD`, removes extensions and entitlement
requirements, and uses app-private storage. Do not commit its generated Xcode
project or generated Info.plist over the normal project.

AI assistance was used to implement this build configuration and its tests.
