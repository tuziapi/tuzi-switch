import { test } from "node:test";
import assert from "node:assert/strict";

test("short command does not execute partial stdout when download fails", async () => {
  if (repository !== "tuziapi/tuzi-switch") return;
  const { mkdtemp, writeFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "tuzi-short-command-"));
  const marker = join(dir, "executed");
  try {
    await writeFile(
      join(dir, "curl"),
      "#!/bin/bash\nprintf '%s' 'printf executed > \"$RUN_MARKER\"'\nexit \"$FAKE_CURL_STATUS\"\n",
      { mode: 0o755 },
    );
    for (const status of ["22", "0"]) {
      const result = spawnSync(
        "/bin/bash",
        ["-c", macosInstallCommand(fixture())],
        {
          env: {
            ...process.env,
            PATH: dir + ":/usr/bin:/bin",
            RUN_MARKER: marker,
            FAKE_CURL_STATUS: status,
          },
        },
      );
      if (status === "22") {
        assert.notEqual(result.status, 0);
        await assert.rejects(access(marker));
      } else {
        assert.equal(result.status, 0, result.stderr.toString());
        await access(marker);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bootstrap still rejects tampered installer and executes only the expected digest", async () => {
  if (repository !== "tuziapi/tuzi-switch") return;
  const { mkdtemp, writeFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "tuzi-bootstrap-"));
  const marker = join(dir, "executed");
  const script = 'printf executed > "$RUN_MARKER"';
  try {
    await writeFile(
      join(dir, "curl"),
      '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do\nif [ "$1" = "-o" ]; then printf \'%s\' \'printf executed > "$RUN_MARKER"\' > "$2"; exit 0; fi\nshift\ndone\nexit 1\n',
      { mode: 0o755 },
    );
    const r = fixture();
    for (const valid of [false, true]) {
      if (valid)
        r.macosInstaller.sha256 = createHash("sha256")
          .update(script)
          .digest("hex");
      const result = spawnSync("/bin/bash", ["-c", macosInstallBootstrap(r)], {
        env: {
          ...process.env,
          PATH: dir + ":/usr/bin:/bin",
          RUN_MARKER: marker,
        },
      });
      if (!valid) {
        assert.notEqual(result.status, 0);
        await assert.rejects(access(marker));
      } else {
        assert.equal(result.status, 0, result.stderr.toString());
        await access(marker);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import {
  macosInstallerTag,
  macosInstallerUrl,
  macosInstallCommand,
  macosInstallBootstrap,
} from "../src/macosInstaller.js";
import {
  isStableRelease,
  createStableRelease,
  installerFormats,
  repository,
} from "../src/stableRelease.js";
function fixture() {
  const release = createStableRelease({
    draft: false,
    prerelease: false,
    tag_name: macosInstallerTag,
    html_url:
      "https://github.com/" + repository + "/releases/tag/" + macosInstallerTag,
    published_at: "2026-11-05T00:00:00Z",
    assets: installerFormats.map((p) => ({
      name: p.file,
      state: "uploaded",
      size: 123,
      digest: "sha256:" + "a".repeat(64),
      browser_download_url:
        "https://github.com/" +
        repository +
        "/releases/download/" +
        macosInstallerTag +
        "/" +
        p.file,
    })),
  });
  release.macosInstaller = {
    tag: macosInstallerTag,
    href: macosInstallerUrl,
    sha256: "b".repeat(64),
  };
  return release;
}
test("official script command verifies its checksum before execution", () => {
  const r = fixture();
  if (repository !== "tuziapi/tuzi-switch") {
    assert.equal(isStableRelease(r), false);
    assert.equal(macosInstallCommand(r), "");
    return;
  }
  assert.ok(isStableRelease(r));
  const shortCommand = macosInstallCommand(r);
  assert.ok(shortCommand.length < 100);
  assert.ok(!shortCommand.includes("\n"));
  const command = macosInstallBootstrap(r);
  assert.ok(command.includes("set -e"));
  assert.ok(command.includes("mktemp"));
  assert.ok(command.includes(r.macosInstaller.sha256));
  assert.ok(
    command.indexOf("shasum") < command.indexOf('/bin/bash "$installer"'),
  );
  assert.ok(!command.includes("| bash"));
});
test("rejects substituted script host, hash, tag and channel", () => {
  for (const change of [
    (r) => {
      r.macosInstaller.href = "https://bad.test/script.sh";
    },
    (r) => {
      r.macosInstaller.sha256 = "'; touch /tmp/bad; #";
    },
    (r) => {
      r.macosInstaller.tag = "v1.5.4";
    },
    (r) => {
      r.repository = "AiW520/tuzi-switch";
    },
    (r) => {
      r.tag = "v1.5.6";
    },
  ]) {
    const r = fixture();
    change(r);
    assert.equal(macosInstallCommand(r), "");
    assert.equal(isStableRelease(r), false);
  }
});
test("old metadata remains valid without advertising an installer", () => {
  const r = fixture();
  delete r.macosInstaller;
  assert.ok(isStableRelease(r));
  assert.equal(macosInstallCommand(r), "");
  assert.equal(macosInstallCommand(null), "");
});

test("version routing validates before download and forwards installer flags", async () => {
  if (repository !== "tuziapi/tuzi-switch") return;
  const { mkdtemp, writeFile, readFile, rm, access } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "tuzi-version-routing-"));
  const downloaded = join(dir, "downloaded");
  const executed = join(dir, "executed");
  const payload = '#!/bin/bash\nprintf "%s\\n" "$@" > "$EXECUTED"\n';
  const r = fixture();
  r.macosInstaller.sha256 = createHash("sha256").update(payload).digest("hex");
  try {
    await writeFile(join(dir, "payload"), payload);
    await writeFile(join(dir, "bootstrap"), macosInstallBootstrap(r));
    await writeFile(
      join(dir, "curl"),
      `#!/bin/bash
printf downloaded > "$DOWNLOADED"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then cp "$PAYLOAD" "$2"; exit 0; fi
  shift
done
cat "$BOOTSTRAP"
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      TUZI_SWITCH_TAG: "",
      PATH: dir + ":/usr/bin:/bin",
      DOWNLOADED: downloaded,
      EXECUTED: executed,
      PAYLOAD: join(dir, "payload"),
      BOOTSTRAP: join(dir, "bootstrap"),
    };
    for (const [args, tag, ok] of [
      [["--help"], "", true],
      [["--version", "v1.5.5", "--help"], "", true],
      [
        ["--no-open", "--version", "1.5.5", "--install-dir", "/tmp/tuzi test"],
        "",
        true,
      ],
      [["--help"], "v1.5.5", true],
      [["--help"], "v1.3.1", false],
      [["--version", "v1.5.5", "--help"], "v1.3.1", true],
      [["--version", "v1.3.1"], "", false],
      [["--version", "$(touch /tmp/tuzi-injection)"], "", false],
      [["--version", ""], "", false],
      [["--version"], "", false],
      [["--version", "--help"], "", false],
      [["--version", "v1.5.5", "--version", "v1.5.5"], "", false],
    ]) {
      await rm(downloaded, { force: true });
      await rm(executed, { force: true });
      const result = spawnSync("/bin/bash", [join(dir, "bootstrap"), ...args], {
        env: { ...env, TUZI_SWITCH_TAG: tag },
      });
      assert.equal(
        result.status === 0,
        ok,
        JSON.stringify({ args, tag, stderr: result.stderr.toString() }),
      );
      if (ok) {
        const forwarded = args.filter(
          (arg, index) =>
            arg !== "--version" && args[index - 1] !== "--version",
        );
        assert.equal(
          await readFile(executed, "utf8"),
          forwarded.join("\n") + "\n",
        );
      } else {
        await assert.rejects(access(downloaded));
        await assert.rejects(access(executed));
      }
    }
    for (const pinned of [false, true]) {
      const result = spawnSync(
        "/bin/bash",
        ["-c", macosInstallCommand(r, { pinned })],
        { env },
      );
      assert.equal(result.status, 0, result.stderr.toString());
      assert.equal(await readFile(executed, "utf8"), "\n");
    }
    assert.match(
      macosInstallCommand(r, { pinned: true }),
      /--version v1\.5\.5/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
