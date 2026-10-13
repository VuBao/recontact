# Third-party components

## MIMEText

- Package: `mimetext@3.0.28` (pinned)
- Source: https://github.com/muratgozel/MIMEText
- License: MIT
- Reused capability: RFC 5322 MIME message construction, Unicode header encoding,
  base64url output for Gmail, and MIME attachments.
- Runtime entrypoint: `mimetext/browser`, so the Cloudflare runtime path does not
  import Node built-ins.

Recontact supplies the recruiting template, input validation, OAuth exchange, and
Gmail REST adapter. It does not copy MIMEText source code.
