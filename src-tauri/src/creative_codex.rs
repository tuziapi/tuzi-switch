//! Discussion-only Codex App Server bridge. No credentials, terminal or file paths
//! cross the WebView boundary. Processes are bounded and reaped after each use.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_LINE: usize = 2 * 1024 * 1024;
const MAX_OUTPUT: usize = 2 * 1024 * 1024;
static PENDING: LazyLock<Mutex<BTreeMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static PROBING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    id: String,
    name: String,
    efforts: Vec<String>,
    default_effort: Option<String>,
    supports_images: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProbe {
    models: Vec<CodexModel>,
    default_model: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexRequest {
    request_id: String,
    model: String,
    effort: Option<String>,
    prompt: String,
    images: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CodexEvent {
    Ready,
    Delta { content: String, reasoning: String },
    Complete { content: String, reasoning: String },
}

fn candidates() -> Vec<PathBuf> {
    // Locate the installed executable independently of the preview data profile.
    let home = dirs::home_dir().unwrap_or_else(crate::config::get_home_dir);
    let mut paths = vec![PathBuf::from("codex")];
    for suffix in [
        ".npm-global/bin/codex",
        ".local/bin/codex",
        ".volta/bin/codex",
    ] {
        paths.push(home.join(suffix));
    }
    #[cfg(target_os = "macos")]
    paths.extend([
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ]);
    paths
}

struct Rpc {
    child: Child,
    stdin: ChildStdin,
    receiver: mpsc::Receiver<Result<Value, String>>,
    events: VecDeque<Value>,
    cwd: PathBuf,
}
impl Drop for Rpc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Rpc {
    fn spawn() -> Result<Self, String> {
        let cwd = crate::config::get_app_config_dir().join("codex-discussion");
        std::fs::create_dir_all(&cwd).map_err(|_| "codex_workspace_unavailable")?;
        for path in candidates() {
            if path.is_absolute() && !path.is_file() {
                continue;
            }
            let mut command = Command::new(path);
            command.args(["app-server", "--listen", "stdio://"]);
            for feature in [
                "shell_tool",
                "multi_agent",
                "image_generation",
                "apps",
                "plugins",
                "hooks",
                "view_image",
            ] {
                command.args(["--disable", feature]);
            }
            command
                .args(["-c", "web_search=\"disabled\""])
                .current_dir(&cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let Ok(mut child) = command.spawn() else {
                continue;
            };
            let stdin = child.stdin.take().ok_or("codex_pipe_failed")?;
            let stdout = child.stdout.take().ok_or("codex_pipe_failed")?;
            let (sender, receiver) = mpsc::sync_channel(16);
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    let mut bytes = Vec::new();
                    let result = reader
                        .by_ref()
                        .take((MAX_LINE + 1) as u64)
                        .read_until(b'\n', &mut bytes);
                    let message = match result {
                        Ok(0) => break,
                        Ok(n) if n <= MAX_LINE => serde_json::from_slice(&bytes)
                            .map_err(|_| "codex_invalid_protocol".to_string()),
                        _ => Err("codex_invalid_protocol".to_string()),
                    };
                    let failed = message.is_err();
                    if sender.send(message).is_err() || failed {
                        break;
                    }
                }
            });
            return Ok(Self {
                child,
                stdin,
                receiver,
                events: VecDeque::new(),
                cwd,
            });
        }
        Err("codex_not_found".into())
    }
    fn send(&mut self, value: Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, &value).map_err(|_| "codex_connection_lost")?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|_| "codex_connection_lost".into())
    }
    fn read(&mut self, cancel: &AtomicBool, deadline: Instant) -> Result<Value, String> {
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("codex_cancelled".into());
            }
            if Instant::now() >= deadline {
                return Err("codex_timeout".into());
            }
            match self.receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Timeout) => (),
                Err(_) => return Err("codex_connection_lost".into()),
            }
        }
    }
    fn reject_tool(&mut self, value: &Value) -> Result<bool, String> {
        if value.get("id").is_some() && value.get("method").is_some() {
            self.send(json!({"id":value["id"],"error":{"code":-32601,"message":"Discussion only: local tools are unavailable"}}))?;
            return Ok(true);
        }
        Ok(false)
    }
    fn call(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("codex_cancelled".into());
        }
        self.send(json!({"id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let value = self.read(cancel, deadline)?;
            if self.reject_tool(&value)? {
                return Err("codex_tools_unavailable".into());
            }
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if value.get("error").is_some() {
                    return Err("codex_request_rejected".into());
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or("codex_invalid_protocol".into());
            }
            if self.events.len() >= 256 {
                return Err("codex_invalid_protocol".into());
            }
            self.events.push_back(value);
        }
    }
    fn initialize(&mut self, cancel: &AtomicBool) -> Result<(), String> {
        self.call(
            1,
            "initialize",
            json!({"clientInfo":{"name":"tuzi_discussion","version":env!("CARGO_PKG_VERSION")}}),
            cancel,
        )?;
        self.send(json!({"method":"initialized","params":{}}))
    }
}

fn parse_models(data: &Value) -> Vec<CodexModel> {
    data.as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            if model["hidden"].as_bool() == Some(true) {
                return None;
            }
            let id = model["model"].as_str().or_else(|| model["id"].as_str())?;
            if id.is_empty() || id.len() > 200 {
                return None;
            }
            Some(CodexModel {
                id: id.into(),
                name: model["displayName"]
                    .as_str()
                    .unwrap_or(id)
                    .chars()
                    .take(200)
                    .collect(),
                efforts: model["supportedReasoningEfforts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|e| e["reasoningEffort"].as_str())
                    .map(str::to_owned)
                    .collect(),
                default_effort: model["defaultReasoningEffort"].as_str().map(str::to_owned),
                supports_images: model["inputModalities"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|v| v == "image")),
            })
        })
        .collect()
}
fn catalog(rpc: &mut Rpc, cancel: &AtomicBool) -> Result<(CodexProbe, Value), String> {
    let config = rpc.call(
        2,
        "config/read",
        json!({"cwd":rpc.cwd,"includeLayers":false}),
        cancel,
    )?;
    let configured = config["config"]["model"].as_str().unwrap_or("");
    let mut models = Vec::new();
    let mut cursor = Value::Null;
    for page in 0..10 {
        let result = rpc.call(
            10 + page,
            "model/list",
            json!({"limit":100,"cursor":cursor,"includeHidden":false}),
            cancel,
        )?;
        models.extend(parse_models(&result["data"]));
        cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
        if cursor.is_null() {
            break;
        }
    }
    // Catalog remains authoritative; a configured model missing from it is not silently substituted.
    if models.is_empty() {
        return Err("codex_no_models".into());
    }
    let default_model = models
        .iter()
        .find(|m| m.id == configured)
        .unwrap_or(&models[0])
        .id
        .clone();
    Ok((
        CodexProbe {
            models,
            default_model,
        },
        config,
    ))
}

fn validate(request: &CodexRequest) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || request.model.is_empty()
        || request.model.len() > 200
        || request.prompt.is_empty()
        || request.prompt.len() > 3_200_000
        || request.images.len() > 6
        || request.images.iter().map(String::len).sum::<usize>() > 16 * 1024 * 1024
        || request.images.iter().any(|v| {
            ![
                "data:image/png;base64,",
                "data:image/jpeg;base64,",
                "data:image/webp;base64,",
                "data:image/gif;base64,",
            ]
            .iter()
            .any(|p| v.starts_with(p))
        })
    {
        return Err("codex_invalid_input".into());
    }
    Ok(())
}

fn plan_schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["content","next"],"properties":{
        "content":{"type":"string"},"next":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["mcp","args"],"properties":{
            "mcp":{"type":"string","enum":["generate_image","generate_video","generate_audio","generate_text"]},
            "args":{"type":"object","additionalProperties":false,"required":["prompt","count"],"properties":{"prompt":{"type":"string"},"count":{"type":"integer"}}}
        }}}
    }})
}

fn run(
    request: &CodexRequest,
    cancel: &AtomicBool,
    emit: impl Fn(CodexEvent) -> Result<(), String>,
) -> Result<(), String> {
    validate(request)?;
    run_with_rpc(request, cancel, emit, Rpc::spawn()?)
}
fn run_with_rpc(
    request: &CodexRequest,
    cancel: &AtomicBool,
    emit: impl Fn(CodexEvent) -> Result<(), String>,
    mut rpc: Rpc,
) -> Result<(), String> {
    rpc.initialize(cancel)?;
    let (catalog, config) = catalog(&mut rpc, cancel)?;
    let model = catalog
        .models
        .iter()
        .find(|m| m.id == request.model)
        .ok_or("codex_model_unavailable")?;
    if request
        .effort
        .as_ref()
        .is_some_and(|e| !model.efforts.contains(e))
    {
        return Err("codex_model_unavailable".into());
    }
    if !request.images.is_empty() && !model.supports_images {
        return Err("codex_images_unsupported".into());
    }
    let mut disabled_mcp = serde_json::Map::new();
    if let Some(servers) = config["config"]["mcp_servers"].as_object() {
        for name in servers.keys() {
            disabled_mcp.insert(name.clone(), json!({"enabled":false}));
        }
    }
    let started = rpc.call(30, "thread/start", json!({
        "model":request.model,"cwd":rpc.cwd,"ephemeral":true,"sandbox":"read-only","approvalPolicy":"never",
        "config":{"mcp_servers":disabled_mcp},
        "baseInstructions":"You are a creative discussion planner. Use only the supplied conversation and images. Do not use tools, execute commands, read files or generate media. Return the requested JSON plan. Generation is performed by the host only after user confirmation."
    }), cancel)?;
    if started
        .get("model")
        .and_then(Value::as_str)
        .is_some_and(|m| m != request.model)
    {
        return Err("codex_model_unavailable".into());
    }
    let thread = started["thread"]["id"]
        .as_str()
        .ok_or("codex_invalid_protocol")?
        .to_owned();
    rpc.events.clear();
    let mut input = vec![json!({"type":"text","text":request.prompt,"text_elements":[]})];
    input.extend(
        request
            .images
            .iter()
            .map(|url| json!({"type":"image","url":url})),
    );
    let turn = rpc.call(31, "turn/start", json!({"threadId":thread,"model":request.model,"effort":request.effort,
        "input":input,"summary":"auto","outputSchema":plan_schema(),"sandboxPolicy":{"type":"readOnly","networkAccess":false},"approvalPolicy":"never"}), cancel)?;
    let turn_id = turn["turn"]["id"]
        .as_str()
        .ok_or("codex_invalid_protocol")?
        .to_owned();
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut final_content = None;
    let outcome = (|| loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("codex_cancelled".to_string());
        }
        let value = match rpc.events.pop_front() {
            Some(v) => v,
            None => rpc.read(cancel, deadline)?,
        };
        if rpc.reject_tool(&value)? {
            return Err("codex_tools_unavailable".into());
        }
        let params = &value["params"];
        if params
            .get("threadId")
            .and_then(Value::as_str)
            .is_some_and(|id| id != thread)
            || params
                .get("turnId")
                .and_then(Value::as_str)
                .is_some_and(|id| id != turn_id)
        {
            continue;
        }
        match value["method"].as_str().unwrap_or("") {
            "item/agentMessage/delta" | "item/reasoning/summaryTextDelta" => {
                let delta = params["delta"].as_str().ok_or("codex_invalid_protocol")?;
                let is_reasoning = value["method"] == "item/reasoning/summaryTextDelta";
                if is_reasoning {
                    reasoning.push_str(delta);
                } else {
                    content.push_str(delta);
                }
                if content.len() + reasoning.len() > MAX_OUTPUT {
                    return Err("codex_output_too_large".into());
                }
                emit(CodexEvent::Delta {
                    content: if is_reasoning {
                        String::new()
                    } else {
                        delta.into()
                    },
                    reasoning: if is_reasoning {
                        delta.into()
                    } else {
                        String::new()
                    },
                })?;
            }
            "item/completed" if params["item"]["type"] == "agentMessage" => {
                if let Some(text) = params["item"]["text"].as_str() {
                    if text.len() > MAX_OUTPUT {
                        return Err("codex_output_too_large".into());
                    }
                    final_content = Some(text.to_owned());
                }
            }
            "error" if params["willRetry"].as_bool() != Some(true) => {
                return Err("codex_turn_failed".into())
            }
            "turn/completed" => {
                if params["turn"]["id"].as_str() != Some(&turn_id) {
                    continue;
                }
                if params["turn"]["status"] != "completed" {
                    return Err("codex_turn_failed".into());
                }
                let final_text = final_content.unwrap_or(content);
                if final_text.trim().is_empty() {
                    return Err("codex_empty_response".into());
                }
                return emit(CodexEvent::Complete {
                    content: final_text,
                    reasoning,
                });
            }
            _ => (),
        }
    })();
    if outcome.is_err() {
        let _ = rpc.send(json!({"id":99,"method":"turn/interrupt","params":{"threadId":thread,"turnId":turn_id}}));
        let _ = rpc.receiver.recv_timeout(Duration::from_millis(250));
    }
    outcome
}

#[tauri::command]
pub async fn creative_codex_probe() -> Result<CodexProbe, String> {
    if PROBING.swap(true, Ordering::SeqCst) {
        return Err("codex_busy".into());
    }
    let result = tauri::async_runtime::spawn_blocking(|| {
        let cancel = AtomicBool::new(false);
        let mut rpc = Rpc::spawn()?;
        rpc.initialize(&cancel)?;
        catalog(&mut rpc, &cancel).map(|(probe, _)| probe)
    })
    .await
    .map_err(|_| "codex_connection_lost".to_string())
    .and_then(|r| r);
    PROBING.store(false, Ordering::SeqCst);
    result
}
#[tauri::command]
pub async fn creative_codex_chat(
    request: CodexRequest,
    on_event: tauri::ipc::Channel<CodexEvent>,
) -> Result<(), String> {
    validate(&request)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut pending = PENDING.lock().map_err(|_| "codex_busy")?;
        if pending.len() >= 2 || pending.contains_key(&request.request_id) {
            return Err("codex_busy".into());
        }
        pending.insert(request.request_id.clone(), cancel.clone());
    }
    let id = request.request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        on_event
            .send(CodexEvent::Ready)
            .map_err(|_| "codex_connection_lost")?;
        run(&request, &cancel, |event| {
            on_event
                .send(event)
                .map_err(|_| "codex_connection_lost".into())
        })
    })
    .await
    .map_err(|_| "codex_connection_lost".to_string())
    .and_then(|r| r);
    if let Ok(mut pending) = PENDING.lock() {
        pending.remove(&id);
    }
    result
}
#[tauri::command]
pub fn creative_codex_cancel(request_id: String) {
    if let Ok(pending) = PENDING.lock() {
        if let Some(cancel) = pending.get(&request_id) {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_input_without_paths_or_remote_images() {
        let mut request = CodexRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            model: "synthetic".into(),
            effort: None,
            prompt: "hello".into(),
            images: vec![],
        };
        assert!(validate(&request).is_ok());
        request.images.push("file:///private/file.png".into());
        assert!(validate(&request).is_err());
        request.images = vec!["https://example.org/image.png".into()];
        assert!(validate(&request).is_err());
        request.images = vec!["data:image/png;base64,AAAA".into()];
        assert!(validate(&request).is_ok());
        request.request_id = "bad".into();
        assert!(validate(&request).is_err());
    }
    #[test]
    fn model_catalog_preserves_ids_and_capabilities() {
        let models = parse_models(&json!([
            {"id":"catalog-id","model":"actual-model","displayName":"Synthetic", "supportedReasoningEfforts":[{"reasoningEffort":"high"}],"defaultReasoningEffort":"high","inputModalities":["text","image"]},
            {"id":"hidden","hidden":true}, {"id":""}
        ]));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "actual-model");
        assert_eq!(models[0].efforts, vec!["high"]);
        assert!(models[0].supports_images);
    }
    #[test]
    fn output_schema_cannot_choose_execution_model_or_paths() {
        let schema = plan_schema();
        let args = &schema["properties"]["next"]["items"]["properties"]["args"];
        assert_eq!(args["additionalProperties"], false);
        assert!(args["properties"].get("model").is_none());
        assert!(args["properties"].get("path").is_none());
    }

    #[cfg(unix)]
    fn fake_rpc(mode: &str) -> (Rpc, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let script = r#"
import sys,json
mode=sys.argv[1]
def emit(v): print(json.dumps(v),flush=True)
for line in sys.stdin:
 r=json.loads(line); method=r.get('method'); i=r.get('id')
 if method=='initialized': continue
 if method=='initialize': value={}
 elif method=='config/read': value={'config':{'model':'synthetic','mcp_servers':{'must-disable':{'enabled':True}}}}
 elif method=='model/list': value={'data':[{'id':'synthetic','model':'synthetic','supportedReasoningEfforts':[],'inputModalities':['text']}],'nextCursor':None}
 elif method=='thread/start':
  assert r['params']['config']['mcp_servers']['must-disable']['enabled']==False
  assert r['params']['ephemeral']==True and r['params']['approvalPolicy']=='never'
  value={'thread':{'id':'thread-qa'},'model':'synthetic'}
 elif method=='turn/start':
  assert r['params']['outputSchema']['additionalProperties']==False
  if mode=='drop': sys.exit(0)
  emit({'method':'item/reasoning/summaryTextDelta','params':{'threadId':'thread-qa','turnId':'turn-qa','delta':'summary'}})
  emit({'id':i,'result':{'turn':{'id':'turn-qa'}}})
  if mode=='hold': continue
  if mode=='tool': emit({'id':99,'method':'item/commandExecution/requestApproval','params':{}});continue
  emit({'method':'item/agentMessage/delta','params':{'threadId':'wrong-thread','turnId':'turn-qa','delta':'LEAK'}})
  emit({'method':'item/agentMessage/delta','params':{'threadId':'thread-qa','turnId':'turn-qa','delta':'partial'}})
  emit({'method':'item/completed','params':{'threadId':'thread-qa','turnId':'turn-qa','item':{'type':'agentMessage','text':'{"content":"final","next":[]}'}}})
  emit({'method':'turn/completed','params':{'threadId':'thread-qa','turn':{'id':'turn-qa','status':'completed'}}})
  continue
 elif method=='turn/interrupt': value={}
 else: continue
 emit({'id':i,'result':value})
"#;
        let mut child = Command::new("/usr/bin/python3")
            .args(["-u", "-c", script, mode])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, receiver) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let value = line
                    .map_err(|_| "read".to_string())
                    .and_then(|s| serde_json::from_str(&s).map_err(|_| "parse".into()));
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        (
            Rpc {
                child,
                stdin,
                receiver,
                events: VecDeque::new(),
                cwd: dir.path().to_owned(),
            },
            dir,
        )
    }
    #[cfg(unix)]
    fn fake_request() -> CodexRequest {
        CodexRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            model: "synthetic".into(),
            effort: None,
            prompt: "synthetic only".into(),
            images: vec![],
        }
    }
    #[test]
    #[cfg(unix)]
    fn protocol_stream_handles_early_events_final_text_and_thread_isolation() {
        let (rpc, _dir) = fake_rpc("complete");
        let events = Mutex::new(Vec::new());
        run_with_rpc(
            &fake_request(),
            &AtomicBool::new(false),
            |e| {
                events
                    .lock()
                    .unwrap()
                    .push(serde_json::to_value(e).unwrap());
                Ok(())
            },
            rpc,
        )
        .unwrap();
        let events = events.into_inner().unwrap();
        assert_eq!(events[0]["reasoning"], "summary");
        assert_eq!(
            events.last().unwrap()["content"],
            "{\"content\":\"final\",\"next\":[]}"
        );
        assert!(!format!("{events:?}").contains("LEAK"));
    }
    #[test]
    #[cfg(unix)]
    fn protocol_rejects_tool_execution_and_never_accepts_incomplete_output() {
        for mode in ["tool", "drop"] {
            let (rpc, _dir) = fake_rpc(mode);
            let result = run_with_rpc(&fake_request(), &AtomicBool::new(false), |_| Ok(()), rpc);
            assert_eq!(
                result.unwrap_err(),
                if mode == "tool" {
                    "codex_tools_unavailable"
                } else {
                    "codex_connection_lost"
                }
            );
        }
    }
    #[test]
    #[cfg(unix)]
    fn cancellation_interrupts_a_waiting_turn() {
        let (rpc, _dir) = fake_rpc("hold");
        let cancel = AtomicBool::new(false);
        let result = run_with_rpc(
            &fake_request(),
            &cancel,
            |_| {
                cancel.store(true, Ordering::SeqCst);
                Ok(())
            },
            rpc,
        );
        assert_eq!(result.unwrap_err(), "codex_cancelled");
    }
}
