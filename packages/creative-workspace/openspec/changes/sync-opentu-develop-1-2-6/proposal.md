# Change: Incrementally sync opentu develop 1.2.6

## Why
The embedded desktop workspace lacks the original opentu navigation logo and the latest model/media and error-diagnostic improvements.

## Approval
On 2026-11-05 the user explicitly chose: “增量同步两组（推荐）：2.6-1k/GIF 与生成错误详情，保留桌面适配”. This approves both feature groups and their desktop compatibility work. Scope and fixed commits: `docs/development/2026-11-05-opentu-develop-sync.md` in the host repository. No new release or paid generation is authorized.

## What Changes
- Restore the original upstream logo in host creative entry points.
- Adapt upstream e3f44544 and 25c62552 through develop b742f593: gpt-image-2.6-1k parameters, original GIF media, structured generation failures and Request ID correction.
- Preserve account references, native transport/media/clipboard, image context menu and removed standalone workflow exclusion.
- Keep new diagnostic fields optional and verify old tasks, host routes and source reconstruction.

## Impact
Host brand component, embedded creative source, desktop compatibility tests and provenance. Existing system-token-v1 contract, official release identity and updater verification remain unchanged.
