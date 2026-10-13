import { Button } from "@/components/ui/button";
import { type AccountState } from "@/lib/api/account";
import type { Profile, ProfileWrite } from "@/lib/api/desktop";
import { useDesktop } from "@/lib/query/desktop";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Field,
  QueryState,
  useWrite,
  WebEntry,
  WriteError,
} from "./BusinessShared";
export function ProfilePage({
  state,
  canWrite,
  personalAllowed = true,
}: {
  state: AccountState;
  canWrite: boolean;
  personalAllowed?: boolean;
}) {
  const { t } = useTranslation();
  const query = useDesktop<Profile>(state, "/api/desktop/profile", {}, 60000);
  const [form, setForm] = useState<ProfileWrite | null>(null);
  const { write, busy, error } = useWrite(state);
  useEffect(() => {
    if (query.data && !form) {
      const p = query.data.data;
      setForm({
        display_name: p.display_name,
        language: p.language,
        accept_unset_model_ratio_model: p.accept_unset_model_ratio_model,
        high_concurrency_enabled: p.high_concurrency_enabled,
        record_ip_log: p.record_ip_log,
      });
    }
  }, [query.data, form]);
  const save = async () => {
    if (!form || !query.data || error?.outcomeUnknown) return;
    const body = Object.fromEntries(
      Object.entries(form).filter(
        ([k, v]) => v !== query.data!.data[k as keyof ProfileWrite],
      ),
    );
    if (!Object.keys(body).length) return;
    const p = await write<Profile>("PATCH", "/api/desktop/profile", body);
    if (p) {
      setForm(null);
      await query.refetch();
    }
  };
  return (
    <>
      <QueryState query={query} />
      {query.data && (
        <p>
          {query.data.data.username} · {query.data.data.email}
        </p>
      )}
      {form && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field
            label={t("account.business.displayName")}
            value={form.display_name}
            onChange={(v) => setForm({ ...form, display_name: v })}
          />
          <label>
            {t("account.business.language")}
            <select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
            >
              {["zh-CN", "zh-TW", "en", "fr", "ru", "ja", "vi"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          {(
            [
              "accept_unset_model_ratio_model",
              "high_concurrency_enabled",
              "record_ip_log",
            ] as const
          ).map((k) => (
            <div key={k}>
              <Check
                label={t(`account.business.${k}`)}
                value={form[k]}
                onChange={(v) => setForm({ ...form, [k]: v })}
              />
              <p className="text-sm text-muted-foreground">
                {t(`account.business.${k}Hint`)}
              </p>
            </div>
          ))}
          <Button
            disabled={!canWrite || busy || !!error?.outcomeUnknown}
            type="submit"
          >
            {t("account.business.save")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setForm(null);
              void query.refetch();
            }}
          >
            {t("account.business.verify")}
          </Button>
        </form>
      )}
      <WriteError error={error} />
      <WebEntry target="personal" allowed={personalAllowed} />
    </>
  );
}
