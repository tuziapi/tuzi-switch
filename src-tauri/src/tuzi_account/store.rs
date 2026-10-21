use super::{AccountError, Record};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

pub trait TokenStore: Send + Sync {
    fn read(&self) -> Result<Option<Record>, AccountError>;
    fn write(&self, record: &Record) -> Result<(), AccountError>;
}

/// User-approved local plaintext storage. Kept outside portable configuration,
/// SQLite exports, tool backups and WebDAV. Never reads or migrates Keychain.
pub struct LocalFileStore {
    path: PathBuf,
}
const MAX_RECORD_BYTES: u64 = 64 * 1024;

impl LocalFileStore {
    pub fn new(origin: &str, client: &str) -> Result<Self, AccountError> {
        let root = std::env::var("CC_SWITCH_TEST_HOME")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(|v| PathBuf::from(v.trim()).join(".local/share"))
            .or_else(dirs::data_local_dir)
            .ok_or_else(AccountError::storage)?;
        #[cfg(feature = "local-preview")]
        let application = "com.tuziswitch.desktop.preview";
        #[cfg(not(feature = "local-preview"))]
        let application = "com.tuziswitch.desktop";
        // Explicitly separate sites and clients without putting credentials in paths.
        let namespace = format!("{origin}\0{client}");
        let name = format!("{:x}.json", Sha256::digest(namespace.as_bytes()));
        Ok(Self::at(root.join(application).join("account").join(name)))
    }

    pub(super) fn at(path: PathBuf) -> Self {
        Self { path }
    }

    fn prepare_directory(&self) -> Result<&Path, AccountError> {
        let directory = self.path.parent().ok_or_else(AccountError::storage)?;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(directory)
            .map_err(|_| AccountError::storage())?;
        let metadata = fs::symlink_metadata(directory).map_err(|_| AccountError::storage())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(AccountError::storage());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| AccountError::storage())?;
        }
        Ok(directory)
    }
}

impl TokenStore for LocalFileStore {
    fn read(&self) -> Result<Option<Record>, AccountError> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AccountError::storage()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(AccountError::storage());
        }
        let parent = self.path.parent().ok_or_else(AccountError::storage)?;
        let parent_metadata = fs::symlink_metadata(parent).map_err(|_| AccountError::storage())?;
        if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
            return Err(AccountError::storage());
        }
        let file = File::open(&self.path).map_err(|_| AccountError::storage())?;
        let opened = file.metadata().map_err(|_| AccountError::storage())?;
        if !opened.is_file() || opened.len() > MAX_RECORD_BYTES {
            return Err(AccountError::new("storage_invalid"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            if opened.dev() != metadata.dev()
                || opened.ino() != metadata.ino()
                || opened.permissions().mode() & 0o077 != 0
                || parent_metadata.permissions().mode() & 0o077 != 0
            {
                return Err(AccountError::storage());
            }
        }
        let mut bytes = Zeroizing::new(Vec::new());
        file.take(MAX_RECORD_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| AccountError::storage())?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(AccountError::new("storage_invalid"));
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| AccountError::new("storage_invalid"))
    }

    fn write(&self, record: &Record) -> Result<(), AccountError> {
        let directory = self.prepare_directory()?;
        match fs::symlink_metadata(&self.path) {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return Err(AccountError::storage());
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(AccountError::storage());
            }
            _ => {}
        }
        let bytes =
            Zeroizing::new(serde_json::to_vec(record).map_err(|_| AccountError::storage())?);
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(AccountError::new("storage_invalid"));
        }
        // NamedTempFile creates a private file on Unix; atomic replacement keeps
        // a failed write from truncating a previously saved connection.
        let mut temporary =
            tempfile::NamedTempFile::new_in(directory).map_err(|_| AccountError::storage())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|_| AccountError::storage())?;
        }
        temporary
            .write_all(&bytes)
            .map_err(|_| AccountError::storage())?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| AccountError::storage())?;
        temporary
            .persist(&self.path)
            .map_err(|_| AccountError::storage())?;
        #[cfg(unix)]
        File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| AccountError::storage())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tuzi_account::Tokens;

    fn synthetic_record() -> Record {
        Record {
            tokens: Some(Tokens {
                access_token: "synthetic-local-file-token".into(),
                user_id: "7".into(),
                connection_id: "synthetic-connection".into(),
            }),
            ..Default::default()
        }
    }

    #[test]
    fn local_file_round_trip_and_tombstone_remove_secret_without_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("account/connection.json");
        let store = LocalFileStore::at(path.clone());
        assert!(store.read().unwrap().is_none());
        store.write(&synthetic_record()).unwrap();
        let reopened = LocalFileStore::at(path.clone());
        assert_eq!(
            reopened
                .read()
                .unwrap()
                .unwrap()
                .tokens
                .as_ref()
                .unwrap()
                .access_token,
            "synthetic-local-file-token"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        store.write(&Record::default()).unwrap();
        assert!(reopened.read().unwrap().unwrap().tokens.is_none());
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains("synthetic-local-file-token"));
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn corrupt_and_oversized_files_fail_explicitly() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalFileStore::at(dir.path().join("account/connection.json"));
        store.write(&Record::default()).unwrap();
        fs::write(&store.path, b"broken-json").unwrap();
        assert_eq!(store.read().err().unwrap().code, "storage_invalid");
        fs::write(&store.path, vec![b' '; MAX_RECORD_BYTES as usize + 1]).unwrap();
        assert_eq!(store.read().err().unwrap().code, "storage_invalid");
    }

    #[test]
    fn failed_write_preserves_previous_connection() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalFileStore::at(dir.path().join("account/connection.json"));
        store.write(&synthetic_record()).unwrap();
        let mut oversized = synthetic_record();
        oversized.tokens.as_mut().unwrap().access_token = "x".repeat(MAX_RECORD_BYTES as usize);
        assert!(store.write(&oversized).is_err());
        assert_eq!(
            store
                .read()
                .unwrap()
                .unwrap()
                .tokens
                .as_ref()
                .unwrap()
                .access_token,
            "synthetic-local-file-token"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_and_public_permissions_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let store = LocalFileStore::at(dir.path().join("account/connection.json"));
        store.write(&synthetic_record()).unwrap();
        fs::set_permissions(&store.path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(store.read().is_err());
        let link = LocalFileStore::at(dir.path().join("account/link.json"));
        symlink(&store.path, &link.path).unwrap();
        assert!(link.read().is_err());
        assert!(link.write(&Record::default()).is_err());
        assert!(fs::read_to_string(&store.path)
            .unwrap()
            .contains("synthetic-local-file-token"));
    }

    #[test]
    fn site_and_client_paths_are_separate_from_portable_configuration() {
        let a = LocalFileStore::new("https://synthetic.example", "client-a").unwrap();
        let b = LocalFileStore::new("https://synthetic.example", "client-b").unwrap();
        let c = LocalFileStore::new("https://other.example", "client-a").unwrap();
        assert_ne!(a.path, b.path);
        assert_ne!(a.path, c.path);
        assert!(!a.path.starts_with(crate::config::get_app_config_dir()));
    }
}
