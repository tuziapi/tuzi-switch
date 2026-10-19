//! One-use clipboard permission, armed only by the assistant's explicit website action.
use std::time::{Duration, Instant};

pub(super) struct TokenPrefill {
    started: Instant,
    generation: u64,
    returned: bool,
}
impl TokenPrefill {
    pub fn new(generation: u64) -> Self {
        Self {
            started: Instant::now(),
            generation,
            returned: false,
        }
    }
    pub fn returned(&mut self) {
        self.returned = true;
    }
    pub fn permits(&self, generation: u64) -> bool {
        self.returned
            && self.generation == generation
            && self.started.elapsed() < Duration::from_secs(300)
    }
}

// Website system tokens are 29–32 Base62 characters. Model keys and arbitrary
// clipboard prose are excluded. Legacy formats remain available via manual paste.
pub(super) fn is_system_token_candidate(value: &str) -> bool {
    // The debug-only loopback website seeds these two explicit synthetic tokens.
    // Keep that fixture usable without changing real token format acceptance.
    #[cfg(feature = "local-preview")]
    if matches!(
        value,
        "synthetic-system-token-preview-local-only-2026"
            | "synthetic-system-token-preview-admin-local-only-2026"
    ) {
        return true;
    }
    (29..=32).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_return_current_generation_and_unexpired_permission() {
        let mut pending = TokenPrefill::new(7);
        assert!(!pending.permits(7));
        pending.returned();
        assert!(pending.permits(7));
        assert!(!pending.permits(8));
        pending.started = Instant::now() - Duration::from_secs(301);
        assert!(!pending.permits(7));
    }
    #[test]
    fn synthetic_preview_tokens_are_restricted_to_preview_builds() {
        for value in [
            "synthetic-system-token-preview-local-only-2026",
            "synthetic-system-token-preview-admin-local-only-2026",
        ] {
            assert_eq!(
                is_system_token_candidate(value),
                cfg!(feature = "local-preview")
            );
        }
        assert!(!is_system_token_candidate(
            "synthetic-system-token-other-local-only-2026"
        ));
    }
    #[test]
    fn rejects_model_keys_urls_whitespace_and_wrong_lengths() {
        for length in 29..=32 {
            assert!(is_system_token_candidate(&"A".repeat(length)));
        }
        for value in [
            "",
            "sk-SYNTHETIC_MODEL_KEY",
            "https://api.tu-zi.com",
            "SYNTHETIC token with spaces here",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",
        ] {
            assert!(!is_system_token_candidate(value));
        }
    }
}
