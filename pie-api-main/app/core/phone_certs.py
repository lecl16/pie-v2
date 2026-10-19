"""Issues the client certificates of enrolled Examiner App phones — see
docs/examiner-phone-enrollment.md. Signed by the phone CA that
scripts/generate-certs.sh creates, which Caddy trusts on the phone port."""

import secrets
from datetime import datetime, timedelta
from functools import lru_cache

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from app.core.config import config


class InvalidCsr(ValueError):
    pass


@lru_cache(maxsize=1)
def _phone_ca():
    with open(config.PHONE_CA_CERT_PATH, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())
    with open(config.PHONE_CA_KEY_PATH, "rb") as f:
        ca_key = serialization.load_pem_private_key(f.read(), password=None)
    return ca_cert, ca_key


def load_phone_csr(csr_pem: str) -> x509.CertificateSigningRequest:
    """Parses the phone's request and checks that it is signed by the key it
    carries, i.e. that the phone holds that key. Only P-256 keys are
    accepted, which is what the app generates in the Android Keystore."""
    try:
        csr = x509.load_pem_x509_csr(csr_pem.encode("ascii"))
    except Exception:
        raise InvalidCsr("Not a PEM certificate signing request")
    if not csr.is_signature_valid:
        raise InvalidCsr("The request's signature does not match its key")
    key = csr.public_key()
    if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
        raise InvalidCsr("Only P-256 (secp256r1) keys are accepted")
    return csr


def issue_phone_certificate(csr: x509.CertificateSigningRequest, phone_id: int):
    """Returns (certificate, fingerprint, serial hex, not_after). The subject
    is set here, never taken from the request, so a phone cannot name
    itself after another phone."""
    ca_cert, ca_key = _phone_ca()
    now = datetime.utcnow()
    not_after = now + timedelta(days=config.PHONE_CERT_DAYS)
    serial = int.from_bytes(secrets.token_bytes(16), "big") >> 1  # positive, < 2^127

    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PIE"),
            x509.NameAttribute(NameOID.COMMON_NAME, f"phone-{phone_id}"),
        ]))
        .issuer_name(ca_cert.subject)
        .public_key(csr.public_key())
        .serial_number(serial)
        .not_valid_before(now - timedelta(minutes=5))  # tolerate clock skew
        .not_valid_after(not_after)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(csr.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    return cert, fingerprint, format(serial, "x"), not_after


def certificate_pem(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode("ascii")


def normalize_fingerprint(value: str) -> str:
    return value.replace(":", "").strip().lower()
