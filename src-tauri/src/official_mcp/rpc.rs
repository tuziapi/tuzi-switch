//! Bounded, short-lived Codex app-server client. Never reads OAuth credential
//! files and never starts a model turn. The child owns OAuth and token refresh.
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    time::{Duration, Instant},
};

pub(super) const MAX_FRAME: usize = 1024 * 1024;

pub(super) struct Rpc {
    child: Child,
    input: ChildStdin,
    output: Receiver<Result<Value, &'static str>>,
    id: u64,
    login_completed: Option<bool>,
}

impl Drop for Rpc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn read_frame(reader: &mut impl BufRead) -> Result<Option<Value>, &'static str> {
    let mut bytes = Vec::new();
    let n = reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "codex_unavailable")?;
    if n == 0 {
        return Ok(None);
    }
    if n > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Err("codex_protocol_error");
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "codex_protocol_error")
}

impl Rpc {
    pub(super) fn spawn(
        executable: &Path,
        home: &Path,
        cwd: &Path,
        endpoint: &str,
    ) -> Result<Self, &'static str> {
        // Add the official transport for this helper process. Before starting
        // a verification thread, explicitly disable other merged MCP entries.
        let endpoint = toml::Value::String(endpoint.into()).to_string();
        let config = format!("mcp_servers={{tuzi-official={{url={endpoint},enabled=true}}}}");
        let mut command = Command::new(executable);
        command
            .args([
                "app-server",
                "--listen",
                "stdio://",
                "-c",
                &config,
                "-c",
                "features.apps=false",
                "-c",
                "analytics.enabled=false",
            ])
            .env("CODEX_HOME", home)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "codex_missing")?;
        let input = child.stdin.take().ok_or("codex_unavailable")?;
        let stdout = child.stdout.take().ok_or("codex_unavailable")?;
        let (tx, output) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_frame(&mut reader) {
                    Ok(Some(v)) => {
                        if tx.send(Ok(v)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        break;
                    }
                }
            }
        });
        Ok(Self {
            child,
            input,
            output,
            id: 0,
            login_completed: None,
        })
    }

    fn write(&mut self, value: Value) -> Result<(), &'static str> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "codex_protocol_error")?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .and_then(|_| self.input.flush())
            .map_err(|_| "codex_unavailable")
    }

    fn next(&mut self, deadline: Instant, cancelled: &AtomicBool) -> Result<Value, &'static str> {
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err("cancelled");
            }
            if Instant::now() >= deadline {
                return Err("timeout");
            }
            match self.output.recv_timeout(Duration::from_millis(100)) {
                Ok(v) => return v,
                Err(mpsc::RecvTimeoutError::Timeout) => (),
                Err(_) => return Err("codex_unavailable"),
            }
        }
    }

    fn notification(&mut self, value: &Value) -> Result<(), &'static str> {
        if value["method"] == "mcpServer/oauthLogin/completed"
            && value["params"]["name"] == super::SERVER_ID
        {
            self.login_completed = Some(value["params"]["success"] == true);
        }
        if value.get("method").is_some() && value.get("id").is_some() {
            // This helper cannot approve commands, sampling, elicitation or any
            // model action. Do not forward their content into the UI or logs.
            self.write(json!({"id":value["id"],"error":{"code":-32601,"message":"Unsupported helper request"}}))?;
        }
        Ok(())
    }

    pub(super) fn call(
        &mut self,
        method: &str,
        params: Value,
        seconds: u64,
        cancelled: &AtomicBool,
    ) -> Result<Value, &'static str> {
        self.id += 1;
        let id = self.id;
        self.write(json!({"id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(seconds);
        loop {
            let value = self.next(deadline, cancelled)?;
            self.notification(&value)?;
            if value["id"] != id {
                continue;
            }
            if value.get("error").is_some() {
                #[cfg(test)]
                eprintln!(
                    "MCP helper RPC failure: method={method}, code={}",
                    value["error"]["code"]
                );
                return Err(if value["error"]["code"] == -32601 {
                    "codex_upgrade_required"
                } else {
                    "request_failed"
                });
            }
            return value.get("result").cloned().ok_or("codex_protocol_error");
        }
    }

    pub(super) fn initialize(&mut self, cancelled: &AtomicBool) -> Result<(), &'static str> {
        self.call("initialize", json!({"clientInfo":{"name":"tuzi_mcp_setup","version":"1.0.0"},"capabilities":{"experimentalApi":true}}), 15, cancelled)?;
        self.write(json!({"method":"initialized"}))
    }

    pub(super) fn wait_login(&mut self, cancelled: &AtomicBool) -> Result<(), &'static str> {
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            if let Some(ok) = self.login_completed {
                return if ok {
                    Ok(())
                } else {
                    Err("authorization_failed")
                };
            }
            let value = self.next(deadline, cancelled)?;
            self.notification(&value)?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_oversized_unterminated_and_invalid_frames() {
        assert!(read_frame(&mut &b"{}"[..]).is_err());
        assert!(read_frame(&mut &b"secret error\n"[..]).is_err());
        assert!(read_frame(&mut &vec![b'x'; MAX_FRAME + 1][..]).is_err());
        assert_eq!(
            read_frame(&mut &b"{\"id\":1}\n"[..]).unwrap(),
            Some(json!({"id":1}))
        );
        assert_eq!(read_frame(&mut &b""[..]).unwrap(), None);
    }
}
