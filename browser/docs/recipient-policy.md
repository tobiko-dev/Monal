# Verified recipient preparation

`python/gajim_browser/recipient_policy.py` adds a strict, local policy around
Gajim's actual SQLite store and unchanged `omemo-dr` session manager. It does
not replace the encryption library or implement a new XMPP client. It is not
yet connected to discovery, a verification screen, the durable outbox or a
network dispatcher.

## Source review and retained code

The review used Gajim's
[`common/modules/omemo.py` at `5a57abb2950886dd9cb8a73972ecc2dcc59f688a`](https://github.com/gajim/gajim/blob/5a57abb2950886dd9cb8a73972ecc2dcc59f688a/src/gajim/common/modules/omemo.py),
verified against Git blob `c4ad0d9ec76fb79876ae0aca442e851458cb8399`.
Its SHA-256 is `fe38705e03bbf541e4dbd5b57edc909fef36e62d578f6c092f8cdcc597b89523`.
The store and `omemo-dr` remain pinned in `versions.json`.

| Reviewed behavior | Browser treatment |
| --- | --- |
| Gajim's `check_send_preconditions` rejects undecided known identities; `_has_trusted_keys` accepts VERIFIED or BLIND identities | The added project policy requires VERIFIED for every device in the supplied recipient and own-device lists. The already adapted store disables default blind trust. This guard also rejects a BLIND entry if one is present. |
| `omemo-dr.encrypt` catches individual device-encryption failures and can return remaining wrapped keys | Invoke the same engine on a disposable snapshot, then require the exact planned device-key set. Partial output returns no candidate state or ciphertext. The caller's committed state remains unchanged. |
| The legacy engine merges wrapped keys into a dictionary indexed by numeric device ID | Reject collisions between own and peer devices, including collisions with the local device. Do not silently overwrite a wrapped key or change the crypto protocol. |
| Gajim's `set_public_key_trust` changes trust for a specific identity key | Use the same store operation, after matching the supplied fingerprint to the current session key for that account, address and device. A stale confirmation cannot verify a replacement key. |
| Gajim merges its local ID into the retrieved own-device list | Retain that behavior in the forthcoming publication coordinator. This preparation guard only accepts a list already containing the local device; it cannot publish or mark publication successful. |
| Gajim's `request_devicelist` treats a failed request as an empty list before processing it | The browser coordinator must distinguish unavailable discovery from a successful empty response. The guard rejects missing lists; neither case authorizes a send. |
| The session manager reconstructs known devices from active sessions | Never use that subset as proof of complete discovery. Each guard call requires explicit lists, including announced devices whose bundles/sessions are still missing. |

These are explicit project-policy additions over real Gajim APIs, not a claim
that the entire desktop `OMEMO` application module has been ported. Its event,
contact, settings and publication lifecycle still need adaptation.

## Local contract

`prepare_message` requires a validated existing snapshot, its expected public
identity, canonical bare account/recipient JIDs and both complete current device
lists. It checks every target's current session fingerprint and VERIFIED trust,
including the account's other devices. Unknown sessions, unavailable discovery,
an unpublished local device, exhausted sessions or an ambiguous device ID block
preparation before encryption. Lists are bounded to 128 devices each, IDs to
positive signed 31-bit integers, and text to 64 KiB UTF-8. These are initial
application bounds, not XMPP protocol limits.

The actual manager updates its working device lists and encrypts. Exact wrapped-key
coverage must match the immutable account/address/device/fingerprint plan before
the candidate snapshot is exported. The result contains actual OMEMO ciphertext
and private snapshot bytes for worker-internal use; it is neither persisted nor
sent. Its default representation omits the snapshot and message bytes.

`verify_device` applies an explicit verification to the current fingerprint and
returns candidate snapshot bytes. A future screen must obtain a real comparison
with the other device/person. Merely fetching a key or invoking this helper is
not evidence that a human verified an identity.

`revalidate_plan` rejects changed lists, fingerprints, local identity or trust
before previously prepared work can be dispatched. The future coordinator must
serialize discovery, trust updates and dispatch under the account owner. This
local check alone does not eliminate a network race or validate a server reply.

No new persistent schema or identity regeneration was introduced. The caller
must use the existing atomic outbox/snapshot commit boundary and reconcile lost
replies before sending. Missing state remains a recovery case.

## Validation and limits

Twenty-four added protocol-suite tests use real Gajim snapshots, sessions,
fingerprints and encryption. A three-device case decrypts the same actual
nbxmpp OMEMO XML on two peer devices and another own device, then restores the
prepared sender state and decrypts a reply. A forced failure for one device
exercises the library's actual partial-success behavior; the guard rejects it,
and a deliberate retry from the original snapshot decrypts on both peers.

Other cases cover stale confirmations, changed keys, unverified own devices,
blind/blocked trust, added/removed devices, revoked trust, device-ID collisions,
Notes to self, malformed/bounded inputs and local-identity/account isolation.
Discovery and verification actions in these tests are explicit synthetic fixtures.

This increment is one-to-one only, using the pinned library's legacy OMEMO
format. It does not add groupchat policy, live bundle retrieval/publication,
receive attribution, app-wide send enforcement, native-client interoperability
or a security audit. Safari's earlier 20-adapter-test report does not cover these
24 additions. The new source has its own validation record; the private QA site
remains on the previously tested build until a later deployment.

## Next coordinator increment

1. Bind a restored account identity to the authenticated nbxmpp session. Keep
   network callbacks separate from durable mutation; do not create replacement
   keys on a connection or storage failure.
2. Adapt Gajim's own-device merge and bundle/session flow. Commit generated or
   replenished private keys before publishing the corresponding public bundle.
   Verify publication responses; preserve other published device IDs.
3. Persist discovered device lists independently of sessions, including devices
   with missing bundles. Preserve request failure/stale/unavailable states and
   bind replies to the requested JID/device and connection generation. Reject
   stale or mismatched replies before changing state.
4. Present real current fingerprints and explicit verification/changed/blocked
   states. Persist trust changes under the same account lock.
5. Connect this policy to atomic real-XML outbox preparation and pre-dispatch
   revalidation. Do not transmit key-transport or user-content messages directly
   from a bundle callback before the associated state is committed.
6. Test the integrated path with a controlled multi-device peer, then request
   the existing authorized Notes-to-self/npc interoperability checks. No other
   contact is a test target.
