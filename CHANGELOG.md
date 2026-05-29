# Changelog

## 2026-05-28

- Fixed a front-end script syntax break that prevented mailbox refresh from running.
- Added local batch deletion for the current mail filter result.
- Added refresh request/error details so failed mailbox refreshes show the real cause.
- Tightened mailbox and mail-list headers so titles and counters stay aligned.
- Hid bulky mail-list scrollbars while keeping the list scrollable.
- Restored Microsoft IMAP HTML message detail rendering.
- Added browser-local backup and restore for mailbox assistant data.
- Added import preflight summary for Outlook and temp-mail pasted data.
- Added admin login page with cookie-based admin session.
- Made deployment self-check private when `MAIL_PICKUP_ADMIN_TOKEN` is set.
- Compressed front-page header spacing and replaced heavy native scrollbars with thin scrollbars.
- Clarified open-source data boundaries in README and SECURITY docs.
