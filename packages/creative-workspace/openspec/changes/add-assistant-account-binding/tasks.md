## Implementation
- [x] Reuse the existing settings from both entry points and simplify its presentation.
- [x] Support explicit account binding and retain manual providers.
- [x] Implement native source validation and controlled model transport.
- [x] Add the account configuration target and synthetic preview.
- [x] Verify lifecycle, request boundaries, persistence, settings UI and builds.

## Native runtime follow-through (user approved 2026-11-02)
- [x] Add a separate explicit manual HTTP capability without enabling legacy desktop storage commands.
- [x] Close the cancellation registration race and clean up stream listeners.
- [x] Test account binding and model requests against isolated synthetic HTTP, preserving PR #7.
- [x] Build and inspect the isolated macOS desktop bundle; record actual limits.
- [x] Fix the nested API Key prompt scope, stacking and focus; verify light/dark and compact layouts.
