pub const RELEASE_REPOSITORY: &str = env!("TUZI_SWITCH_RELEASE_REPOSITORY");

pub fn repository_url() -> String {
    format!("https://github.com/{RELEASE_REPOSITORY}")
}

pub fn releases_url() -> String {
    format!("{}/releases", repository_url())
}

pub fn latest_release_url() -> String {
    format!("{}/latest", releases_url())
}

pub fn web_manifest_urls() -> [String; 2] {
    [
        format!("https://cdn.jsdelivr.net/gh/{RELEASE_REPOSITORY}@release-web/latest.json"),
        format!("https://raw.githubusercontent.com/{RELEASE_REPOSITORY}/release-web/latest.json"),
    ]
}

pub fn trusted_web_archive_prefix() -> String {
    format!("https://cdn.jsdelivr.net/gh/{RELEASE_REPOSITORY}@release-web/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_urls_use_the_configured_repository() {
        assert!(releases_url().contains(RELEASE_REPOSITORY));
        assert!(latest_release_url().ends_with("/releases/latest"));
        assert!(web_manifest_urls()
            .iter()
            .all(|url| url.contains(RELEASE_REPOSITORY)));
        assert!(trusted_web_archive_prefix().contains(RELEASE_REPOSITORY));
    }
}
