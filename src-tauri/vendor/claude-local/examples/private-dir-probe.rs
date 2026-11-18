//! Isolated OS regression probe. Only operates on explicitly supplied test paths.
fn main() {
    let paths: Vec<_> = std::env::args_os().skip(1).collect();
    if paths.is_empty() {
        eprintln!("Expected one or more disposable test directory paths");
        std::process::exit(2);
    }
    for path in paths {
        if let Err(error) = claude_local::private_dir(std::path::Path::new(&path)) {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
