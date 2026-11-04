"""Bounded SCRAM KDF adapter for Pyodide's OpenSSL-free hashlib build.

Use the already pinned cryptography library's PBKDF2 implementation. This is
not a general hashlib replacement and does not alter omemo-dr's ratchet/KDF.
"""

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAX_SCRAM_ITERATIONS = 1_000_000


def pbkdf2_hmac(hash_name, password, salt, iterations, dklen=None):
    algorithms = {"sha1": hashes.SHA1, "sha256": hashes.SHA256, "sha512": hashes.SHA512}
    if hash_name not in algorithms:
        raise ValueError("Unsupported SCRAM hash")
    if type(iterations) is not int or not 1 <= iterations <= MAX_SCRAM_ITERATIONS:
        raise ValueError("Unsupported SCRAM work factor")
    if not isinstance(password, bytes) or not isinstance(salt, bytes):
        raise TypeError("SCRAM inputs must be bytes")
    if len(password) > 65536 or len(salt) > 1024:
        raise ValueError("SCRAM input exceeds bounds")
    algorithm = algorithms[hash_name]()
    length = algorithm.digest_size if dklen is None else dklen
    if type(length) is not int or not 1 <= length <= 64:
        raise ValueError("Unsupported SCRAM output length")
    return PBKDF2HMAC(algorithm=algorithm, length=length, salt=salt, iterations=iterations).derive(password)
