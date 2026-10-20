# Security and privacy boundaries

Paperlocal performs document processing in browser memory. It makes no document-upload requests, stores no workspace in localStorage/IndexedDB and uses no analytics. Bundled static assets are requested from the page's origin; any hosting provider can observe normal asset requests and IP addresses. Use a trusted local copy served on 127.0.0.1 for sensitive work. Browser extensions, OS-level access and maliciously modified hosting are outside the app's control.

No security audit, production certification, malware scanning or hardened parser sandbox is claimed. PDF.js runs preview work in a browser worker, while pdf-lib output work runs in the page. This does not make hostile documents safe. Keep your browser and bundled libraries current through reviewed updates. Resource limits cannot prevent all browser memory exhaustion; image decoding may allocate memory before dimensions are checked. There is no cancellation control for a long synchronous PDF operation; close the tab if necessary.

## Avoid unsafe assumptions

- Page removal is not redaction. Copied page resources may retain hidden or embedded information.
- Forms, signatures, links, annotations, document metadata and attachments are not guaranteed to be retained or removed consistently. Review outputs with a trusted viewer before sharing.
- The app rejects encrypted/password-protected PDFs and does not bypass permissions.
- Clearing the workspace disposes previews and file references, but is not a forensic secure erase of RAM. Downloads remain in your device's download storage.
- Browser screenshots and fixtures in this repository contain only synthetic content.

For a bug, first reproduce it with a small invented document. Do not upload confidential files, passwords, identity documents or medical records to a public issue. If no private reporting channel is configured, report only non-sensitive reproduction steps. No guaranteed response time is offered.
