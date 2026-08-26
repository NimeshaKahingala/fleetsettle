"""Shared connect() for golden.py and reports.py — factored out after
SonarCloud, PR #133, flagged the two scripts' near-identical connection
setup as duplication on new code.

PGPASSWORD is the Neon role's password (never committed — see the git
history this replaced: a hardcoded literal that turned out to be the
production credential, matching DATABASE_URL's own `main`-branch password).
The SSL context is built explicitly (PROTOCOL_TLS_CLIENT, pinned
minimum_version, explicit cert verification) rather than via
ssl.create_default_context() alone: same verification behaviour, but a
minimum_version SonarCloud's S4423/S4830 can see statically rather than
infer from the stdlib's own version-dependent defaults.
"""
import os, ssl, sys
import pg8000.dbapi


def connect(host):
    password = os.environ.get("PGPASSWORD")
    if not password:
        sys.exit("PGPASSWORD must be set — the Neon role's password, never committed here")

    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.check_hostname = True
    ssl_context.load_default_certs()

    return pg8000.dbapi.connect(
        user="neondb_owner", password=password, host=host, database="neondb", ssl_context=ssl_context
    )
