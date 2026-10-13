use super::{AccountError, Record};
use zeroize::Zeroizing;

pub trait TokenStore: Send + Sync {
    fn read(&self) -> Result<Option<Record>, AccountError>;
    fn write(&self, record: &Record) -> Result<(), AccountError>;
}

pub struct SystemStore {
    namespace: String,
}
impl SystemStore {
    pub fn new(origin: &str, client: &str) -> Result<Self, AccountError> {
        let namespace = format!("tuzi-assistant/account/v1/{origin}/{client}");
        Ok(Self { namespace })
    }
}
impl TokenStore for SystemStore {
    fn read(&self) -> Result<Option<Record>, AccountError> {
        match keyring::Entry::new(&self.namespace, "active-connection")
            .map_err(|_| AccountError::storage())?
            .get_secret()
        {
            Ok(bytes) => serde_json::from_slice(&Zeroizing::new(bytes))
                .map(Some)
                .map_err(|_| AccountError::new("storage_invalid")),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AccountError::storage()),
        }
    }
    fn write(&self, record: &Record) -> Result<(), AccountError> {
        let bytes =
            Zeroizing::new(serde_json::to_vec(record).map_err(|_| AccountError::storage())?);
        keyring::Entry::new(&self.namespace, "active-connection")
            .map_err(|_| AccountError::storage())?
            .set_secret(&bytes)
            .map_err(|_| AccountError::storage())
    }
}
