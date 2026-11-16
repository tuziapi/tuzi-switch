//! 本地听写（SenseVoice）：转写引擎、Claude 原生听写的流式协议、独立的本机听写服务。

pub mod engine;
pub mod server;
pub mod stream;

pub use engine::{EngineError, model_dir, model_ready, model_status, prepare_model};
