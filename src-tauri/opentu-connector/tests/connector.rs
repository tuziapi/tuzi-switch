use opentu_connector::{
    configure, installed, publish, read_discovery, run_stdio, Discovery, SERVER_ID, STDIO_FLAG,
};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::Path,
    process::{Command, Stdio},
};

fn fixture(port: u16, token: char) -> Discovery {
    Discovery {
        endpoint: format!("http://127.0.0.1:{port}/mcp"),
        token: token.to_string().repeat(64),
    }
}
#[test]
fn private_discovery_rotates_and_rejects_unsafe_endpoints() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("private/runtime.json");
    publish(&path, &fixture(12345, 'a')).unwrap();
    publish(&path, &fixture(23456, 'b')).unwrap();
    assert_eq!(read_discovery(&path).unwrap().token, "b".repeat(64));
    for url in [
        "http://example.com:123/mcp",
        "http://127.0.0.1:123/other",
        "http://localhost:123/mcp",
        "http://user@127.0.0.1:123/mcp",
        "http://127.0.0.1:123/mcp?x=1",
    ] {
        let d = Discovery {
            endpoint: url.into(),
            token: "a".repeat(64),
        };
        assert!(publish(&path, &d).is_err());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_discovery(&path).is_err());
    }
}
#[test]
fn install_is_idempotent_and_uninstall_preserves_other_settings() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    let runtime = dir.path().join("runtime.json");
    let exe = Path::new(env!("CARGO_BIN_EXE_opentu-connector"));
    let original =
        "# user's comment\nmodel = \"existing\"\n[mcp_servers.other]\ncommand = \"keep-me\"\n";
    fs::write(&config, original).unwrap();
    configure(&config, &runtime, exe, false).unwrap();
    let once = fs::read_to_string(&config).unwrap();
    assert!(once.starts_with(original));
    assert!(!once.contains("Bearer"));
    assert!(!once.contains("http://"));
    assert!(installed(&config, &runtime).unwrap());
    configure(&config, &runtime, exe, false).unwrap();
    assert_eq!(once, fs::read_to_string(&config).unwrap());
    configure(&config, &runtime, exe, true).unwrap();
    assert_eq!(original, fs::read_to_string(&config).unwrap());
}
#[test]
fn collision_and_broken_toml_are_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    let runtime = dir.path().join("runtime.json");
    for original in [
        format!("[mcp_servers.{SERVER_ID}]\ncommand = \"user-owned\"\n"),
        "not [toml".into(),
        "mcp_servers = 4".into(),
    ] {
        fs::write(&config, &original).unwrap();
        assert!(configure(
            &config,
            &runtime,
            Path::new(env!("CARGO_BIN_EXE_opentu-connector")),
            false
        )
        .is_err());
        assert_eq!(original, fs::read_to_string(&config).unwrap());
    }
}
#[cfg(unix)]
#[test]
fn symlink_config_and_discovery_are_rejected() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    fs::write(&target, "untouched").unwrap();
    let link = dir.path().join("link");
    symlink(&target, &link).unwrap();
    assert!(publish(&link, &fixture(12345, 'a')).is_err());
    assert!(configure(
        &link,
        &dir.path().join("runtime"),
        Path::new(env!("CARGO_BIN_EXE_opentu-connector")),
        false
    )
    .is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
}
#[test]
fn malformed_input_and_unavailable_app_return_safe_errors() {
    let dir = tempfile::tempdir().unwrap();
    let input = b"bad\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/list\"}\n";
    let mut out = Vec::new();
    run_stdio(&dir.path().join("absent"), &input[..], &mut out).unwrap();
    let output = String::from_utf8(out).unwrap();
    let values: Vec<Value> = output
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    assert_eq!(values.len(), 2); // Notification produces no response.
    assert_eq!(values[0]["error"]["code"], -32700);
    assert_eq!(values[1]["id"], 7);
    assert!(values[1]["error"]["message"]
        .as_str()
        .unwrap()
        .contains("兔子助手"));
    assert!(!output.contains(dir.path().to_str().unwrap()));
}

fn serve_once(
    listener: TcpListener,
    token: char,
    tag: &'static str,
    redirect: bool,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut headers = String::new();
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if line.to_lowercase().starts_with("content-length:") {
                length = line
                    .split(':')
                    .nth(1)
                    .unwrap()
                    .trim()
                    .parse::<usize>()
                    .unwrap();
            }
            headers.push_str(&line);
        }
        assert!(headers.contains(&format!("Bearer {}", token.to_string().repeat(64))));
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let request: Value = serde_json::from_slice(&body).unwrap();
        if redirect {
            write!(stream, "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:9/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        } else {
            let response =
                json!({"jsonrpc":"2.0","id":request["id"],"result":{"server":tag}}).to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        }
    })
}
#[test]
fn same_stdio_process_follows_rotated_port_and_token_without_reconfiguration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("private/runtime.json");
    let first = TcpListener::bind("127.0.0.1:0").unwrap();
    publish(&path, &fixture(first.local_addr().unwrap().port(), 'a')).unwrap();
    let server1 = serve_once(first, 'a', "first-process", false);
    let mut child = Command::new(env!("CARGO_BIN_EXE_opentu-connector"))
        .arg(STDIO_FLAG)
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    writeln!(
        input,
        "{}",
        json!({"jsonrpc":"2.0","id":1,"method":"initialize"})
    )
    .unwrap();
    input.flush().unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["server"],
        "first-process"
    );
    server1.join().unwrap();
    let second = TcpListener::bind("127.0.0.1:0").unwrap();
    publish(&path, &fixture(second.local_addr().unwrap().port(), 'b')).unwrap();
    let server2 = serve_once(second, 'b', "restarted-process", false);
    writeln!(
        input,
        "{}",
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"synthetic"}})
    )
    .unwrap();
    input.flush().unwrap();
    line.clear();
    output.read_line(&mut line).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["result"]["server"],
        "restarted-process"
    );
    server2.join().unwrap();
    drop(input);
    assert!(child.wait().unwrap().success());
    let mut err = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut err)
        .unwrap();
    assert!(err.is_empty());
}
#[test]
fn redirect_is_not_followed_and_auth_never_enters_stdio_output() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("private/runtime.json");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    publish(&path, &fixture(listener.local_addr().unwrap().port(), 'c')).unwrap();
    let server = serve_once(listener, 'c', "redirect", true);
    let input = format!(
        "{}\n",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})
    );
    let mut output = Vec::new();
    run_stdio(&path, input.as_bytes(), &mut output).unwrap();
    let text = String::from_utf8(output).unwrap();
    assert!(!text.contains(&"c".repeat(64)));
    assert!(serde_json::from_str::<Value>(&text)
        .unwrap()
        .get("error")
        .is_some());
    server.join().unwrap();
}
