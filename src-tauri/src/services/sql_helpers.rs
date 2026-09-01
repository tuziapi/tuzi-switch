//! 使用统计中的输入 Token 语义归一化。

pub(crate) const INPUT_TOKEN_SEMANTICS_LEGACY: i64 = 0;
pub(crate) const INPUT_TOKEN_SEMANTICS_TOTAL: i64 = 1;
pub(crate) const INPUT_TOKEN_SEMANTICS_FRESH: i64 = 2;

pub(crate) const CACHE_INCLUSIVE_APP_TYPES: &[&str] = &["codex", "gemini", "grokbuild"];

pub(crate) fn is_cache_inclusive_app(app_type: &str) -> bool {
    CACHE_INCLUSIVE_APP_TYPES.contains(&app_type)
}

pub(crate) fn fresh_input_tokens(
    input_tokens: u32,
    cache_read_tokens: u32,
    cache_creation_tokens: u32,
    input_token_semantics: i64,
    cache_inclusive: bool,
) -> u32 {
    match input_token_semantics {
        INPUT_TOKEN_SEMANTICS_FRESH => input_tokens,
        INPUT_TOKEN_SEMANTICS_TOTAL if cache_inclusive => input_tokens
            .saturating_sub(cache_read_tokens)
            .saturating_sub(cache_creation_tokens),
        INPUT_TOKEN_SEMANTICS_LEGACY if cache_inclusive => {
            input_tokens.saturating_sub(cache_read_tokens)
        }
        _ => input_tokens,
    }
}

/// 返回 fresh input SQL。历史数据只扣 cache read；明确 TOTAL 的新数据同时扣
/// cache read/write；FRESH 和 Claude 风格数据保持原值。
pub(crate) fn fresh_input_sql(alias: &str) -> String {
    let prefix = if alias.is_empty() {
        String::new()
    } else {
        format!("{alias}.")
    };
    let apps = CACHE_INCLUSIVE_APP_TYPES
        .iter()
        .map(|app| format!("'{app}'"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "CASE WHEN {prefix}input_token_semantics = {INPUT_TOKEN_SEMANTICS_FRESH} THEN {prefix}input_tokens \
         WHEN {prefix}app_type IN ({apps}) AND {prefix}input_token_semantics = {INPUT_TOKEN_SEMANTICS_TOTAL} \
              AND {prefix}input_tokens >= ({prefix}cache_read_tokens + {prefix}cache_creation_tokens) \
              THEN {prefix}input_tokens - {prefix}cache_read_tokens - {prefix}cache_creation_tokens \
         WHEN {prefix}app_type IN ({apps}) AND {prefix}input_token_semantics = {INPUT_TOKEN_SEMANTICS_LEGACY} \
              AND {prefix}input_tokens >= {prefix}cache_read_tokens \
              THEN {prefix}input_tokens - {prefix}cache_read_tokens \
         ELSE {prefix}input_tokens END"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn normalizes_total_and_preserves_fresh() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE logs (app_type TEXT, input_tokens INTEGER, cache_read_tokens INTEGER, cache_creation_tokens INTEGER, input_token_semantics INTEGER)").unwrap();
        conn.execute("INSERT INTO logs VALUES ('codex', 1000, 300, 200, 1), ('codex', 500, 300, 200, 2), ('claude', 200, 100, 50, 0)", []).unwrap();
        let sql = format!("SELECT SUM({}) FROM logs l", fresh_input_sql("l"));
        let total: i64 = conn.query_row(&sql, [], |row| row.get(0)).unwrap();
        assert_eq!(total, 500 + 500 + 200);
    }

    #[test]
    fn normalizes_all_input_semantics_by_protocol() {
        assert_eq!(
            fresh_input_tokens(1000, 300, 200, INPUT_TOKEN_SEMANTICS_TOTAL, true),
            500
        );
        assert_eq!(
            fresh_input_tokens(1000, 300, 200, INPUT_TOKEN_SEMANTICS_LEGACY, true),
            700
        );
        assert_eq!(
            fresh_input_tokens(500, 300, 200, INPUT_TOKEN_SEMANTICS_FRESH, true),
            500
        );
        assert_eq!(
            fresh_input_tokens(500, 300, 200, INPUT_TOKEN_SEMANTICS_LEGACY, false),
            500
        );
    }
}
