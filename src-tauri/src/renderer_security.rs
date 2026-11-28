//! Application commands have no ACL manifest by default. Explicitly reject
//! remote child WebViews before dispatch, in addition to plugin capabilities.
use tauri::{ipc::Invoke, Manager, Runtime};
fn trusted(label: &str, url: &url::Url, dev_url: Option<&url::Url>) -> bool {
    if label != "main" {
        return false;
    }
    if matches!(url.scheme(), "tauri" | "tuziweb") && url.host_str() == Some("localhost") {
        return true;
    }
    if matches!(url.scheme(), "http" | "https")
        && matches!(
            url.host_str(),
            Some("tauri.localhost" | "tuziweb.localhost")
        )
    {
        return true;
    }
    dev_url.is_some_and(|dev| dev.origin() == url.origin())
}
pub fn guard<R: Runtime, F: Fn(Invoke<R>) -> bool + Send + Sync + 'static>(
    handler: F,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let view = invoke.message.webview_ref();
        #[cfg(debug_assertions)]
        let dev_url = view.app_handle().config().build.dev_url.as_ref();
        #[cfg(not(debug_assertions))]
        let dev_url = None;
        if !view
            .url()
            .ok()
            .is_some_and(|url| trusted(view.label(), &url, dev_url))
        {
            invoke.resolver.reject("远程网页无权调用助手命令");
            return true;
        }
        handler(invoke)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_children_and_remote_main_cannot_access_native_commands() {
        for value in [
            "https://web.tu-zi.com/login",
            "https://store.tu-zi.com/",
            "https://tauri.localhost.evil.invalid/",
        ] {
            let url = value.parse().unwrap();
            assert!(!trusted("main", &url, None));
            assert!(!trusted("site-direct", &url, None));
        }
        for value in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "tuziweb://localhost/index.html",
        ] {
            let url = value.parse().unwrap();
            assert!(trusted("main", &url, None));
            assert!(!trusted("site-direct", &url, None));
        }
        let dev = "http://localhost:3000".parse().unwrap();
        assert!(trusted("main", &dev, Some(&dev)));
        assert!(!trusted(
            "main",
            &"http://localhost:3001".parse().unwrap(),
            Some(&dev)
        ));
    }
}
