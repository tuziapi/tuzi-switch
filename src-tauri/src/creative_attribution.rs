//! Model usage attribution, not authentication or billing authority.
//! Apply at the final native transport boundary so account URL reconstruction
//! and the embedded web application's origin cannot erase desktop attribution.
use url::Url;

pub fn channel() -> u8 {
    channel_for(
        crate::release_repository::RELEASE_REPOSITORY,
        cfg!(feature = "isolated-profile"),
        cfg!(debug_assertions),
    )
}

fn channel_for(repository: &str, isolated: bool, debug: bool) -> u8 {
    if repository == "tuziapi/tuzi-switch" && !isolated && !debug {
        3
    } else {
        0
    }
}

fn is_model_path(path: &str) -> bool {
    let path = path.trim_end_matches('/');
    static MEDIA: std::sync::LazyLock<Vec<serde_json::Value>> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!(
            "../../src/features/creative/mediaActions.json"
        ))
        .expect("media contract")
    });
    if MEDIA.iter().any(|entry| {
        if entry["action"] == "suno.native.credits" {
            return false;
        }
        let template = entry["path"].as_str().unwrap().split('?').next().unwrap();
        if let Some((prefix, suffix)) = template.split_once("{taskId}") {
            path.strip_prefix(prefix)
                .and_then(|rest| rest.strip_suffix(suffix))
                .map(|id| !id.is_empty() && !id.contains('/'))
                .unwrap_or(false)
        } else {
            path == template
        }
    }) {
        return true;
    }
    [
        "/v1/chat/completions",
        "/v1/completions",
        "/v1/responses",
        "/v1/messages",
        "/v1/embeddings",
        "/v1/images/generations",
        "/v1/images/edits",
        "/v1/images/variations",
        "/v1/audio/speech",
        "/v1/audio/transcriptions",
        "/v1/audio/translations",
        "/v1/audio/generations",
        "/v1/videos",
        "/v2/video_generation",
    ]
    .contains(&path)
        || ((path.starts_with("/v1/models/") || path.starts_with("/v1beta/models/"))
            && [
                ":generateContent",
                ":streamGenerateContent",
                ":predict",
                ":predictLongRunning",
            ]
            .iter()
            .any(|suffix| path.ends_with(suffix)))
        || [
            "/v1/videos/",
            "/v1/responses/",
            "/v1/operations/",
            "/v1beta/operations/",
            "/mj/submit/",
            "/mj/task/",
            "/flux/v1/",
            "/kling/v1/videos/",
            "/v2/query/video_generation/",
            "/suno/submit/",
            "/suno/fetch/",
            "/suno/v2/",
        ]
        .iter()
        .any(|prefix| path.starts_with(prefix))
            && !path.ends_with("/content")
}

pub fn apply(mut url: Url, managed: bool) -> Url {
    let trusted = url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "api.tu-zi.com"
                    | "apius.tu-zi.com"
                    | "apicdn.tu-zi.com"
                    | "api.sydney-ai.com"
                    | "api.ourzhishi.top"
                    | "apisz.ourzhishi.top"
                    | "bus.tu-zi.com"
                    | "bus2.tu-zi.com"
                    | "bus3.tu-zi.com"
                    | "business.tu-zi.com"
            )
        );
    if !(managed || trusted) || !is_model_path(url.path()) {
        return url;
    }
    // Do not re-encode opaque/signed query components. Replace every encoded ch.
    let mut parts: Vec<String> = url
        .query()
        .into_iter()
        .flat_map(|query| query.split('&'))
        .filter(|part| {
            url::form_urlencoded::parse(part.as_bytes())
                .next()
                .map(|(key, _)| key != "ch")
                .unwrap_or(true)
        })
        .map(str::to_owned)
        .collect();
    parts.push(format!("ch={}", channel()));
    url.set_query(Some(&parts.join("&")));
    url
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_attribution_only_marks_official_release_builds() {
        assert_eq!(channel_for("tuziapi/tuzi-switch", false, false), 3);
        assert_eq!(channel_for("tuziapi/tuzi-switch", true, false), 0);
        assert_eq!(channel_for("tuziapi/tuzi-switch", false, true), 0);
        assert_eq!(channel_for("AiW520/tuzi-switch", false, false), 0);
    }
    #[test]
    fn desktop_attribution_replaces_web_channel_without_changing_query_bytes() {
        let url = Url::parse("https://api.tu-zi.com/v1/responses?sig=a+b%2F&ch=1&%63h=2&x=a%20b")
            .unwrap();
        assert_eq!(
            apply(url, false).query().unwrap(),
            format!("sig=a+b%2F&x=a%20b&ch={}", channel())
        );
    }
    #[test]
    fn desktop_attribution_leaves_external_and_metadata_urls_unchanged() {
        for value in [
            "https://other.test/v1/chat/completions?ch=1",
            "https://api.tu-zi.com.evil.test/v1/responses",
            "https://api.tu-zi.com/v1/models",
            "https://api.tu-zi.com/media/image.png?sig=a+b",
            "https://api.tu-zi.com/v1/videos/id/content?sig=a+b",
        ] {
            let url = Url::parse(value).unwrap();
            assert_eq!(apply(url.clone(), false), url);
        }
    }
    #[test]
    fn desktop_attribution_covers_media_contract_without_tagging_credit_metadata() {
        let entries: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../src/features/creative/mediaActions.json"
        ))
        .unwrap();
        for entry in entries {
            let path = entry["path"]
                .as_str()
                .unwrap()
                .replace("{taskId}", "synthetic");
            let url = Url::parse(&format!("https://api.tu-zi.com{path}")).unwrap();
            let tagged = apply(url, false).query_pairs().any(|(key, _)| key == "ch");
            assert_eq!(
                tagged,
                entry["action"] != "suno.native.credits",
                "{}",
                entry["action"]
            );
        }
    }
    #[test]
    fn desktop_attribution_is_applied_to_managed_loopback_model_fixture() {
        let url = Url::parse("http://127.0.0.1:3210/v1/images/generations").unwrap();
        assert_eq!(
            apply(url, true).query().unwrap(),
            format!("ch={}", channel())
        );
    }
}
