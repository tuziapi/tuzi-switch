//! HTTP content-encoding 工具。
//!
//! reqwest 的自动解压已禁用（为了透传 accept-encoding），需要手动解压。
//! 请求侧（如 Codex Desktop 在登录态发压缩请求体）与响应侧（上游压缩响应体）
//! 共用同一套解压逻辑。

use axum::http::header::HeaderMap;
use std::io::Read;

const MAX_INTERMEDIATE_ENCODING_OVERHEAD: usize = 64 * 1024;

/// 把 content-encoding 值拆成有序 coding 列表（去掉 identity 与空值）。
///
/// HTTP 允许堆叠编码（如 `gzip, zstd`），各 coding 以逗号分隔；亦允许重复
/// content-encoding 头，语义等同逗号拼接（见 [`get_content_encoding`]）。
fn split_codings(content_encoding: &str) -> Vec<&str> {
    content_encoding
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty() && *c != "identity")
        .collect()
}

/// 单个 coding 是否可被解压。
fn is_single_supported(coding: &str) -> bool {
    matches!(
        coding,
        "gzip" | "x-gzip" | "deflate" | "br" | "zstd" | "zst"
    )
}

fn read_to_end_limited(
    reader: impl Read,
    max_output_bytes: usize,
) -> Result<Vec<u8>, std::io::Error> {
    let mut output = Vec::with_capacity(max_output_bytes.min(64 * 1024));
    let mut limited = reader.take(max_output_bytes.saturating_add(1) as u64);
    limited.read_to_end(&mut output)?;
    if output.len() > max_output_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("decompressed body exceeds {max_output_bytes} bytes"),
        ));
    }
    Ok(output)
}

fn decompress_single_limited(
    coding: &str,
    body: &[u8],
    max_output_bytes: usize,
) -> Result<Option<Vec<u8>>, std::io::Error> {
    match coding {
        "gzip" | "x-gzip" => {
            read_to_end_limited(flate2::read::GzDecoder::new(body), max_output_bytes).map(Some)
        }
        "deflate" => {
            match read_to_end_limited(flate2::read::ZlibDecoder::new(body), max_output_bytes) {
                Ok(output) => Ok(Some(output)),
                Err(zlib_error)
                    if !zlib_error
                        .to_string()
                        .starts_with("decompressed body exceeds") =>
                {
                    log::debug!("deflate 按 zlib 解压失败（{zlib_error}），回退 raw deflate");
                    read_to_end_limited(flate2::read::DeflateDecoder::new(body), max_output_bytes)
                        .map(Some)
                }
                Err(error) => Err(error),
            }
        }
        "br" => read_to_end_limited(
            brotli::Decompressor::new(std::io::Cursor::new(body), 4096),
            max_output_bytes,
        )
        .map(Some),
        "zstd" | "zst" => {
            let decoder = zstd::stream::read::Decoder::new(std::io::Cursor::new(body))?;
            read_to_end_limited(decoder, max_output_bytes).map(Some)
        }
        _ => Ok(None),
    }
}

/// 请求侧在解析压缩 JSON 前使用此入口，避免小压缩包膨胀为大内存对象。
pub(crate) fn decompress_body_limited(
    content_encoding: &str,
    body: &[u8],
    max_output_bytes: usize,
) -> Result<Option<Vec<u8>>, std::io::Error> {
    let codings = split_codings(content_encoding);
    if codings.is_empty() {
        return Ok(None);
    }
    if !codings.iter().all(|coding| is_single_supported(coding)) {
        log::warn!("不支持的 content-encoding: {content_encoding}，跳过解压");
        return Ok(None);
    }

    let mut data: Option<Vec<u8>> = None;
    for (index, coding) in codings.iter().rev().enumerate() {
        let input = data.as_deref().unwrap_or(body);
        let layer_limit = if index + 1 == codings.len() {
            max_output_bytes
        } else {
            max_output_bytes.saturating_add(MAX_INTERMEDIATE_ENCODING_OVERHEAD)
        };
        match decompress_single_limited(coding, input, layer_limit)? {
            Some(decompressed) => data = Some(decompressed),
            None => return Ok(None),
        }
    }
    Ok(data)
}

/// 从 header 提取 content-encoding（合并重复头，忽略 identity 与空值）。
///
/// HTTP 允许重复 content-encoding 头，语义等同逗号拼接，故用 `get_all` 合并；
/// 返回值可能含多个逗号分隔的 coding，交由 [`decompress_body`] 反向解码。
pub(crate) fn get_content_encoding(headers: &HeaderMap) -> Option<String> {
    let combined = headers
        .get_all("content-encoding")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
        .to_lowercase();
    if split_codings(&combined).is_empty() {
        return None;
    }
    Some(combined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn decompress_body_limited_handles_zlib_wrapped_deflate() {
        // RFC 9110 规范的 deflate = zlib 包裹格式（合规来源发的就是这个）
        let payload = br#"{"ok":true}"#;
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut encoder, payload).unwrap();
        let compressed = encoder.finish().unwrap();

        let decompressed = decompress_body_limited("deflate", &compressed, payload.len())
            .unwrap()
            .unwrap();
        assert_eq!(decompressed, payload);
    }

    #[test]
    fn decompress_body_limited_falls_back_to_raw_deflate() {
        // 部分来源违规发 raw deflate 流，保持兼容
        let payload = br#"{"ok":true}"#;
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut encoder, payload).unwrap();
        let compressed = encoder.finish().unwrap();

        let decompressed = decompress_body_limited("deflate", &compressed, payload.len())
            .unwrap()
            .unwrap();
        assert_eq!(decompressed, payload);
    }

    #[test]
    fn decompress_body_limited_zstd_roundtrip() {
        // Codex 登录态发的就是 zstd 压缩请求体
        let payload = br#"{"hello":"world","n":42}"#;
        let compressed = zstd::stream::encode_all(std::io::Cursor::new(&payload[..]), 0).unwrap();
        let decompressed = decompress_body_limited("zstd", &compressed, payload.len())
            .unwrap()
            .unwrap();
        assert_eq!(decompressed, payload);
    }

    #[test]
    fn decompress_body_limited_rejects_output_over_limit() {
        let payload = vec![b'a'; 1024 * 1024];
        let compressed = zstd::stream::encode_all(std::io::Cursor::new(&payload), 3).unwrap();

        let error = decompress_body_limited("zstd", &compressed, 32 * 1024)
            .expect_err("expanded output must be limited");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn decompress_body_limited_accepts_output_at_limit() {
        let payload = br#"{"model":"gpt-image-2"}"#;
        let compressed = zstd::stream::encode_all(std::io::Cursor::new(payload), 0).unwrap();

        let decompressed = decompress_body_limited("zstd", &compressed, payload.len())
            .unwrap()
            .unwrap();
        assert_eq!(decompressed, payload);
    }

    #[test]
    fn decompress_body_limited_stacked_gzip_then_zstd_decodes_in_reverse() {
        // Content-Encoding: gzip, zstd 表示先 gzip 后 zstd，解压须反向（先 zstd 后 gzip）
        let payload = br#"{"stacked":true}"#;
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, payload).unwrap();
        let gzipped = gz.finish().unwrap();
        let stacked = zstd::stream::encode_all(std::io::Cursor::new(&gzipped[..]), 0).unwrap();

        let decompressed = decompress_body_limited("gzip, zstd", &stacked, payload.len())
            .unwrap()
            .unwrap();
        assert_eq!(decompressed, payload);
    }

    #[test]
    fn decompress_body_limited_stacked_with_unsupported_returns_none() {
        // 堆叠里只要有一个不支持，就整体保头透传
        let result = decompress_body_limited("snappy, zstd", b"\x00\x01\x02\x03", 1024).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn decompress_body_limited_unknown_encoding_returns_none() {
        // 未知编码必须返回 None（而非伪装成"已解码"），否则 content-encoding
        // 头被剥掉，下游诊断会把压缩字节误报成明文
        let result = decompress_body_limited("snappy", b"\x00\x01\x02\x03", 1024).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn get_content_encoding_combines_repeated_headers() {
        // 重复的 content-encoding 头等同逗号拼接，须用 get_all 合并
        let mut headers = HeaderMap::new();
        headers.append("content-encoding", HeaderValue::from_static("gzip"));
        headers.append("content-encoding", HeaderValue::from_static("zstd"));
        assert_eq!(
            get_content_encoding(&headers).as_deref(),
            Some("gzip, zstd")
        );
    }

    #[test]
    fn get_content_encoding_ignores_identity_only() {
        let mut headers = HeaderMap::new();
        headers.append("content-encoding", HeaderValue::from_static("identity"));
        assert_eq!(get_content_encoding(&headers), None);
    }
}
