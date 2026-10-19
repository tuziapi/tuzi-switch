use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rule {
    aliases: Vec<String>,
    catalog_aliases: Vec<String>,
    paths: Vec<String>,
}

// The frontend uses this same table. Never infer a protocol from a model name.
static RULES: LazyLock<BTreeMap<String, Rule>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../src/lib/tuziEndpointProtocols.json"
    ))
    .expect("embedded endpoint protocol rules must be valid")
});

pub(super) fn endpoint_aliases(protocol: &str) -> &[String] {
    RULES
        .get(protocol)
        .map(|r| r.aliases.as_slice())
        .unwrap_or(&[])
}

pub(super) fn supports_protocol(model: &Value, protocol: &str) -> bool {
    let Some(rule) = RULES.get(protocol) else {
        return false;
    };
    let Some(types) = model["supported_endpoint_types"].as_array() else {
        return false;
    };
    types.iter().any(|value| {
        let Some(value) = value.as_str() else {
            return false;
        };
        let name = value.trim().to_lowercase();
        let standard = rule.aliases.contains(&name);
        if !standard && !rule.catalog_aliases.contains(&name) {
            return false;
        }
        let detail = model["endpoints"].as_object().and_then(|map| {
            map.get(value).or_else(|| {
                map.iter()
                    .find(|(k, _)| k.trim().to_lowercase() == name)
                    .map(|(_, v)| v)
            })
        });
        let Some(detail) = detail.filter(|d| !d.is_null()) else {
            return standard;
        };
        if !detail.is_string() && !detail.is_object() {
            return false;
        }
        let method = &detail["method"];
        if !method.is_null()
            && !method
                .as_str()
                .is_some_and(|m| m.trim().is_empty() || m.trim().eq_ignore_ascii_case("post"))
        {
            return false;
        }
        let path = if detail.is_string() {
            detail
        } else {
            &detail["path"]
        };
        if path.is_null() || path.as_str().is_some_and(|p| p.trim().is_empty()) {
            return standard;
        }
        path.as_str().is_some_and(|p| {
            rule.paths
                .iter()
                .any(|known| known == p.trim().trim_end_matches('/'))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_contract_cases_match_frontend() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/tuzi-endpoint-compatibility.json"
        ))
        .unwrap();
        for case in cases {
            for protocol in ["anthropic", "responses", "chat", "gemini"] {
                let expected = case["protocols"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p == protocol);
                assert_eq!(
                    supports_protocol(&case["model"], protocol),
                    expected,
                    "case {} / {protocol}",
                    case["name"]
                );
            }
        }
    }
}
