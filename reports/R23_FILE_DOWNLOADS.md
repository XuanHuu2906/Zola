# File download repair

The installed UI recognized XLSX metadata but the attachment stayed failed. The local runtime log reported `reason: url` for files. A read-only inspection of the affected cached attachment identified the `file-stal-8.dlfl.vn` CDN, which was missing from the media host allowlist.

A live download then exposed the complete chain: `file-stal-8.dlfl.vn` (301), `file-stal-8.flchat.vn` (302), `file-stal-8-te-vnso-pt-39.flchat.vn` (200). The downloader now follows at most five requests under a single deadline, validating HTTPS, credentials, port and the explicit CDN host families before each request. Redirect bodies are canceled. Other hosts are still rejected.

The actual XLSX attachment downloaded successfully to a temporary verification folder using the production downloader. No remote attachment URLs or document content were logged. Regression tests cover CDN matching, XLSX extension preservation and refusal to fetch an unapproved redirect target.
